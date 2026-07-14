"""Tests for TvIpStore."""

from __future__ import annotations

from . import _setup  # noqa: F401

import pathlib
import tempfile
import unittest

from server.tv_ip_store import TvIpStore, valid_ip


class TvIpStoreTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.store = TvIpStore(pathlib.Path(self._tmp.name) / "db.sqlite")

    def test_valid_ip(self):
        self.assertTrue(valid_ip("192.168.1.50"))
        self.assertTrue(valid_ip("  10.0.0.1  "))
        self.assertFalse(valid_ip("256.0.0.1"))
        self.assertFalse(valid_ip("192.168.1"))
        self.assertFalse(valid_ip("1.2.3.4; rm -rf /"))
        self.assertFalse(valid_ip("example.com"))
        self.assertFalse(valid_ip(None))

    def test_record_and_list(self):
        self.assertTrue(self.store.record("192.168.1.5"))
        self.assertTrue(self.store.record("192.168.1.6"))
        # Most-recently-recorded first.
        self.assertEqual(self.store.list(), ["192.168.1.6", "192.168.1.5"])

    def test_record_dedupes_and_bumps(self):
        self.store.record("192.168.1.5")
        self.store.record("192.168.1.6")
        self.store.record("192.168.1.5")   # re-use bumps to front, no dup
        self.assertEqual(self.store.list(), ["192.168.1.5", "192.168.1.6"])

    def test_record_trims_whitespace(self):
        self.store.record("  10.0.0.9  ")
        self.assertEqual(self.store.list(), ["10.0.0.9"])

    def test_record_rejects_bad_ip(self):
        self.assertFalse(self.store.record("not-an-ip"))
        self.assertFalse(self.store.record("999.1.1.1"))
        self.assertEqual(self.store.list(), [])

    def test_delete(self):
        self.store.record("192.168.1.5")
        self.store.record("192.168.1.6")
        self.assertTrue(self.store.delete("192.168.1.5"))
        self.assertEqual(self.store.list(), ["192.168.1.6"])
        # deleting a missing / invalid ip returns False
        self.assertFalse(self.store.delete("192.168.1.5"))
        self.assertFalse(self.store.delete("bad"))

    def test_cap(self):
        for i in range(60):
            self.store.record(f"10.0.0.{i % 256}" if i < 256 else "10.0.0.1")
        # 50-row cap (default _MAX_ROWS)
        self.assertLessEqual(len(self.store.list()), 50)


if __name__ == "__main__":
    unittest.main()
