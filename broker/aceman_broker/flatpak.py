"""Flatpak app probe used by both the player and browser detection.

One ``flatpak list`` round trip per cache window — N has_flatpak_app
calls within the window cost O(N) hash lookups, not N subprocess
fork+exec hops into the flatpak binary. The previous approach
(``flatpak info <app_id>`` per probe) blew the broker.call(timeout=10)
budget on cold-cache hosts because each call to flatpak takes a couple
of seconds on first use and we made 4-6 of them per detection cycle
(VLC + mpv from players; firefox + brave + chromium + chrome from
browsers).

Cache TTL is short enough that newly-installed flatpaks become
visible within a minute without the user having to restart the
broker — matches the freshness assumption the players module's
docstring documents ("detecting post-install changes without a
broker restart is worth it").
"""

from __future__ import annotations

import shutil
import subprocess
import threading
import time


_LIST_CACHE_TTL = 60.0  # seconds

_list_cache_lock = threading.Lock()
_list_cache_at = 0.0
_list_cache_value: "frozenset[str] | None" = None


def _list_installed_app_ids() -> "frozenset[str]":
    """Return the set of installed flatpak app IDs, cached.

    Empty frozenset on any error (no flatpak binary, timeout, parse
    failure). Never raises. Thread-safe — the broker's request
    dispatcher can call this concurrently from multiple sockets.
    """
    global _list_cache_at, _list_cache_value
    with _list_cache_lock:
        now = time.monotonic()
        if (_list_cache_value is not None
                and now - _list_cache_at < _LIST_CACHE_TTL):
            return _list_cache_value
        ids = _query_flatpak_list()
        _list_cache_value = ids
        _list_cache_at = now
        return ids


def _query_flatpak_list() -> "frozenset[str]":
    """Run ``flatpak list --app --columns=application`` and parse it.
    Split out from the cache wrapper so tests can monkey-patch this
    independently of the TTL machinery."""
    if not shutil.which("flatpak"):
        return frozenset()
    try:
        # --app filters out runtime/extension rows so we don't waste
        # effort matching the user-facing IDs against runtime IDs.
        # --columns=application emits one reverse-DNS ID per line with
        # no header decoration. Timeout 5 s — `flatpak list` is local
        # only (no network) and finishes in tens of ms on a warm
        # cache; the timeout exists to protect against the user
        # tripping over a wedged ostree lock, not network latency.
        r = subprocess.run(
            ["flatpak", "list", "--app", "--columns=application"],
            capture_output=True, timeout=5, check=False,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return frozenset()
    if r.returncode != 0:
        return frozenset()
    out = r.stdout.decode("utf-8", errors="replace")
    return frozenset(line.strip() for line in out.splitlines() if line.strip())


def has_flatpak_app(app_id: str) -> bool:
    """True iff a flatpak app with this ID is installed for the user.
    False on any error: missing flatpak binary, ostree lock contention,
    etc. Never raises. Resolves via a cached ``flatpak list`` so N
    calls cost at most one subprocess per :data:`_LIST_CACHE_TTL`
    window."""
    return app_id in _list_installed_app_ids()


def reset_cache_for_tests() -> None:
    """Drop the cached set so the next call re-queries flatpak. The
    broker never invalidates the cache itself — TTL covers the
    install/uninstall window. Tests reach for this when they want
    a deterministic miss."""
    global _list_cache_at, _list_cache_value
    with _list_cache_lock:
        _list_cache_at = 0.0
        _list_cache_value = None
