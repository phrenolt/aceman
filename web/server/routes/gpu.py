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
    # Whether the CPU proxy path re-encodes (has an H.264 decoder) vs. a
    # bare remux — the frontend pipeline label needs this to distinguish
    # "CPU x264 · deint auto" from "remux (no re-encode)".
    cpu_reencode = ctx.cpu_reencode()
    try:
        caps = dict(ctx.gpu_client.status())
        caps["cpu_reencode"] = cpu_reencode
        return Response.json(200, caps)
    except EngineError as e:
        _log("gpu", "broker call failed: %s", e)
        return Response.json(200, {"available": False, "nvidia": None,
                                   "vaapi": None, "qsv": False,
                                   "cpu_reencode": cpu_reencode})


def register(router: Router) -> None:
    router.get("/api/gpu/status", gpu_status)
