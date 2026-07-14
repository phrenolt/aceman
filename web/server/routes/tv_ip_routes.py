"""GET / POST / DELETE /api/tv/ips — the remembered Android-TV box IPs.

The player-card "Android TV" combobox reads this list (server-side, shared
across browsers). Successful casts also record here via the cast route, so
POST is mostly for an explicit "save this IP" and is harmless to omit.
"""

from __future__ import annotations

from ..context import RouteContext
from ..http_io import Request, Response
from ..router import Router
from ..tv_ip_store import valid_ip


def list_ips(req: Request, ctx: RouteContext) -> Response:
    if not ctx.tv_ip_store:
        return Response.error(404, "server-side storage disabled")
    return Response.json(200, ctx.tv_ip_store.list())


def record_ip(req: Request, ctx: RouteContext) -> Response:
    if not ctx.tv_ip_store:
        return Response.error(404, "server-side storage disabled")
    if not isinstance(req.body, dict):
        return Response.error(400, "json body required")
    ip = (req.body.get("ip") or "").strip()
    if not valid_ip(ip):
        return Response.error(400, "ip must be a valid IPv4 address")
    ctx.tv_ip_store.record(ip)
    return Response.json(200, {"ok": True})


def delete_ip(req: Request, ctx: RouteContext) -> Response:
    if not ctx.tv_ip_store:
        return Response.error(404, "server-side storage disabled")
    ip = req.path_params.get("ip", "").strip()
    if not ctx.tv_ip_store.delete(ip):
        return Response.error(404, "not found")
    return Response.json(200, {"ok": True})


def register(router: Router) -> None:
    router.get("/api/tv/ips", list_ips)
    router.post("/api/tv/ips", record_ip)
    router.delete("/api/tv/ips/{ip}", delete_ip)
