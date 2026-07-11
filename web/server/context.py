"""Routing context — the DI container handed to each route function.

Previously, route logic reached into ``Handler.engine_mgr``,
``Handler.store``, etc. — class-level globals that were impossible to
swap out for tests. Now a :class:`RouteContext` is built once by
``main()`` with whichever collaborators are configured, and route
functions take it as a parameter. Unit tests construct a
``RouteContext`` with stubs or in-memory fakes; nothing else has to
move.

``RouteContext`` is intentionally a dataclass with optional fields
so partially-wired contexts (e.g. tests that only need ``store``)
don't have to construct ten unrelated collaborators. Route handlers
check for ``None`` and return a 404 for disabled features — same
behaviour as the old Handler.
"""

from __future__ import annotations

import pathlib
from dataclasses import dataclass, field
from typing import Callable, Optional

from .broker_client import (
    BrowsersBrokerClient,
    DesktopBrokerClient,
    EngineBrokerClient,
    GpuBrokerClient,
    ImageBrokerClient,
    PlayersBrokerClient,
    SysBrokerClient,
    WebBrokerClient,
)
from .config_store import Config
from .favourites import FavStore
from .heartbeat import HeartbeatTracker
from .history import HistoryStore
from .probe_status_store import ProbeStatusStore
from .search import SearchProxy
from .unplayable_store import UnplayableStore


@dataclass
class RouteContext:
    engine: str = ""
    store: Optional[FavStore] = None
    history_store: Optional[HistoryStore] = None
    unplayable_store: Optional[UnplayableStore] = None
    probe_status_store: Optional[ProbeStatusStore] = None
    config: Optional[Config] = None
    config_path: Optional[pathlib.Path] = None
    config_dir: Optional[pathlib.Path] = None
    db_path: Optional[pathlib.Path] = None
    engine_mgr: Optional[EngineBrokerClient] = None
    gpu_client: Optional[GpuBrokerClient] = None
    image_mgr: Optional[ImageBrokerClient] = None
    players_client: Optional[PlayersBrokerClient] = None
    browsers_client: Optional[BrowsersBrokerClient] = None
    desktop_entry: Optional[DesktopBrokerClient] = None
    web_client: Optional[WebBrokerClient] = None
    sys_client: Optional[SysBrokerClient] = None
    search_proxy: Optional[SearchProxy] = None
    heartbeat: HeartbeatTracker = field(default_factory=HeartbeatTracker)
    # True when there's no Linux desktop the user can use at this server —
    # the page is served to a browser on another host: WSL (auto-detected),
    # a Lima VM on macOS, or a remote server. The frontend reads it via
    # /api/storage-mode and hides Linux-desktop-only affordances (App
    # launcher card, acestream:// scheme-handler registration) that can't
    # act on a desktop the user isn't at. Set from `aceman_web --wsl` /
    # `--no-local-desktop`.
    no_local_desktop: bool = False
    # Peek (don't consume) the pending-play cid that a second wrapper
    # invocation pushed via POST /api/play-request. The engine.status
    # route surfaces the value so the frontend's polling tab can claim
    # it via POST /api/play-request/claim. Returns "" when nothing's
    # pending. Injected as a callable so RouteContext stays a pure
    # data class and tests can stub it with a lambda.
    pending_play_cid_peek: Callable[[], str] = field(
        default_factory=lambda: (lambda: ""))
    # True when this web build's ffmpeg has an H.264 decoder, so the CPU
    # proxy path decodes + re-encodes (libx264 + auto-deinterlace) rather
    # than a bare -c:v copy remux. Surfaced on /api/gpu/status so the
    # frontend's pipeline label can say "CPU x264 · deint auto" instead of
    # the misleading "remux (no re-encode)". Callable because the ffmpeg
    # probe runs just after this context is built.
    cpu_reencode: Callable[[], bool] = field(
        default_factory=lambda: (lambda: False))
