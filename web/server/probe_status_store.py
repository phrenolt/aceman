"""Last-known health per channel, so probe markers survive a page reload.

Every probe result — healthy / slow / unplayable / dead / unreachable — is
upserted here keyed by cid. On load the Library repaints each row's marker from
this cache instead of re-probing, so a channel you already checked keeps its
green / amber / orange / red dot across refreshes, in Favourites and History
(both cid-keyed) alike.

This is ephemeral UI cache, deliberately distinct from :class:`UnplayableStore`:
that store is the user-curated, *exportable* can't-play log (with hit counts,
cleared on demand for a bug report); this one just remembers the latest verdict
for painting and is overwritten on every re-probe. Different lifecycles, so
different tables.

Shares the same SQLite file as the other stores. One row per cid; capped so it
can never grow unboundedly.
"""

from __future__ import annotations

import contextlib
import pathlib
import sqlite3
import threading

from .constants import HEX40

_MAX_ROWS = 5000


class ProbeStatusStore:
    def __init__(self, db_path: pathlib.Path):
        self.db_path = db_path
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        with self._conn() as c:
            c.execute(
                "CREATE TABLE IF NOT EXISTS probe_status ("
                "  cid             TEXT PRIMARY KEY,"
                "  state           TEXT NOT NULL,"
                "  reason          TEXT NOT NULL DEFAULT '',"
                "  first_byte_secs REAL,"
                "  probed_at       TEXT NOT NULL"
                ")"
            )

    @contextlib.contextmanager
    def _conn(self):
        c = sqlite3.connect(self.db_path, timeout=5)
        try:
            with c:
                yield c
        finally:
            c.close()

    def record(self, cid: str, state: str, detail: "dict | None" = None) -> None:
        """Upsert the latest verdict for `cid`. Any real state is stored (this
        is a health cache, not a failure log); an empty state or bad cid is a
        no-op. `detail` is the probe's detail dict — only reason +
        first_byte_secs are persisted (the rest is transient)."""
        if not HEX40.match(cid) or not state:
            return
        detail = detail or {}
        reason = detail.get("reason") or ""
        fbs = detail.get("first_byte_secs")
        fbs = float(fbs) if isinstance(fbs, (int, float)) else None
        with self._lock, self._conn() as c:
            c.execute(
                "INSERT INTO probe_status"
                "  (cid, state, reason, first_byte_secs, probed_at) "
                "VALUES (?, ?, ?, ?, datetime('now')) "
                "ON CONFLICT(cid) DO UPDATE SET "
                "  state=excluded.state, reason=excluded.reason,"
                "  first_byte_secs=excluded.first_byte_secs,"
                "  probed_at=excluded.probed_at",
                (cid.lower(), state, reason, fbs),
            )
            c.execute(
                "DELETE FROM probe_status WHERE cid NOT IN ("
                "  SELECT cid FROM probe_status "
                "  ORDER BY probed_at DESC LIMIT ?)",
                (_MAX_ROWS,),
            )

    def get(self, cid: str) -> "dict | None":
        """The cached verdict for one cid, with `age_secs` (seconds since it was
        probed, on the DB clock) so callers can apply a freshness window.
        None if never probed."""
        if not HEX40.match(cid):
            return None
        with self._lock, self._conn() as c:
            row = c.execute(
                "SELECT cid, state, reason, first_byte_secs, probed_at,"
                "  CAST(strftime('%s','now') - strftime('%s', probed_at) AS INTEGER) "
                "FROM probe_status WHERE cid = ?", (cid.lower(),)).fetchone()
        if not row:
            return None
        cid_, state, reason, fbs, pa, age = row
        return {"cid": cid_, "state": state, "probed_at": pa,
                "age_secs": age,
                "detail": {"reason": reason, "first_byte_secs": fbs}}

    def list(self) -> list[dict]:
        """Every cached verdict, newest first, in the frontend's
        `{cid, state, detail}` marker shape."""
        with self._lock, self._conn() as c:
            rows = c.execute(
                "SELECT cid, state, reason, first_byte_secs, probed_at "
                "FROM probe_status ORDER BY probed_at DESC").fetchall()
        return [
            {"cid": cid, "state": state, "probed_at": pa,
             "detail": {"reason": reason, "first_byte_secs": fbs}}
            for cid, state, reason, fbs, pa in rows
        ]

    def clear(self) -> None:
        with self._lock, self._conn() as c:
            c.execute("DELETE FROM probe_status")
