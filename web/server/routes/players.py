"""GET /api/players — host-side player probe via the broker."""

from __future__ import annotations

from ..context import RouteContext
from ..engine_client import EngineError
from ..http_io import Request, Response
from ..log_util import _log
from ..router import Router


def list_players(req: Request, ctx: RouteContext) -> Response:
    if not ctx.players_client:
        return Response.error(404, "player detection disabled")
    try:
        return Response.json(200, ctx.players_client.list())
    except EngineError as e:
        # Degrade to "no players known" rather than 502 — the UI
        # renders an empty list gracefully. `broker_error: true` is
        # the signal that this empty list is NOT authoritative; the
        # frontend uses it to schedule a one-shot retry instead of
        # leaving the user staring at a permanently empty dropdown
        # when the broker was merely slow (a cold `flatpak list`
        # blowing the broker.call timeout is the usual cause).
        _log("players", "broker call failed: %s", e)
        return Response.json(
            200, {"platform": "unknown", "available": [],
                  "broker_error": True})


def register(router: Router) -> None:
    router.get("/api/players", list_players)
