"""Engine container lifecycle actions.

All state-changing podman calls are serialised under a single lock —
two concurrent "Start engine" clicks must not race into a double
spawn or stop-while-starting.
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import threading
import time
from urllib.parse import urlsplit

from ..config import (
    ENGINE_GATEWAY,
    ENGINE_URL,
    ENSURE_IMAGE_HELPER,
    GATEWAY_NAME,
    IMAGE,
    LAUNCHER_TIMEOUT,
    NAME,
    RUN_GW_SH,
    RUN_SH,
    START_WAIT_SECONDS,
    STOP_TIMEOUT,
    WEB_IMAGE,
)
from ..engine_ops import (
    container_running,
    container_state,
    engine_probe,
    image_commit_label,
)
from .restart_helpers import (
    pick_up_image_changes,
    recreate_container,
)
from ..logging_util import _log, _safe
from ..validators import validate_bool, validate_lines
from ..wrapper import wrapper_alive, wrapper_cid
from . import register


# Serialises every state-changing engine action.
_engine_lock = threading.Lock()

# LAN exposure of the engine's HTTP API. OFF by default and NEVER
# persisted: a fresh broker starts loopback-only every launch, so a
# widened bind can't silently outlive a restart. The operator opts in
# per session via the engine.set_lan action (the web UI's "Expose
# engine on LAN" toggle). Read by _start_engine_unlocked when forming
# the launch env. Guarded by _engine_lock for writes.
_lan_exposed = False


def _detect_lan_ip() -> str:
    """Best-effort primary LAN IPv4 of this host. Opens a UDP socket and
    'connects' to a TEST-NET address (RFC 5737) — no packet is sent for
    UDP, the kernel just resolves which local interface would carry it,
    which getsockname() then reports. Returns "" when there's no route
    (offline / loopback-only)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("192.0.2.1", 9))
        return s.getsockname()[0]
    except OSError:
        return ""
    finally:
        s.close()


def _lan_port() -> int:
    """Host-side port the engine API is published on — the port a LAN
    player connects to. Taken from the configured ENGINE_URL (the
    broker and run-container.sh agree on this; default 6878)."""
    return urlsplit(ENGINE_URL).port or 6878


def _lan_info() -> dict:
    """LAN-exposure fields shared by engine.status and engine.set_lan."""
    return {
        "lan_exposed": _lan_exposed,
        "lan_ip": _detect_lan_ip(),
        "lan_port": _lan_port(),
    }


# ── Engine gateway ────────────────────────────────────────────────────
# In the default (gateway) mode the engine container has NO host port:
# the gateway container (run-gateway.sh) publishes the host API port,
# forwards to the engine over the bridge, and refuses browser requests.
# The gateway's publish host follows _lan_exposed (loopback vs 0.0.0.0),
# so the LAN toggle re-spawns only the lightweight gateway — the engine
# (and any active stream) stays up.

def _gateway_publish_host() -> str:
    return "0.0.0.0" if _lan_exposed else "127.0.0.1"


def _start_gateway_unlocked() -> None:
    """(Re)launch the engine gateway container. Raises on launcher failure
    — a missing gateway means the host can't reach the engine at all, so
    that's a hard error, not a silent degrade."""
    _log("engine", "gateway: spawning '%s' (publish %s)",
         GATEWAY_NAME, _gateway_publish_host())
    env = os.environ.copy()
    env["ACE_DETACH"] = "1"
    env["ACE_GW_NAME"] = GATEWAY_NAME
    env["ACE_NAME"] = NAME
    env["ACE_WEB_IMAGE"] = WEB_IMAGE
    env["ACE_GW_HOST"] = _gateway_publish_host()
    try:
        r = subprocess.run(
            ["bash", str(RUN_GW_SH)],
            env=env, capture_output=True, text=True,
            timeout=LAUNCHER_TIMEOUT,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired) as e:
        raise RuntimeError(f"gateway launcher failed: {e}") from e
    if r.returncode != 0:
        msg = _safe((r.stderr or r.stdout or "").strip())
        raise RuntimeError(
            f"gateway launcher exited {r.returncode}: {msg or '<no output>'}")


