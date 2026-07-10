"""Stream health probing.

Answers one question per channel: *if you clicked play right now, would it
actually stream?* Ace Stream is P2P/HTTP-sourced, so the only trustworthy
signal is whether real bytes flow — the engine's ``status``/``peers`` fields
lie (a healthy HTTP-sourced channel sits at ``status='dl'`` with ``peers=0``
and zero bytes until a reader attaches; a dead channel looks identical).

So a probe opens a session on a reserved ``pid`` (independent of the default
playback session — the two run concurrently without evicting each other),
attaches a short-lived reader to the playback URL, and times the first byte:

  * bytes arrive fast   → ``healthy``
  * bytes arrive slowly → ``slow``       (late first byte)
  * no bytes by deadline→ ``dead``       (offline / no peers)
  * engine refused/down → ``unreachable``

Deep probing (``deep=True``, the Library "check playability" setting) adds a
format check for the channels that *do* deliver bytes: it runs ``ffprobe`` on
the playback URL, and if ffprobe can't identify a usable audio/video stream the
channel is ``unplayable`` (bytes flow, but not in a form the player can use) —
the record carries ffprobe's reason so it can be exported for a bug report.
This costs an ffprobe run per reachable channel, so it is opt-in.

(We deliberately do NOT try to decode frames to catch a "frozen picture" /
corrupt-bitstream channel: measured against real streams, a healthy live h264
feed and a corrupt HEVC one throw the same start-up decode warnings and both
eventually yield frames, so a frame-count check produces false positives —
flagging good channels — which is the worse failure. Stream identification is
the signal we can trust.)

``stat_url`` is polled once for tooltip detail (speed / downloaded) but never
decides the verdict. The session is always released on the way out.

The pure verdict pieces (:func:`classify_probe`) are unit-tested; timing
thresholds are module constants so they stay easy to tune.
"""

from __future__ import annotations

import json
import queue
import random
import socket
import subprocess
import time
import urllib.error
import urllib.request

from .engine_client import (
    EngineError,
    engine_getstream,
    engine_poll_stat,
    _release_engine_session,
)
from .log_util import _sanitize_msg

# Reserved probe player-ids. Each getstream on a distinct pid gets its own
# independent session, so concurrent probes MUST use distinct pids — sharing
# one makes the engine evict/refuse the second (it slams the connection shut).
# That same-pid churn is not just cosmetic: alongside a live playback it has
# crashed the engine's live-storage thread. We hand out pids from a small pool
# (bigger than the server's concurrency ceiling) and return them after, so the
# engine only ever sees a handful of probe players. All pids differ from the
# default (no-pid) playback session, so a probe never disturbs playback.
#
# The engine's max pid is undocumented; empirically 1..424242 were accepted,
# but we keep these small (well under any 16-bit-style ceiling) to be safe.
_PROBE_PID_BASE = 8000
_PROBE_PID_POOL_SIZE = 8
_probe_pids: "queue.Queue[int]" = queue.Queue()
for _p in range(_PROBE_PID_BASE, _PROBE_PID_BASE + _PROBE_PID_POOL_SIZE):
    _probe_pids.put(_p)


def _acquire_pid() -> "tuple[int, bool]":
    """Borrow a distinct probe pid. Returns ``(pid, pooled)``; ``pooled`` is
    False for the rare exhaustion fallback (a random high pid) so we know not
    to return it to the pool."""
    try:
        return _probe_pids.get_nowait(), True
    except queue.Empty:
        # Pool exhausted (unexpected: the server caps concurrency below the
        # pool). Fall back to a random pid still well under a 16-bit ceiling.
        return random.randint(_PROBE_PID_BASE + 100,
                              _PROBE_PID_BASE + 20000), False


def _release_pid(pid: int, pooled: bool) -> None:
    if pooled:
        _probe_pids.put(pid)

# Seconds to wait for the first byte before declaring a channel dead. Healthy
# streams deliver in well under a second; dead ones deliver nothing — the wide
# margin means this is forgiving of a slow-to-source-but-alive channel.
DEFAULT_DEADLINE = 12.0
# A first byte later than this still counts as reachable, just "slow".
DEFAULT_SLOW_AFTER = 4.0
# How many attach attempts before concluding "dead". A COLD P2P source can take
# longer than one deadline to deliver its first byte — but the first attach is
# what makes the engine start sourcing, so a second attach usually catches it
# (measured: a channel that timed out at 12 s cold delivered in 0.76 s once
# warm). Only channels that miss the first deadline pay for the retry; a truly
# dead channel just times out twice.
_FIRST_BYTE_ATTEMPTS = 2
# Cap on the ffprobe format identification (deep mode only).
FFPROBE_TIMEOUT = 10.0
# We only need to know bytes flow, not collect them.
_FIRST_BYTE_CHUNK = 4096


def classify_probe(first_byte_secs: "float | None",
                   *, slow_after: float = DEFAULT_SLOW_AFTER) -> str:
    """Pure timing verdict: ``None`` (no byte ever) → dead; a fast first byte
    → healthy; a late one → slow. The format (``unplayable``) and session
    (``unreachable``) verdicts are layered on by :func:`probe_stream`."""
    if first_byte_secs is None:
        return "dead"
    if first_byte_secs <= slow_after:
        return "healthy"
    return "slow"


