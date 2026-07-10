"""Tests for ProbeStatusStore — the per-cid health cache that repaints markers."""

from __future__ import annotations

from . import _setup  # noqa: F401

import pathlib
import tempfile
import unittest

from server.probe_status_store import ProbeStatusStore

CID = "a" * 40
CID2 = "b" * 40


class ProbeStatusStoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = ProbeStatusStore(pathlib.Path(self.tmp.name) / "s.db")

    def tearDown(self):
        self.tmp.cleanup()

    def test_records_all_states_including_healthy(self):
        self.store.record(CID, "healthy", {"first_byte_secs": 0.08})
        rows = self.store.list()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["cid"], CID)
        self.assertEqual(rows[0]["state"], "healthy")
        self.assertAlmostEqual(rows[0]["detail"]["first_byte_secs"], 0.08)

    def test_upsert_overwrites_prior_verdict(self):
        self.store.record(CID, "dead", {})
        self.store.record(CID, "healthy", {"first_byte_secs": 0.2})
        rows = self.store.list()
        self.assertEqual(len(rows), 1)          # still one row for the cid
        self.assertEqual(rows[0]["state"], "healthy")

    def test_reason_persisted_for_unplayable(self):
        self.store.record(CID, "unplayable", {"reason": "no video stream"})
        self.assertEqual(self.store.list()[0]["detail"]["reason"], "no video stream")

    def test_bad_cid_or_empty_state_ignored(self):
        self.store.record("nope", "healthy", {})
        self.store.record(CID, "", {})
        self.assertEqual(self.store.list(), [])

    def test_missing_first_byte_is_none(self):
        self.store.record(CID, "dead", {})
        self.assertIsNone(self.store.list()[0]["detail"]["first_byte_secs"])

    def test_clear_empties(self):
        self.store.record(CID, "healthy", {})
        self.store.record(CID2, "dead", {})
        self.store.clear()
        self.assertEqual(self.store.list(), [])

    def test_get_returns_age_and_verdict(self):
        self.store.record(CID, "healthy", {"first_byte_secs": 0.1})
        row = self.store.get(CID)
        self.assertIsNotNone(row)
        self.assertEqual(row["state"], "healthy")
        self.assertIn("age_secs", row)
        self.assertIsNotNone(row["age_secs"])
        self.assertGreaterEqual(row["age_secs"], 0)     # just-probed → ~0s old
        self.assertLess(row["age_secs"], 5)

    def test_get_missing_is_none(self):
        self.assertIsNone(self.store.get(CID))
        self.assertIsNone(self.store.get("not-a-cid"))

    def test_list_shape_matches_marker_contract(self):
        self.store.record(CID, "slow", {"first_byte_secs": 5.0, "reason": ""})
        row = self.store.list()[0]
        self.assertEqual(set(row), {"cid", "state", "probed_at", "detail"})
        self.assertEqual(set(row["detail"]), {"reason", "first_byte_secs"})


if __name__ == "__main__":
    unittest.main()
