"""Tests for the wrapper-PID inspection module.

PID-reuse is the security-critical concern: a stale PID file pointing
at a recycled, unrelated process must NOT count as "wrapper alive" —
otherwise we'd refuse to start a new stream because some random other
user process happens to have the same PID.
"""

from __future__ import annotations

from . import _setup  # noqa: F401

import os
import pathlib
import tempfile
import unittest
import unittest.mock as mock

from aceman_broker import wrapper


class ReadWrapperPidTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.pid_file = pathlib.Path(self._tmp.name) / "aceman.active.pid"
        self._patch = mock.patch.object(
            wrapper, "wrapper_pid_file", return_value=self.pid_file)
        self._patch.start()
        self.addCleanup(self._patch.stop)

    def test_returns_none_when_file_missing(self):
        self.assertIsNone(wrapper.read_wrapper_pid())

    def test_parses_valid_pid(self):
        self.pid_file.write_text("12345\n")
        self.assertEqual(wrapper.read_wrapper_pid(), 12345)

    def test_returns_none_for_empty_file(self):
        self.pid_file.write_text("")
        self.assertIsNone(wrapper.read_wrapper_pid())

    def test_returns_none_for_garbage(self):
        for bad in ("not-a-pid", "\x00\x01", "12.5", "1 2 3",
                    " ", "1; rm -rf /"):
            with self.subTest(bad=bad):
                self.pid_file.write_text(bad)
                self.assertIsNone(wrapper.read_wrapper_pid())

    def test_rejects_pid_one_and_below(self):
        # PID 0 is the kernel; PID 1 is init / systemd. Neither
        # should ever be our wrapper, and signalling them by mistake
        # would be catastrophic.
        for bad in ("0", "1", "-1"):
            with self.subTest(bad=bad):
                self.pid_file.write_text(bad)
                self.assertIsNone(wrapper.read_wrapper_pid())


class PidMatchesAcemanTests(unittest.TestCase):
    """The PID-reuse guard. Without this check, killing a recycled
    PID could SIGTERM an unrelated user process."""

    def test_returns_false_for_missing_proc_entry(self):
        # Pick a PID that is almost certainly not in use.
        self.assertFalse(wrapper.pid_matches_aceman(999_999_999))

    def test_returns_false_for_unrelated_process(self):
        # The current Python process running this test is NOT named
        # "aceman" in its cmdline. Use our own PID as a stand-in for
        # "some other process".
        self.assertFalse(wrapper.pid_matches_aceman(os.getpid()))

    def test_matches_when_cmdline_contains_aceman(self):
        # Synthesise a fake /proc/PID/cmdline by patching the read.
        fake_cmdline = b"bash\0/home/user/aceman\0acestream://aaaa\0"
        with mock.patch("aceman_broker.wrapper.pathlib.Path") as P:
            inst = mock.MagicMock()
            inst.read_bytes.return_value = fake_cmdline
            P.return_value = inst
            self.assertTrue(wrapper.pid_matches_aceman(12345))


class WrapperCidTests(unittest.TestCase):
    """The cid file is the second half of the active-session record.
    Validation here is the line between "broker hands the web a
    trustworthy 40-hex string" and "broker forwards whatever the
    file contained". Anything not strictly 40 hex must come back as
    empty so the frontend's display / lookup path can't be smuggled
    arbitrary text."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.cid_file = pathlib.Path(self._tmp.name) / "aceman.active.cid"
        self._patch = mock.patch.object(
            wrapper, "wrapper_cid_file", return_value=self.cid_file)
        self._patch.start()
        self.addCleanup(self._patch.stop)

    def test_returns_empty_when_file_missing(self):
        self.assertEqual(wrapper.wrapper_cid(), "")

    def test_returns_empty_for_empty_file(self):
        self.cid_file.write_text("")
        self.assertEqual(wrapper.wrapper_cid(), "")

    def test_parses_valid_lowercase_cid(self):
        cid = "a" * 40
        self.cid_file.write_text(cid + "\n")
        self.assertEqual(wrapper.wrapper_cid(), cid)

    def test_uppercase_normalised_to_lowercase(self):
        self.cid_file.write_text("DEADBEEF" * 5)
        self.assertEqual(wrapper.wrapper_cid(), "deadbeef" * 5)

    def test_strips_surrounding_whitespace(self):
        cid = "1234567890" * 4
        self.cid_file.write_text(f"  {cid}\n\n")
        self.assertEqual(wrapper.wrapper_cid(), cid)

    def test_rejects_non_hex_chars(self):
        # Z is not hex.
        self.cid_file.write_text("Z" + "a" * 39)
        self.assertEqual(wrapper.wrapper_cid(), "")

    def test_rejects_wrong_length(self):
        for bad in ("a", "a" * 39, "a" * 41, "a" * 80):
            with self.subTest(length=len(bad)):
                self.cid_file.write_text(bad)
                self.assertEqual(wrapper.wrapper_cid(), "")

    def test_rejects_injection_attempts(self):
        # Even prefix-valid inputs must come back empty unless the
        # whole content is exactly 40 hex.
        for evil in (
            "a" * 40 + "\nrm -rf /",
            "a" * 40 + " && curl evil",
            "a" * 39 + "z",
            "<script>" + "a" * 32,
            "../../etc/passwd",
            "\x00" * 40,
            ("a" * 40) + ("a" * 40),  # double-length
        ):
            with self.subTest(evil=evil[:20]):
                self.cid_file.write_text(evil)
                self.assertEqual(wrapper.wrapper_cid(), "")

    def test_oserror_on_read_returns_empty(self):
        # File-permission glitch or similar — fail safe to empty
        # rather than letting the exception propagate.
        with mock.patch.object(pathlib.Path, "read_text",
                               side_effect=OSError("nope")):
            self.cid_file.write_text("a" * 40)  # exists, but read fails
            self.assertEqual(wrapper.wrapper_cid(), "")


class WrapperAliveTests(unittest.TestCase):
    def test_returns_false_when_pid_unreadable(self):
        with mock.patch.object(wrapper, "read_wrapper_pid",
                               return_value=None):
            self.assertFalse(wrapper.wrapper_alive())

    def test_returns_false_when_pid_does_not_match_aceman(self):
        with mock.patch.object(wrapper, "read_wrapper_pid",
                               return_value=999_999),\
             mock.patch.object(wrapper, "pid_matches_aceman",
                               return_value=False):
            self.assertFalse(wrapper.wrapper_alive())

    def test_returns_true_when_both_signals_align(self):
        with mock.patch.object(wrapper, "read_wrapper_pid",
                               return_value=12345),\
             mock.patch.object(wrapper, "pid_matches_aceman",
                               return_value=True):
            self.assertTrue(wrapper.wrapper_alive())


if __name__ == "__main__":
    unittest.main()
