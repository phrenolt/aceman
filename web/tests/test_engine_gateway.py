"""Tests for the engine gateway's gate logic.

The security-critical decisions are pure/socket-level: detect a browser by
the presence of Sec-Fetch-Site, and read the request-header block safely
(bounded + terminated). Byte-splicing itself is exercised by the live spike,
not here.
"""

from __future__ import annotations

from . import _setup  # noqa: F401

import socket
import unittest

import engine_gateway as gw


class SecFetchDetectionTests(unittest.TestCase):
    def test_present_blocks(self):
        for h in (
            b"GET / HTTP/1.1\r\nSec-Fetch-Site: cross-site\r\n\r\n",
            b"GET / HTTP/1.1\r\nSec-Fetch-Site: same-origin\r\n\r\n",
            b"GET / HTTP/1.1\r\nSec-Fetch-Site: none\r\n\r\n",
        ):
            with self.subTest(h=h):
                self.assertTrue(gw._has_sec_fetch_site(h))

    def test_case_insensitive_header_name(self):
        self.assertTrue(gw._has_sec_fetch_site(
            b"GET / HTTP/1.1\r\nsec-FETCH-site: cross-site\r\n\r\n"))

    def test_absent_passes(self):
        # A typical native-client (VLC / curl / the CLI) request.
        self.assertFalse(gw._has_sec_fetch_site(
            b"GET /ace/getstream?id=x HTTP/1.1\r\n"
            b"Host: 127.0.0.1:6878\r\nUser-Agent: VLC/3.0\r\n\r\n"))

    def test_only_matches_header_name_not_body_or_values(self):
        # The string appearing in a header VALUE (not as a name) must not
        # trip the gate — only a real Sec-Fetch-Site header should.
        self.assertFalse(gw._has_sec_fetch_site(
            b"GET / HTTP/1.1\r\nReferer: http://x/?Sec-Fetch-Site=1\r\n\r\n"))


class ReadHeadersTests(unittest.TestCase):
    def _pair(self):
        a, b = socket.socketpair()
        self.addCleanup(a.close)
        self.addCleanup(b.close)
        return a, b

    def test_reads_full_header_block(self):
        a, b = self._pair()
        req = b"GET /x HTTP/1.1\r\nHost: h\r\nSec-Fetch-Site: cross-site\r\n\r\n"
        b.sendall(req)
        self.assertEqual(gw._read_headers(a), req)

    def test_none_on_early_close(self):
        a, b = self._pair()
        b.sendall(b"GET /x HTTP/1.1\r\n")  # no terminator
        b.close()
        self.assertIsNone(gw._read_headers(a))

    def test_none_on_oversize_without_terminator(self):
        a, b = self._pair()
        b.sendall(b"GET / HTTP/1.1\r\nX: " + b"A" * (gw.MAX_HEADER_BYTES + 100))
        b.close()
        self.assertIsNone(gw._read_headers(a))


if __name__ == "__main__":
    unittest.main()
