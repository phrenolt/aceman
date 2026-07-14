"""Android-TV box IP store.

Remembers the IPs of Android TV boxes cast to (the "Play in → Android TV"
target), so the combobox on the player card is populated server-side —
shared across browsers/devices, unlike the old per-browser localStorage.

Shares the same SQLite file as :class:`FavStore` / :class:`HistoryStore`.
One row per IP; ``record`` upserts and bumps ``last_used`` so ``list``
returns most-recently-used first. Capped so the table never grows without
bound.
"""

from __future__ import annotations

import contextlib
import pathlib
import re
import sqlite3
import threading

_MAX_ROWS = 50
# Strict IPv4 — the only thing ever stored is a dotted-quad the user cast to.
_IPV4_RE = re.compile(
    r"\A(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\Z")


def valid_ip(ip) -> bool:
    return isinstance(ip, str) and bool(_IPV4_RE.match(ip.strip()))


class TvIpStore:
    def __init__(self, db_path: pathlib.Path):
        self.db_path = db_path
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        with self._conn() as c:
            # `seq` is a monotonic bump counter, not a timestamp: it orders
            # "most-recently-used first" independent of the clock (two records
            # in the same second must still order correctly — a wall-clock
            # column at 1s resolution can't do that).
            c.execute(
                "CREATE TABLE IF NOT EXISTS tv_ip ("
                "  ip  TEXT PRIMARY KEY,"
                "  seq INTEGER NOT NULL"
                ")"
            )

    @contextlib.contextmanager
    def _conn(self):
        # `with c:` runs the transaction; the finally CLOSES the connection
        # (a bare `with sqlite3.connect(...)` only ends the transaction and
        # leaks the handle — same pattern as HistoryStore).
        c = sqlite3.connect(self.db_path, timeout=5)
        try:
            with c:
                yield c
        finally:
            c.close()

    def record(self, ip: str) -> bool:
        """Upsert the IP and bump it to most-recent. Returns False for a
        non-IPv4 value (nothing written)."""
        if not valid_ip(ip):
            return False
        ip = ip.strip()
        with self._lock, self._conn() as c:
            # New/updated row gets a fresh top-of-stack seq. On conflict the
            # subquery sees the existing row's seq too, so max+1 still bumps
            # it strictly above every other entry.
            c.execute(
                "INSERT INTO tv_ip(ip, seq) "
                "VALUES (?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM tv_ip)) "
                "ON CONFLICT(ip) DO UPDATE SET "
                "  seq=(SELECT COALESCE(MAX(seq), 0) + 1 FROM tv_ip)",
                (ip,),
            )
            # Trim to cap, keeping the most-recently-used rows.
            c.execute(
                "DELETE FROM tv_ip WHERE ip NOT IN ("
                "  SELECT ip FROM tv_ip ORDER BY seq DESC LIMIT ?)",
                (_MAX_ROWS,),
            )
        return True

    def list(self) -> "list[str]":
        with self._lock, self._conn() as c:
            rows = c.execute(
                "SELECT ip FROM tv_ip ORDER BY seq DESC").fetchall()
        return [ip for (ip,) in rows]

    def delete(self, ip: str) -> bool:
        if not valid_ip(ip):
            return False
        with self._lock, self._conn() as c:
            cur = c.execute("DELETE FROM tv_ip WHERE ip = ?", (ip.strip(),))
        return cur.rowcount > 0
