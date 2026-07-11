"""Tests for stream health probing.

The verdict must be right (users act on the health markers) and the engine
session must ALWAYS be released — a leaked probe session would break the next
playback's single-slot handoff.
"""

from __future__ import annotations

from . import _setup  # noqa: F401

import unittest
import unittest.mock as mock

import json
import subprocess

from server.engine_client import EngineError
from server import probe
from server.probe import classify_probe, probe_stream, _num, _ffprobe_playable


ENGINE = "http://127.0.0.1:6878"
CID = "a" * 40


class ClassifyProbeTests(unittest.TestCase):
    """Pure verdict from time-to-first-byte."""

    def test_no_byte_is_dead(self):
        self.assertEqual(classify_probe(None), "dead")

    def test_fast_first_byte_is_healthy(self):
        # Phase-0 healthy streams delivered in 8-299 ms.
        self.assertEqual(classify_probe(0.008), "healthy")
        self.assertEqual(classify_probe(0.299), "healthy")

    def test_late_first_byte_is_slow(self):
        self.assertEqual(classify_probe(6.0), "slow")

    def test_boundary_is_inclusive_healthy(self):
        self.assertEqual(classify_probe(4.0, slow_after=4.0), "healthy")
        self.assertEqual(classify_probe(4.01, slow_after=4.0), "slow")


class NumCoerceTests(unittest.TestCase):
    def test_coerces_and_rejects(self):
        self.assertEqual(_num(7), 7)
        self.assertEqual(_num("7"), 7)
        self.assertIsNone(_num(None))
        self.assertIsNone(_num("nan"))
        self.assertIsNone(_num({}))


class ReadFirstByteTests(unittest.TestCase):
    """The warm-up retry: a cold source that misses the first deadline but
    delivers on a later attach must be read as reachable, not dead."""

    def _reader(self, data):
        r = mock.MagicMock()
        r.read.return_value = data
        r.__enter__.return_value = r
        r.__exit__.return_value = False
        return r

    def test_retries_after_cold_timeout(self):
        # First attach times out (cold sourcing); the second delivers bytes.
        with mock.patch("server.probe.urllib.request.urlopen",
                        side_effect=[TimeoutError("cold"), self._reader(b"x" * 8)]):
            t = probe._read_first_byte("http://x/ace/r/A", 0.01, attempts=2)
        self.assertIsNotNone(t)

    def test_dead_when_every_attempt_times_out(self):
        with mock.patch("server.probe.urllib.request.urlopen",
                        side_effect=TimeoutError("dead")):
            t = probe._read_first_byte("http://x/ace/r/A", 0.01, attempts=2)
        self.assertIsNone(t)

    def test_empty_reads_retry_then_give_up(self):
        with mock.patch("server.probe.urllib.request.urlopen",
                        side_effect=[self._reader(b""), self._reader(b"")]):
            t = probe._read_first_byte("http://x/ace/r/A", 0.01, attempts=2)
        self.assertIsNone(t)

    def test_first_attempt_success_does_not_retry(self):
        with mock.patch("server.probe.urllib.request.urlopen",
                        return_value=self._reader(b"data")) as m:
            t = probe._read_first_byte("http://x/ace/r/A", 0.01, attempts=2)
        self.assertIsNotNone(t)
        self.assertEqual(m.call_count, 1)   # no wasted retry on a live channel


class FfprobePlayableTests(unittest.TestCase):
    """Format identification via ffprobe — the deep-probe verdict."""

    def _cp(self, *, returncode=0, stdout="", stderr=""):
        return subprocess.CompletedProcess(
            args=[], returncode=returncode, stdout=stdout, stderr=stderr)

    def _run(self, *, returncode=0, stdout="", stderr=""):
        return mock.patch(
            "server.probe.subprocess.run",
            return_value=self._cp(returncode=returncode, stdout=stdout, stderr=stderr))

    def test_video_stream_is_playable(self):
        # A single ffprobe stream-identification call is the whole deep check:
        # if it lists a usable audio/video stream, the channel is playable.
        # (We do NOT decode frames — measured against real channels, a healthy
        # live h264 feed and a corrupt HEVC one are indistinguishable by frame
        # count, so a decode check only produces false positives.)
        with self._run(stdout=json.dumps({"streams": [
                {"codec_type": "video", "codec_name": "h264"},
                {"codec_type": "audio", "codec_name": "aac"}]})):
            ok, reason = _ffprobe_playable("http://x/ace/r/A")
        self.assertTrue(ok)
        self.assertIn("h264", reason)

    def test_no_streams_is_unplayable(self):
        with self._run(stdout=json.dumps({"streams": []})):
            ok, reason = _ffprobe_playable("http://x/ace/r/A")
        self.assertFalse(ok)
        self.assertIn("no audio or video", reason)

    def test_ffprobe_error_surfaces_reason(self):
        with self._run(returncode=1, stderr="Invalid data found\x1b[0m when processing input"):
            ok, reason = _ffprobe_playable("http://x/ace/r/A")
        self.assertFalse(ok)
        self.assertIn("Invalid data", reason)
        self.assertNotIn("\x1b", reason)  # sanitized

    def test_timeout_is_unplayable(self):
        with mock.patch("server.probe.subprocess.run",
                        side_effect=subprocess.TimeoutExpired("ffprobe", 10)):
            ok, reason = _ffprobe_playable("http://x/ace/r/A")
        self.assertFalse(ok)
        self.assertIn("timed out", reason)

    def test_missing_ffprobe_is_unplayable_not_raised(self):
        with mock.patch("server.probe.subprocess.run",
                        side_effect=FileNotFoundError("ffprobe")):
            ok, reason = _ffprobe_playable("http://x/ace/r/A")
        self.assertFalse(ok)
        self.assertIn("could not run", reason)


