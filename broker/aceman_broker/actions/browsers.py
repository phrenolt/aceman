"""Browser detection actions.

Each row carries an ``argv`` so the web doesn't have to know how to
spawn anything — the broker is the only thing that ever talks to the
host. The frontend uses only ``name`` and ``source`` for the UI;
the launch helper uses ``argv``.

``browser.spawn`` exists because the web server runs inside a
container with no DISPLAY / Wayland socket / DBus session, so a
``subprocess.Popen`` from the web side reaches the host fork-exec'd
into a void. The broker, in contrast, runs on the host with full
session env and can actually open Brave/Firefox. The wire takes
``{name, source, url}``; the broker resolves the argv from its own
``browsers.list`` so the client never gets to dictate the command
line.
"""

from __future__ import annotations

import os
import platform
import re
import shutil
import subprocess

from ..flatpak import has_flatpak_app
from ..logging_util import _log
from . import register as _register


PLATFORM = platform.system().lower()


_BROWSER_FLATPAK_IDS = {
    "firefox":       "org.mozilla.firefox",
    "brave":         "com.brave.Browser",
    "chromium":      "org.chromium.Chromium",
    "google-chrome": "com.google.Chrome",
}


def _probe_linux_browser_system(name: str, *candidates: str):
    """Single-element list when any candidate is on PATH.

    ``name`` is the user-facing label ("firefox", "brave", …) kept
    stable across distros even when the binary is named differently
    (``brave-browser-stable`` on some, ``brave`` on others)."""
    for bin_name in candidates:
        path = shutil.which(bin_name)
        if path:
            return [{"name": name, "source": "system", "argv": [path]}]
    return []


def _probe_linux_browser_flatpak(name: str):
    app_id = _BROWSER_FLATPAK_IDS.get(name)
    if app_id and has_flatpak_app(app_id):
        return [{"name": name, "source": "flatpak",
                 "argv": ["flatpak", "run", app_id]}]
    return []


def _probe_linux_firefox():
    return (_probe_linux_browser_system("firefox", "firefox")
            + _probe_linux_browser_flatpak("firefox"))


def _probe_linux_brave():
    return (_probe_linux_browser_system("brave",
                                        "brave-browser", "brave",
                                        "brave-browser-stable")
            + _probe_linux_browser_flatpak("brave"))


def _probe_linux_chromium():
    return (_probe_linux_browser_system("chromium",
                                        "chromium-browser", "chromium")
            + _probe_linux_browser_flatpak("chromium"))


def _probe_linux_chrome():
    return (_probe_linux_browser_system("google-chrome",
                                        "google-chrome",
                                        "google-chrome-stable")
            + _probe_linux_browser_flatpak("google-chrome"))


_BROWSER_PROBES = {
    "linux":   [_probe_linux_firefox, _probe_linux_brave,
                _probe_linux_chromium, _probe_linux_chrome],
    "darwin":  [],
    "windows": [],
}


def action_browsers_list(params: "dict | None" = None) -> dict:
    available: "list[dict]" = []
    for probe in _BROWSER_PROBES.get(PLATFORM, []):
        try:
            rows = probe()
        except OSError as e:
            _log("browsers", "probe %s failed: %s", probe.__name__, e)
            continue
        if rows:
            available.extend(rows)
    return {"platform": PLATFORM, "available": available}


# ``http(s)://`` and ``acestream://`` are the only schemes the web ever
# hands to a browser. Anything else is either a mistake or a probe for a
# scheme handler we don't want to surface (file://, javascript:, etc.).
_URL_RE = re.compile(r"^(?:https?|acestream)://[^\s\x00-\x1f]{1,2048}$",
                     re.IGNORECASE)


def _resolve_argv(name: str, source: str) -> "list[str] | None":
    """Re-run ``browsers.list`` and pick the row matching name+source.

    The client only sends ``{name, source}`` — never argv. The broker
    is the only place that decides what executable to run, so a
    compromised web container can't ask us to spawn an arbitrary
    binary."""
    payload = action_browsers_list()
    for row in payload.get("available", []):
        if row.get("name") != name:
            continue
        if source and row.get("source") != source:
            continue
        argv = row.get("argv")
        if argv:
            return list(argv)
    return None


def action_browser_spawn(params: "dict | None" = None) -> dict:
    """Open ``url`` in the browser identified by ``{name, source}``.

    Returns ``{"opened": True, "name", "source"}`` on success or
    ``{"opened": False, "reason": ...}`` — never raises. Spawned
    detached so the browser outlives the broker request."""
    p = params or {}
    name = str(p.get("name", "")).strip()
    source = str(p.get("source", "")).strip()
    url = str(p.get("url", "")).strip()
    if not name:
        return {"opened": False, "reason": "missing name"}
    if not _URL_RE.match(url):
        return {"opened": False, "reason": "invalid url"}
    argv = _resolve_argv(name, source)
    if not argv:
        return {"opened": False,
                "reason": f"browser not found: {name}/{source or 'any'}"}
    try:
        subprocess.Popen(
            argv + [url],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
            close_fds=True,
            env=os.environ.copy(),
        )
    except OSError as e:
        _log("browsers", "spawn %s failed: %s", argv, e)
        return {"opened": False, "reason": f"spawn failed: {e}"}
    _log("browsers", "browser.spawn: opened %s in %s (%s)",
         url, name, source or "any")
    return {"opened": True, "name": name, "source": source}


def register(actions: dict) -> None:
    _register(actions, "browsers.list", action_browsers_list)
    _register(actions, "browser.spawn", action_browser_spawn)
