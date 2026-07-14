"""Android TV (VLC) casting actions — drive an Android/Google/Fire TV box
over network ADB and launch VLC on it to auto-play a stream.

Why this lives in the broker
----------------------------
``adb`` is a host binary that reaches the TV over the LAN. The web server
runs inside a container with no host ``adb`` and no LAN path of its own —
the same reason ``browser.spawn`` lives here. The web sends only ``{ip}``
and ``{ip, cid}``; the broker validates both, builds the getstream URL
from its OWN LAN detection (never a client-supplied URL), and runs a fixed
``adb`` argv. So a compromised web container can't turn this into an
arbitrary-command or arbitrary-URL primitive.

Flow (mirrors the UI)
---------------------
``tv.connect`` → ``adb connect <ip>:5555`` then read ``adb devices``, and
report ``authorized`` / ``unauthorized`` / ``unreachable`` / ``no-adb`` so
the UI can guide the one-time on-TV debugging approval.

``tv.cast`` → ensure the device is authorized, then ``am start`` VLC's
``.StartActivity`` (the activity that handles ``http`` VIEW intents and
goes straight into the player — the launcher/MainActivity would just show
VLC's home screen) with the live getstream URL.
"""

from __future__ import annotations

import re
import shutil
import subprocess

from ..logging_util import _log
from . import register as _register
from .engine import _detect_lan_ip, _lan_port

ADB_PORT = 5555
# VLC Android's activity that handles http/https VIEW intents and lands
# directly in playback. Verified against org.videolan.vlc on Android 11.
VLC_COMPONENT = "org.videolan.vlc/.StartActivity"

# Strict IPv4 — the TV is a LAN device the user typed in. Nothing but a
# dotted-quad ever reaches an adb argv.
_IPV4_RE = re.compile(
    r"\A(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\Z")
_CID_RE = re.compile(r"\A[a-f0-9]{40}\Z")


def _valid_ip(ip) -> bool:
    return isinstance(ip, str) and bool(_IPV4_RE.match(ip))


def _adb(*args, timeout: float = 15.0):
    """Run ``adb`` with a fixed argv (all dynamic parts pre-validated).
    Returns (returncode, combined stdout+stderr). Raises OSError if adb is
    absent and subprocess.SubprocessError (incl. TimeoutExpired) on trouble."""
    proc = subprocess.run(
        ["adb", *args],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=timeout,
        text=True,
    )
    return proc.returncode, (proc.stdout or "")


def _device_state(ip: str) -> str:
    """Parse ``adb devices`` for ``<ip>:5555``. Returns ``device``,
    ``unauthorized``, ``offline``, or ``""`` (not listed / adb trouble)."""
    try:
        _rc, out = _adb("devices")
    except (OSError, subprocess.SubprocessError):
        return ""
    target = f"{ip}:{ADB_PORT}"
    for line in out.splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[0] == target:
            return parts[1]
    return ""


def _connect(ip: str) -> str:
    """``adb connect`` then report the resulting device state. Assumes adb
    is present (callers gate on ``shutil.which('adb')`` first)."""
    try:
        _adb("connect", f"{ip}:{ADB_PORT}", timeout=20)
    except (OSError, subprocess.SubprocessError):
        pass
    return _device_state(ip)


def _classify(state: str) -> str:
    if state == "device":
        return "authorized"
    if state == "unauthorized":
        return "unauthorized"
    return "unreachable"   # 'offline', not-listed, or connect failed


def action_tv_connect(params: "dict | None" = None) -> dict:
    """Connect to the box and report readiness. Never raises.
    ``{"status": "authorized"|"unauthorized"|"unreachable"|"no-adb"|"invalid-ip"}``."""
    p = params or {}
    ip = str(p.get("ip", "")).strip()
    if not _valid_ip(ip):
        return {"status": "invalid-ip"}
    if shutil.which("adb") is None:
        return {"status": "no-adb"}
    status = _classify(_connect(ip))
    _log("tv", "tv.connect %s → %s", ip, status)
    return {"status": status, "ip": ip}


def action_tv_cast(params: "dict | None" = None) -> dict:
    """Launch VLC on the box playing the cid's getstream URL. Never raises.
    On success ``{"cast": True, "status": "casting", "url": ...}``; otherwise
    ``{"cast": False, "status": ...}`` with the same statuses as tv.connect so
    the UI can guide recovery (e.g. re-approve on the TV)."""
    p = params or {}
    ip = str(p.get("ip", "")).strip()
    cid = str(p.get("cid", "")).strip().lower()
    if not _valid_ip(ip):
        return {"cast": False, "status": "invalid-ip"}
    if not _CID_RE.match(cid):
        return {"cast": False, "status": "invalid-cid"}
    if shutil.which("adb") is None:
        return {"cast": False, "status": "no-adb"}
    status = _classify(_connect(ip))
    if status != "authorized":
        return {"cast": False, "status": status}
    lan_ip = _detect_lan_ip()
    if not lan_ip:
        return {"cast": False, "status": "no-lan-ip"}
    url = f"http://{lan_ip}:{_lan_port()}/ace/getstream?id={cid}"
    # `adb shell` runs the command in the DEVICE's shell, so single-quote the
    # URL to neutralise the '?' glob and any shell metacharacter. url is built
    # only from our own dotted-quad LAN IP + numeric port + a 40-hex cid, so it
    # cannot itself contain a single quote — the quoting is safe and complete.
    remote = (f"am start -n {VLC_COMPONENT} "
              f"-a android.intent.action.VIEW -d '{url}' -t 'video/*'")
    try:
        rc, out = _adb("-s", f"{ip}:{ADB_PORT}", "shell", remote, timeout=20)
    except (OSError, subprocess.SubprocessError) as e:
        return {"cast": False, "status": "adb-error", "reason": str(e)}
    # `am start` prints "Starting: Intent…" on success; failures carry
    # "Error:" / an Exception trace.
    if rc != 0 or "Error" in out or "Exception" in out:
        _log("tv", "tv.cast am start failed: %s", out.strip()[:200])
        return {"cast": False, "status": "launch-failed",
                "reason": out.strip()[:200]}
    _log("tv", "tv.cast: launched VLC on %s for cid %s", ip, cid)
    return {"cast": True, "status": "casting", "ip": ip, "url": url}


def register(actions: dict) -> None:
    _register(actions, "tv.connect", action_tv_connect)
    _register(actions, "tv.cast", action_tv_cast)
