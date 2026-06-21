"""GET /api/gpu/status — host GPU capability probe via the broker."""

from __future__ import annotations

from ..context import RouteContext
from ..engine_client import EngineError
from ..http_io import Request, Response
from ..log_util import _log
from ..router import Router


def gpu_status(req: Request, ctx: RouteContext) -> Response:
    if not ctx.gpu_client:
        return Response.error(404, "GPU detection disabled")
    try:
        return Response.json(200, ctx.gpu_client.status())
    except EngineError as e:
        _log("gpu", "broker call failed: %s", e)
        return Response.json(200, {"available": False, "nvidia": None,
                                   "vaapi": None, "qsv": False})


def register(router: Router) -> None:
    router.get("/api/gpu/status", gpu_status)