def _num(value):
    """Coerce an engine-supplied stat field to int, or None. Keeps hostile /
    oddly-typed values out of the JSON we hand back to the browser."""
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _read_first_byte(playback_url: str, deadline: float,
                     attempts: int = _FIRST_BYTE_ATTEMPTS) -> "float | None":
    """Attach a reader to ``playback_url`` and return the seconds elapsed
    (across all attempts) to the first real byte, or ``None`` if none arrive.
    Reads at most one small chunk, then closes — a healthy probe pulls a few KB,
    not the stream.

    A cold P2P/HTTP source often delivers nothing within one deadline on the
    FIRST attach — but that attach is what makes the engine begin sourcing, so
    we retry (``attempts``): the next attach usually catches the now-warming
    stream. Only channels that miss the first deadline pay this cost; a genuinely
    dead one simply times out every attempt. The returned elapsed time spans the
    retries, so a slow cold-start is classified ``slow`` (honest), not ``dead``."""
    start = time.monotonic()
    for _ in range(max(1, attempts)):
        try:
            with urllib.request.urlopen(playback_url, timeout=deadline) as r:
                chunk = r.read(_FIRST_BYTE_CHUNK)
                if chunk:
                    return time.monotonic() - start
                # No data this attach — the attach still kicked off sourcing, so
                # fall through and retry rather than concluding dead outright.
        except (urllib.error.URLError, TimeoutError, socket.timeout, OSError):
            pass  # timed out / errored — retry (the source is now warming)
    return None


def _ffprobe_playable(playback_url: str,
                      timeout: float = FFPROBE_TIMEOUT) -> "tuple[bool, str]":
    """Run ffprobe on the playback URL. Return ``(playable, reason)``:
    ``playable`` is True when ffprobe identifies at least one audio or video
    stream; otherwise ``reason`` explains why (ffprobe's own error, a timeout,
    or "no audio/video stream"). Best-effort — any failure to *run* ffprobe is
    reported as not-playable with the reason, never raised."""
    try:
        r = subprocess.run(
            ["ffprobe", "-v", "error",
             "-analyzeduration", "3000000", "-probesize", "3000000",
             "-show_entries", "stream=codec_type,codec_name",
             "-of", "json", playback_url],
            capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return False, "ffprobe timed out identifying the stream"
    except (OSError, ValueError) as e:
        return False, f"ffprobe could not run: {_sanitize_msg(str(e))}"
    if r.returncode != 0:
        err = (r.stderr or "").strip() or "ffprobe reported an error"
        return False, _sanitize_msg(err)[:300]
    try:
        streams = (json.loads(r.stdout or "{}") or {}).get("streams") or []
    except (json.JSONDecodeError, ValueError):
        return False, "ffprobe output was not valid JSON"
    kinds = [s.get("codec_type") for s in streams if isinstance(s, dict)]
    if not ("video" in kinds or "audio" in kinds):
        return False, "no audio or video stream found"
    codecs = ", ".join(
        f"{s.get('codec_type')}:{s.get('codec_name')}"
        for s in streams if isinstance(s, dict) and s.get("codec_name"))
    return True, codecs


def probe_stream(engine: str, cid: str, *,
                 deep: bool = False,
                 deadline: float = DEFAULT_DEADLINE,
                 slow_after: float = DEFAULT_SLOW_AFTER) -> dict:
    """Probe one channel end-to-end and return
    ``{"cid", "state", "detail"}``. Always releases the engine session.

    ``deep`` runs the ffprobe format check on channels that deliver bytes,
    enabling the ``unplayable`` verdict; without it the probe is a pure
    byte-flow test (healthy / slow / dead / unreachable)."""
    pid, pooled = _acquire_pid()
    try:
        playback_url, command_url, stat_url = engine_getstream(
            engine, cid, pid=pid)
    except EngineError as e:
        _release_pid(pid, pooled)
        return {"cid": cid, "state": "unreachable",
                "detail": {"reason": _sanitize_msg(str(e))}}

    reason = ""
    stat: dict = {}
    try:
        first_byte_secs = _read_first_byte(playback_url, deadline)
        state = classify_probe(first_byte_secs, slow_after=slow_after)
        # Format check only for channels that actually delivered bytes — a
        # dead channel would just make ffprobe time out, and it's already
        # classified. Reachable + deep → confirm the bytes are decodable.
        if deep and state in ("healthy", "slow"):
            playable, detail_msg = _ffprobe_playable(playback_url)
            if not playable:
                state, reason = "unplayable", detail_msg
            else:
                reason = detail_msg   # codec list, for the tooltip
        elif state == "dead":
            reason = "no data received — offline or no peers right now"
        # One stat poll for tooltip detail (speed/peers); never blocks verdict.
        try:
            stat = engine_poll_stat(stat_url, timeout=min(4.0, deadline))
        except EngineError:
            stat = {}
    finally:
        _release_engine_session(command_url)
        _release_pid(pid, pooled)

    return {
        "cid": cid,
        "state": state,
        "detail": {
            "first_byte_secs": (round(first_byte_secs, 3)
                                if first_byte_secs is not None else None),
            "reason": reason,
            "peers": _num(stat.get("peers")),
            "speed_down": _num(stat.get("speed_down")),
            "downloaded": _num(stat.get("downloaded")),
        },
    }
