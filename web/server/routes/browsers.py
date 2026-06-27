"""GET /api/browsers — host-side browser probe via the broker.

Strips the host-side ``argv`` from each row before sending; the UI
only needs ``name`` and ``source`` to render the dropdown, and the
argv is host filesystem detail that has no business reaching the
page.
"""

from __future__ import annotations

from ..context import RouteContext
from ..engine_client import EngineError
from ..http_io import Request, Response
from ..log_util import _log
from ..router import Router


def list_browsers(req: Request, ctx: RouteContext) -> Response:
    if not ctx.browsers_client:
        return Response.error(404, "browser detection disabled")
    try:
        payload = ctx.browsers_client.list()
    except EngineError as e:
        # `broker_error: true` marks this empty list as non-authoritative
        # so the frontend can schedule a retry. See the same comment in
        # routes/players.py for the why (cold flatpak list blowing the
        # broker.call budget is the typical trigger).
        _log("browsers", "broker call failed: %s", e)
        payload = {"platform": "unknown", "available": [],
                   "broker_error": True}
    for row in payload.get("available", []):
        row.pop("argv", None)
    return Response.json(200, payload)


def register(router: Router) -> None:
    router.get("/api/browsers", list_browsers)
