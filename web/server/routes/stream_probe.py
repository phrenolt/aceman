"""Channel health-probe routes.

  * ``POST   /api/stream/probe``      — probe one channel (optionally deep).
  * ``GET    /api/probe-status``      — cached per-cid verdicts, to repaint markers.
  * ``DELETE /api/probe-status``      — clear every cached verdict (probe cache).
  * ``GET    /api/unplayable``        — list the logged can't-play channels.
  * ``GET    /api/unplayable/export`` — the same list as a download.
  * ``DELETE /api/unplayable``        — clear the log.

A probe answers "would this channel actually stream right now?" without
disturbing playback: it opens a session on a reserved pid (concurrent with,
and harmless to, the default-pid playback session), times the first byte, and
releases. A ``max_age_secs`` in the body skips the engine work entirely when a
verdict that recent is already cached (freshness window). ``deep`` additionally
ffprobes the format so an ``unplayable`` verdict
becomes possible — and, when deep, every can't-play result is logged (and every
recovered channel un-logged) so the list can be exported for a bug report. The
verdict + orchestration live in ``server.probe``; this module is the HTTP shell,
a concurrency bound, and the failure-log bookkeeping.
"""

from __future__ import annotations

import json
import threading
import time

from ..constants import HEX40
from ..context import RouteContext
from ..http_io import Request, Response
from ..probe import probe_stream
from ..router import Router
from ..unplayable_store import FAILURE_STATES

# Bound concurrent probes: each holds a short-lived engine session for up to
# the probe deadline. Non-blocking acquire → shed excess load with 503 rather
# than piling up handler threads. This is the HARD ceiling behind the (smaller,
# user-configurable) frontend agent count — a safety backstop, not the normal
# limit. Set empirically: a ramp test against the live engine degraded
# (connection resets) around 32 distinct-channel sessions and crashed the
# gateway around 48 — a session/connection limit, not memory (the gateway died
# at ~44 MB of 134 MB). 8 leaves a ~4x margin under degradation, with room for a
# concurrent playback session.
_MAX_CONCURRENT_PROBES = 8
_probe_sema = threading.BoundedSemaphore(_MAX_CONCURRENT_PROBES)


def stream_probe(req: Request, ctx: RouteContext) -> Response:
    cid = req.body.get("cid")
    if not isinstance(cid, str) or not HEX40.match(cid):
        return Response.error(400, "cid must be 40 hex characters")
    deep = bool(req.body.get("deep"))
    name = req.body.get("name")
    name = name.strip() if isinstance(name, str) else ""
    cid = cid.lower()
    # Freshness window (seconds): a verdict this recent is reused verbatim, so a
    # re-probe of the same page — or a rapid continuous-search retrigger —
    # doesn't hit the engine again. 0 / missing disables the skip (force probe).
    max_age = req.body.get("max_age_secs")
    max_age = int(max_age) if isinstance(max_age, (int, float)) and max_age > 0 else 0

    if max_age and ctx.probe_status_store:
        cached = ctx.probe_status_store.get(cid)
        if cached and cached.get("age_secs") is not None \
                and cached["age_secs"] <= max_age:
            return Response.json(200, {
                "cid": cid, "state": cached["state"],
                "detail": cached["detail"],
                "probed_at": cached["probed_at"], "cached": True,
            })

    if not _probe_sema.acquire(blocking=False):
        return Response.error(503, "too many concurrent probes")
    try:
        result = probe_stream(ctx.engine, cid, deep=deep)
    finally:
        _probe_sema.release()

    # Cache the verdict (any state) so the marker survives a reload. Independent
    # of deep mode — a shallow healthy/dead result is worth remembering too.
    if ctx.probe_status_store:
        ctx.probe_status_store.record(
            cid, result.get("state"), result.get("detail"))
        stored = ctx.probe_status_store.get(cid)
        result["probed_at"] = stored["probed_at"] if stored else None
    result["cached"] = False

    # Deep mode doubles as diagnostic logging: record failures, clear
    # recoveries, so the exportable list stays a current snapshot.
    if deep and ctx.unplayable_store:
        state = result.get("state")
        if state in FAILURE_STATES:
            ctx.unplayable_store.record(
                cid, name, state,
                (result.get("detail") or {}).get("reason") or "")
        else:
            ctx.unplayable_store.delete(cid)
    return Response.json(200, result)


def probe_status(req: Request, ctx: RouteContext) -> Response:
    """Every cached probe verdict, so the frontend can repaint markers on load
    without re-probing. Empty list when the cache is disabled — the UI just
    starts with no markers, same as a fresh probe run."""
    if not ctx.probe_status_store:
        return Response.json(200, [])
    return Response.json(200, ctx.probe_status_store.list())


def clear_probe_status(req: Request, ctx: RouteContext) -> Response:
    """Wipe every cached verdict — the "Clear probe cache" action. Resets all
    channels back to unprobed so the next run re-checks from scratch."""
    if not ctx.probe_status_store:
        return Response.json(200, {"ok": True})   # nothing stored to clear
    ctx.probe_status_store.clear()
    return Response.json(200, {"ok": True})


def list_unplayable(req: Request, ctx: RouteContext) -> Response:
    if not ctx.unplayable_store:
        return Response.error(404, "server-side storage disabled")
    return Response.json(200, ctx.unplayable_store.list())


def export_unplayable(req: Request, ctx: RouteContext) -> Response:
    """Same rows as list_unplayable, but as a downloadable, timestamped JSON
    attachment the user can hand to whoever is diagnosing the failures."""
    if not ctx.unplayable_store:
        return Response.error(404, "server-side storage disabled")
    rows = ctx.unplayable_store.list()
    payload = {
        "exported_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "count": len(rows),
        "channels": rows,
    }
    fname = "aceman-unplayable-" + time.strftime("%Y%m%d-%H%M%S") + ".json"
    return Response(
        status=200,
        body=json.dumps(payload, indent=2).encode("utf-8"),
        content_type="application/json; charset=utf-8",
        extra_headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


def clear_unplayable(req: Request, ctx: RouteContext) -> Response:
    if not ctx.unplayable_store:
        return Response.error(404, "server-side storage disabled")
    ctx.unplayable_store.clear()
    return Response.json(200, {"ok": True})


def register(router: Router) -> None:
    router.post("/api/stream/probe", stream_probe)
    router.get("/api/probe-status", probe_status)
    router.delete("/api/probe-status", clear_probe_status)
    router.get("/api/unplayable", list_unplayable)
    router.get("/api/unplayable/export", export_unplayable)
    router.delete("/api/unplayable", clear_unplayable)