class ProbeStreamTests(unittest.TestCase):
    """End-to-end orchestration with the engine calls stubbed."""

    def _patch(self, *, getstream=None, first_byte=None, stat=None):
        gs = mock.patch("server.probe.engine_getstream",
                        **({"side_effect": getstream} if isinstance(getstream, Exception)
                           else {"return_value": getstream or (
                               ENGINE + "/ace/r/A", ENGINE + "/ace/cmd/A",
                               ENGINE + "/ace/stat/A")}))
        fb = mock.patch("server.probe._read_first_byte", return_value=first_byte)
        ps = mock.patch("server.probe.engine_poll_stat", return_value=stat or {})
        rel = mock.patch("server.probe._release_engine_session")
        return gs, fb, ps, rel

    def test_getstream_failure_is_unreachable(self):
        gs, fb, ps, rel = self._patch(getstream=EngineError("engine down\x1b[0m"),
                                      first_byte=0.01)
        with gs, fb, ps, rel as m_rel:
            out = probe_stream(ENGINE, CID)
        self.assertEqual(out["state"], "unreachable")
        self.assertEqual(out["cid"], CID)
        self.assertIn("engine down", out["detail"]["reason"])
        self.assertNotIn("\x1b", out["detail"]["reason"])  # sanitized
        m_rel.assert_not_called()  # nothing to release, no session opened

    def test_healthy_path_releases_and_reports_detail(self):
        gs, fb, ps, rel = self._patch(
            first_byte=0.05,
            stat={"status": "dl", "peers": 7, "speed_down": 3416,
                  "downloaded": 1024})
        with gs, fb, ps, rel as m_rel:
            out = probe_stream(ENGINE, CID)
        self.assertEqual(out["state"], "healthy")
        self.assertEqual(out["detail"]["first_byte_secs"], 0.05)
        self.assertEqual(out["detail"]["peers"], 7)
        self.assertEqual(out["detail"]["speed_down"], 3416)
        m_rel.assert_called_once_with(ENGINE + "/ace/cmd/A")

    def test_dead_path(self):
        gs, fb, ps, rel = self._patch(first_byte=None)
        with gs, fb, ps, rel as m_rel:
            out = probe_stream(ENGINE, CID)
        self.assertEqual(out["state"], "dead")
        self.assertIsNone(out["detail"]["first_byte_secs"])
        m_rel.assert_called_once()

    def test_slow_path(self):
        gs, fb, ps, rel = self._patch(first_byte=6.0)
        with gs, fb, ps, rel:
            out = probe_stream(ENGINE, CID)
        self.assertEqual(out["state"], "slow")

    def test_deep_playable_stays_healthy(self):
        gs, fb, ps, rel = self._patch(first_byte=0.05)
        fp = mock.patch("server.probe._ffprobe_playable",
                        return_value=(True, "video:h264, audio:aac"))
        with gs, fb, ps, rel, fp:
            out = probe_stream(ENGINE, CID, deep=True)
        self.assertEqual(out["state"], "healthy")
        self.assertIn("h264", out["detail"]["reason"])

    def test_deep_unplayable_when_ffprobe_fails(self):
        gs, fb, ps, rel = self._patch(first_byte=0.05)
        fp = mock.patch("server.probe._ffprobe_playable",
                        return_value=(False, "no audio or video stream found"))
        with gs, fb, ps, rel, fp:
            out = probe_stream(ENGINE, CID, deep=True)
        self.assertEqual(out["state"], "unplayable")
        self.assertIn("no audio or video", out["detail"]["reason"])

    def test_deep_skips_ffprobe_for_dead(self):
        # A dead channel (no bytes) must NOT pay the ffprobe cost.
        gs, fb, ps, rel = self._patch(first_byte=None)
        fp = mock.patch("server.probe._ffprobe_playable")
        with gs, fb, ps, rel, fp as m_fp:
            out = probe_stream(ENGINE, CID, deep=True)
        self.assertEqual(out["state"], "dead")
        m_fp.assert_not_called()

    def test_shallow_never_runs_ffprobe(self):
        gs, fb, ps, rel = self._patch(first_byte=0.05)
        fp = mock.patch("server.probe._ffprobe_playable")
        with gs, fb, ps, rel, fp as m_fp:
            out = probe_stream(ENGINE, CID, deep=False)
        self.assertEqual(out["state"], "healthy")
        m_fp.assert_not_called()

    def test_releases_even_when_stat_poll_raises(self):
        gs = mock.patch("server.probe.engine_getstream",
                        return_value=(ENGINE + "/ace/r/A", ENGINE + "/ace/cmd/A",
                                      ENGINE + "/ace/stat/A"))
        fb = mock.patch("server.probe._read_first_byte", return_value=0.05)
        ps = mock.patch("server.probe.engine_poll_stat",
                        side_effect=EngineError("stat blew up"))
        rel = mock.patch("server.probe._release_engine_session")
        with gs, fb, ps, rel as m_rel:
            out = probe_stream(ENGINE, CID)
        self.assertEqual(out["state"], "healthy")  # stat is enrichment only
        m_rel.assert_called_once()


if __name__ == "__main__":
    unittest.main()
