"""Tests for the unplayable-channel log store."""

from __future__ import annotations

from . import _setup  # noqa: F401

import pathlib
import tempfile
import unittest

from server.unplayable_store import UnplayableStore


CID_A = "a" * 40
CID_B = "b" * 40


class UnplayableStoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.store = UnplayableStore(pathlib.Path(self.tmp.name) / "f.db")

    def test_record_and_list(self):
        self.store.record(CID_A, "Chan A", "unplayable", "no video stream")
        rows = self.store.list()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["cid"], CID_A)
        self.assertEqual(rows[0]["name"], "Chan A")
        self.assertEqual(rows[0]["state"], "unplayable")
        self.assertEqual(rows[0]["reason"], "no video stream")
        self.assertEqual(rows[0]["count"], 1)

    def test_reprobe_upserts_keeps_first_seen_bumps_count(self):
        self.store.record(CID_A, "Chan A", "dead", "offline")
        first = self.store.list()[0]["first_seen"]
        self.store.record(CID_A, "Chan A renamed", "unplayable", "bad codec")
        rows = self.store.list()
        self.assertEqual(len(rows), 1)                 # still one row
        self.assertEqual(rows[0]["first_seen"], first)  # preserved
        self.assertEqual(rows[0]["state"], "unplayable")  # latest verdict
        self.assertEqual(rows[0]["name"], "Chan A renamed")
        self.assertEqual(rows[0]["count"], 2)

    def test_non_failure_state_is_ignored(self):
        self.store.record(CID_A, "Chan A", "healthy", "")
        self.store.record(CID_B, "Chan B", "slow", "")
        self.assertEqual(self.store.list(), [])

    def test_delete_on_recovery(self):
        self.store.record(CID_A, "Chan A", "dead", "offline")
        self.assertTrue(self.store.delete(CID_A))
        self.assertEqual(self.store.list(), [])
        self.assertFalse(self.store.delete(CID_A))  # already gone

    def test_bad_cid_ignored(self):
        self.store.record("nope", "x", "dead", "")
        self.assertEqual(self.store.list(), [])

    def test_clear(self):
        self.store.record(CID_A, "A", "dead", "")
        self.store.record(CID_B, "B", "unreachable", "engine down")
        self.assertEqual(len(self.store.list()), 2)
        self.store.clear()
        self.assertEqual(self.store.list(), [])


if __name__ == "__main__":
    unittest.main()
