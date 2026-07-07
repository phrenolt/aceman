"""Tests for the proxy post-mortem classifier.

``Handler._classify_proxy_end`` turns the internal end_reason / ffmpeg
return code into a short, plain cause shown in the browser's video
status line (surfaced via GET /api/stream/last-error). The mapping is
pure, so we test it directly without a socket.
"""

from __future__ import annotations

from . import _setup  # noqa: F401

import unittest

import aceman_web

_classify = aceman_web.Handler._classify_proxy_end


class ClassifyProxyEndTests(unittest.TestCase):
    def test_browser_disconnect_points_at_the_buffer(self):
        # The classic pre-roll buffer-overflow signature: mpegts.js drops
        # the fetch when the MSE SourceBuffer fills, the server write()
        # raises BrokenPipeError. The hint must mention the buffer so the
        # frontend raises the reset-buffer notice on it.
        hint = _classify("browser disconnected: BrokenPipeError", -9)
        self.assertIn("buffer", hint)

    def test_rc255_reads_as_corrupt_source(self):
        hint = _classify("ffmpeg stdout EOF (rc=255)", 255)
        self.assertIn("corrupt", hint)

    def test_clean_eof_reads_as_stream_ended(self):
        hint = _classify("ffmpeg stdout EOF (rc=0)", 0)
        self.assertIn("ended", hint)

    def test_upstream_read_failure(self):
        hint = _classify("upstream read failed: OSError: boom", None)
        self.assertIn("ffmpeg proxy", hint)

    def test_unknown_reason_falls_back_to_the_log_pointer(self):
        hint = _classify("something we didn't anticipate", 7)
        self.assertIn("web log", hint)

    def test_none_reason_is_safe(self):
        # end_reason defaults to "unknown" in the proxy, but guard anyway.
        self.assertIsInstance(_classify(None, None), str)


if __name__ == "__main__":
    unittest.main()
