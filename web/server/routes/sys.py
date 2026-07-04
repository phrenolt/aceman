"""GET /api/sys/usage — live host CPU / GPU utilisation via the broker."""

from __future__ import annotations

from ..context import RouteContext
from ..engine_client import EngineError
from ..http_io import Request, Response
from ..log_util import _log
from ..router import Router

_UNAVAILABLE = {"cpu": None, "gpu": None, "gpu_kind": None, "window_secs": 10}


def sys_usage(req: Request, ctx: RouteContext) -> Response:
    if not ctx.sys_client:
        return Response.json(200, _UNAVAILABLE)
    try:
        return Response.json(200, ctx.sys_client.usage())
    except EngineError as e:
        _log("sys", "broker call failed: %s", e)
        return Response.json(200, _UNAVAILABLE)


def register(router: Router) -> None:
    router.get("/api/sys/usage", sys_usage)
