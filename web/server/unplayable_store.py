"""Log of channels that failed a (deep) health-probe.

Populated only while the Library "check playability" setting is on: each
channel that probes as ``unplayable`` / ``dead`` / ``unreachable`` is upserted
here with the reason, so the list can be exported for a bug report ("these
channels don't play, and here's why"). A channel that later probes healthy is
removed — the table stays a current snapshot of what's broken, not a growing
history.

Shares the same SQLite file as :class:`FavStore` / :class:`HistoryStore`. One
row per cid; capped so it can never grow unboundedly.
"""

from __future__ import annotations

import contextlib
import pathlib
import sqlite3
import threading

from .constants import HEX40

_MAX_ROWS = 2000
# Only these probe verdicts are "couldn't play" — everything else means the
# channel works, so it must not land in (and should be cleared from) the log.
FAILURE_STATES = ("unplayable", "dead", "unreachable")


class UnplayableStore:
    def __init__(self, db_path: pathlib.Path):
        self.db_path = db_path
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        with self._conn() as c:
            c.execute(
                "CREATE TABLE IF NOT EXISTS unplayable_channels ("
                "  cid        TEXT PRIMARY KEY,"
                "  name       TEXT NOT NULL DEFAULT '',"
                "  state      TEXT NOT NULL,"
                "  reason     TEXT NOT NULL DEFAULT '',"
                "  first_seen TEXT NOT NULL,"
                "  last_seen  TEXT NOT NULL,"
                "  count      INTEGER NOT NULL DEFAULT 1"
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

    def record(self, cid: str, name: str, state: str, reason: str = "") -> None:
        """Upsert a failure. Keeps the original first_seen, bumps last_seen +
        count, and refreshes name/state/reason. No-op for a non-failure state
        (call :meth:`delete` for a recovered channel)."""
        if not HEX40.match(cid) or state not in FAILURE_STATES:
            return
        with self._lock, self._conn() as c:
            c.execute(
                "INSERT INTO unplayable_channels"
                "  (cid, name, state, reason, first_seen, last_seen, count) "
                "VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), 1) "
                "ON CONFLICT(cid) DO UPDATE SET "
                "  name=excluded.name, state=excluded.state,"
                "  reason=excluded.reason, last_seen=excluded.last_seen,"
                "  count=unplayable_channels.count + 1",
                (cid.lower(), name or "", state, reason or ""),
            )
            c.execute(
                "DELETE FROM unplayable_channels WHERE cid NOT IN ("
                "  SELECT cid FROM unplayable_channels "
                "  ORDER BY last_seen DESC LIMIT ?)",
                (_MAX_ROWS,),
            )

    def delete(self, cid: str) -> bool:
        """Drop a channel's record — used when it later probes healthy."""
        if not HEX40.match(cid):
            return False
        with self._lock, self._conn() as c:
            cur = c.execute(
                "DELETE FROM unplayable_channels WHERE cid = ?", (cid.lower(),))
        return cur.rowcount > 0

    def list(self) -> list[dict]:
        with self._lock, self._conn() as c:
            rows = c.execute(
                "SELECT cid, name, state, reason, first_seen, last_seen, count "
                "FROM unplayable_channels ORDER BY last_seen DESC").fetchall()
        return [
            {"cid": cid, "name": name, "state": state, "reason": reason,
             "first_seen": fs, "last_seen": ls, "count": count}
            for cid, name, state, reason, fs, ls, count in rows
        ]

    def clear(self) -> None:
        with self._lock, self._conn() as c:
            c.execute("DELETE FROM unplayable_channels")