def _stop_gateway() -> None:
    """Best-effort removal of the gateway container."""
    try:
        subprocess.run(
            ["podman", "rm", "-f", GATEWAY_NAME],
            capture_output=True, timeout=STOP_TIMEOUT,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass


import re as _re

# Engine-side noise we filter out before showing the log tail in the UI.
# Each pattern is a benign line emitted from inside the container that
# tells the operator nothing actionable but clutters the view:
#   * `/dev/disk/by-id` — engine shells out to enumerate disks for a
#     hardware fingerprint; we deliberately don't expose host devices,
#     so ls returns ENOENT every poll.
# Add patterns here as discovered. We filter on the broker, not in the
# container — the engine binary stays untouched, and the raw log is
# still available via `podman logs` for anyone investigating directly.
_ENGINE_LOG_NOISE = (
    _re.compile(r"^ls: cannot access '/dev/disk/by-id/?': "
                r"No such file or directory\s*$"),
)


def _filter_engine_noise(text: str) -> str:
    """Strip _ENGINE_LOG_NOISE lines from a log dump. Preserves order
    and the trailing-newline shape of the input modulo the dropped
    lines."""
    if not text:
        return text
    out = []
    for line in text.split("\n"):
        if any(p.match(line) for p in _ENGINE_LOG_NOISE):
            continue
        out.append(line)
    return "\n".join(out)


def action_engine_logs(params: "dict | None" = None) -> dict:
    """Tail engine container logs via ``podman logs --tail N``."""
    lines = validate_lines(
        (params or {}).get("lines"), maximum=1000, default=200)
    try:
        r = subprocess.run(
            ["podman", "logs", "--tail", str(lines), NAME],
            capture_output=True, text=True, timeout=8,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired) as e:
        return {"path": f"podman logs {NAME}", "tail": f"({e})",
                "lines": 0, "size_bytes": 0, "available": False}
    if r.returncode != 0:
        return {"path": f"podman logs {NAME}",
                "tail": _safe(r.stderr or "container not running"),
                "lines": 0, "size_bytes": 0, "available": False}
    text = (r.stdout or "") + (r.stderr or "")
    text = _filter_engine_noise(text)
    tail = text.rstrip("\n")
    return {"path": f"podman logs {NAME}",
            "tail": tail,
            "lines": tail.count("\n") + 1 if tail else 0,
            "size_bytes": len(tail.encode("utf-8")),
            "available": True}


def action_engine_status(params: "dict | None" = None) -> dict:
    state = container_state()
    alive = wrapper_alive()
    return {
        "container": state == "running",
        "container_state": state,
        "up": engine_probe(),
        "wrapper_alive": alive,
        # The cid the wrapper is currently playing, when it's alive.
        # Lets the web UI populate the Watch input and look up the
        # name in favourites for streams that bypassed the web
        # entirely (acestream:// link → desktop entry → external
        # player). Empty when no wrapper is up.
        "wrapper_cid": wrapper_cid() if alive else "",
        **_lan_info(),
    }


def _start_engine_unlocked() -> dict:
    """The body of action_engine_start without the _engine_lock acquire.
    Lets action_engine_restart call into the spawn path while it
    already holds the lock (Python locks aren't reentrant).
    """
    if container_running():
        return {"started": False, "reason": "already running"}
    _log("engine", "start: spawning '%s' via %s", NAME, RUN_SH)
    env = os.environ.copy()
    env["ACE_DETACH"] = "1"
    env["ACE_NAME"] = NAME
    env["ACE_IMAGE"] = IMAGE
    env["ACE_ENGINE_GATEWAY"] = "1" if ENGINE_GATEWAY else "0"
    if not ENGINE_GATEWAY and _lan_exposed:
        # Opt-out (no gateway): the engine publishes its own host port, so
        # bind it on all interfaces for LAN players. In gateway mode the
        # engine never publishes — the gateway's publish host handles LAN.
        env["ACE_API_HOST"] = "0.0.0.0"
    try:
        r = subprocess.run(
            ["bash", str(RUN_SH)],
            env=env, capture_output=True, text=True,
            timeout=LAUNCHER_TIMEOUT,
        )
    except FileNotFoundError as e:
        raise RuntimeError(f"bash not on PATH: {e}") from e
    except subprocess.TimeoutExpired as e:
        raise RuntimeError("launcher timed out") from e
    if r.returncode != 0:
        msg = _safe((r.stderr or r.stdout or "").strip())
        raise RuntimeError(
            f"launcher exited {r.returncode}: {msg or '<no output>'}")
    # Gateway mode: the engine has no host port, so bring up the gateway
    # (it publishes the host port and forwards over the bridge) BEFORE we
    # probe — the probe reaches the engine *through* the gateway.
    if ENGINE_GATEWAY:
        _start_gateway_unlocked()
    deadline = time.monotonic() + START_WAIT_SECONDS
    while time.monotonic() < deadline:
        if engine_probe(timeout=2):
            _log("engine", "start: ready")
            return {"started": True}
        time.sleep(1)
    raise RuntimeError(
        f"container started but engine never answered at {ENGINE_URL}")


def action_engine_start(params: "dict | None" = None) -> dict:
    with _engine_lock:
        return _start_engine_unlocked()


def _stop_engine_unlocked() -> dict:
    """The body of action_engine_stop without the _engine_lock acquire,
    so set_lan can stop-then-respawn while already holding the lock."""
    # Drop the gateway first (best-effort, even if the engine isn't
    # running) so no new host request reaches a dying engine.
    if ENGINE_GATEWAY:
        _stop_gateway()
    if not container_running():
        return {"stopped": False, "reason": "not running"}
    _log("engine", "stop: '%s'", NAME)
    try:
        subprocess.run(
            ["podman", "stop", "-t", "5", NAME],
            capture_output=True, timeout=STOP_TIMEOUT,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired) as e:
        raise RuntimeError(f"podman stop failed: {e}") from e
    return {"stopped": True}


def action_engine_stop(params: "dict | None" = None) -> dict:
    with _engine_lock:
        return _stop_engine_unlocked()


def action_engine_set_lan(params: "dict | None" = None) -> dict:
    """Toggle LAN exposure of the engine's HTTP API for this session.

    Enabled → the host port binds 0.0.0.0 so a player on another device
    (e.g. VLC on a phone/tablet) can reach it. Disabled → loopback-only.

    Gateway mode (default): only the lightweight gateway re-spawns with
    the new publish host — the engine and any active stream stay up. The
    gateway still refuses browser requests even when exposed on the LAN.

    Opt-out mode: the engine itself owns the host port, so it must be
    stopped and relaunched (the publish is fixed at `podman run` time).

    Not persisted: a fresh broker always starts loopback-only."""
    enabled = validate_bool((params or {}).get("enabled"), "enabled")
    global _lan_exposed
    with _engine_lock:
        changed = enabled != _lan_exposed
        _lan_exposed = enabled
        relaunched = False
        if changed and container_running():
            _log("engine", "set_lan: %s → re-spawning %s",
                 "expose" if enabled else "loopback",
                 "gateway" if ENGINE_GATEWAY else "engine")
            if ENGINE_GATEWAY:
                _start_gateway_unlocked()      # engine stays up
            else:
                _stop_engine_unlocked()
                _start_engine_unlocked()
            relaunched = True
        return {"relaunched": relaunched, **_lan_info()}


def action_engine_restart(params: "dict | None" = None) -> dict:
    with _engine_lock:
        # `rebuild` is the explicit operator opt-in from the Restart
        # modal's tickbox. Default false keeps a routine restart cheap
        # (plain `podman restart`) and bails early if the container
        # isn't running. true means "set everything back to a known
        # clean state": build/rebuild the image, and if the container
        # was stopped or never created, START it instead of giving up.
        # That's what the operator's "Rebuild images" intent expects —
        # not "only bounce what's running".
        rebuild = bool((params or {}).get("rebuild", False))
        if not container_running():
            if not rebuild:
                return {"restarted": False, "reason": "not running"}
            # Rebuild path with no running container: ensure the image
            # is current (build from tarball if missing), then start
            # fresh. Falls back to "started" semantics — same wire
            # response shape as a restart so the UI doesn't have to
            # distinguish.
            if rebuild:
                pick_up_image_changes("engine", IMAGE)
            r = _start_engine_unlocked()
            return {"restarted": bool(r.get("started")),
                    "rebuilt": True,
                    "started_fresh": True,
                    "reason": r.get("reason")}
        rebuilt = False
        if rebuild:
            # Operator ticked Rebuild — unconditionally rebuild AND
            # recreate. Drift detection (label or image ID) can be
            # blind on a dirty working tree, and a plain
            # `podman restart` would then keep the stale container
            # despite a fresh image. See web_lifecycle for the same
            # rationale.
            pick_up_image_changes("engine", IMAGE)
            _log("engine", "restart: rebuild=true → recreating '%s'", NAME)
            recreate_container(NAME)
            rebuilt = True
        else:
            _log("engine", "restart: '%s'", NAME)
            try:
                r = subprocess.run(
                    ["podman", "restart", "-t", "5", NAME],
                    capture_output=True, text=True, timeout=20,
                )
            except (FileNotFoundError, subprocess.TimeoutExpired) as e:
                raise RuntimeError(f"podman restart failed: {e}") from e
            if r.returncode != 0:
                msg = _safe((r.stderr or r.stdout or "").strip())
                raise RuntimeError(
                    f"podman restart exited {r.returncode}: "
                    f"{msg or '<no output>'}")
        # Gateway mode: re-spawn the gateway against the (re)started engine
        # before probing — the probe reaches the engine through it, and a
        # fresh gateway also picks up any web-image rebuild.
        if ENGINE_GATEWAY:
            _start_gateway_unlocked()
        deadline = time.monotonic() + START_WAIT_SECONDS
        while time.monotonic() < deadline:
            if engine_probe(timeout=2):
                _log("engine", "restart: ready (rebuilt=%s)", rebuilt)
                return {"restarted": True, "rebuilt": rebuilt}
            time.sleep(1)
        raise RuntimeError(
            f"container restarted but engine never answered at {ENGINE_URL}")


def action_engine_memory(params: "dict | None" = None) -> dict:
    """Return current and limit memory for the engine container.
    Same parsing logic as web.memory — see web_lifecycle.py."""
    from .web_lifecycle import _parse_mem_str
    if not container_running():
        return {"available": False}
    try:
        r = subprocess.run(
            ["podman", "stats", "--no-stream", "--format", "json", NAME],
            capture_output=True, text=True, timeout=6,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return {"available": False}
    if r.returncode != 0:
        return {"available": False}
    try:
        data = json.loads(r.stdout.strip())
        entry = data[0] if isinstance(data, list) else data
        mem_usage = entry.get("MemUsage") or entry.get("mem_usage") or ""
        parts = mem_usage.split("/")
        if len(parts) != 2:
            return {"available": False}
        mem_bytes = _parse_mem_str(parts[0])
        limit_bytes = _parse_mem_str(parts[1])
    except (json.JSONDecodeError, IndexError, KeyError, ValueError):
        return {"available": False}
    return {"available": True, "mem_bytes": mem_bytes, "limit_bytes": limit_bytes}


def register(actions: dict) -> None:
    from . import register as _r
    _r(actions, "engine.status", action_engine_status)
    _r(actions, "engine.logs", action_engine_logs)
    _r(actions, "engine.start", action_engine_start)
    _r(actions, "engine.stop", action_engine_stop)
    _r(actions, "engine.set_lan", action_engine_set_lan)
    _r(actions, "engine.restart", action_engine_restart)
    _r(actions, "engine.memory", action_engine_memory)
