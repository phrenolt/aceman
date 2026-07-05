"""Tests for the path router itself.

Critical security property: a path-parameter pattern must capture
exactly ONE path segment. A regression that lets ``{name}`` match
across slashes would let an attacker send DELETE /api/favs/..%2Fsystem
and have the route handler see ``../system`` as the favourite name.
"""

from __future__ import annotations

from . import _setup  # noqa: F401

import unittest

from server.http_io import Request, Response
from server.router import Router


def _ok(req, ctx): return Response.json(200, {"path": req.path,
                                              "params": req.path_params})


class RouterMatchingTests(unittest.TestCase):
    def setUp(self):
        self.r = Router()

    def test_static_match(self):
        self.r.get("/api/foo", _ok)
        match = self.r.resolve("GET", "/api/foo")
        self.assertIsNotNone(match)
        self.assertEqual(match[1], {})

    def test_no_match_returns_none(self):
        self.r.get("/api/foo", _ok)
        self.assertIsNone(self.r.resolve("GET", "/api/bar"))

    def test_method_isolation(self):
        self.r.get("/api/foo", _ok)
        # POST against a GET-only route must NOT match.
        self.assertIsNone(self.r.resolve("POST", "/api/foo"))

    def test_param_captured(self):
        self.r.delete("/api/favs/{name}", _ok)
        match = self.r.resolve("DELETE", "/api/favs/Acme%20Sports")
        self.assertIsNotNone(match)
        self.assertEqual(match[1], {"name": "Acme Sports"})

    def test_param_does_not_cross_slash(self):
        """The critical anti-traversal invariant."""
        self.r.delete("/api/favs/{name}", _ok)
        # `..%2Fetc%2Fpasswd` decodes to `../etc/passwd`. The router
        # sees the literal slashes, and {name} must NOT swallow them.
        self.assertIsNone(self.r.resolve("DELETE",
                                         "/api/favs/foo/bar"))

    def test_param_refuses_encoded_traversal(self):
        """Percent-ENCODED slashes pass the `[^/]+` segment pattern
        (the regex runs before unquoting), so the decoded-param check
        in resolve() must refuse anything shaped like a traversal —
        a handler must never receive a string that could climb out of
        (or absolutely repoint) a directory it gets joined to."""
        self.r.delete("/api/favs/{name}", _ok)
        for encoded in ("..%2Fetc%2Fpasswd",   # → ../etc/passwd
                        "..%2f..%2fsystem",    # lower-case hex
                        "%2e%2e",              # → ..
                        "%2e",                 # → .
                        "a%2F..%2Fb",          # → a/../b (interior ..)
                        "a%5Cb%5C..",          # → a\b\.. (backslash)
                        "%2Fetc%2Fpasswd",     # → /etc/passwd (absolute)
                        ):
            self.assertIsNone(
                self.r.resolve("DELETE", f"/api/favs/{encoded}"),
                f"traversal param must be refused: {encoded!r}")

    def test_param_allows_benign_decoded_values(self):
        """The traversal refusal must not over-block. Favourite names
        are free text: spaces and even interior slashes ("Alpha/Beta",
        addressed by the UI as Alpha%2FBeta) are legal and must still
        resolve — an interior slash can only descend, never climb."""
        self.r.delete("/api/favs/{name}", _ok)
        for encoded, decoded in (("Acme%20Sports%202", "Acme Sports 2"),
                                 ("Alpha%2FBeta", "Alpha/Beta"),
                                 ("24%2F7%20Demo", "24/7 Demo"),
                                 ("a.b..c", "a.b..c")):  # dots, not segments
            match = self.r.resolve("DELETE", f"/api/favs/{encoded}")
            self.assertIsNotNone(match, f"benign param over-blocked: {encoded!r}")
            self.assertEqual(match[1], {"name": decoded})

    def test_param_does_not_match_empty(self):
        self.r.delete("/api/favs/{name}", _ok)
        self.assertIsNone(self.r.resolve("DELETE", "/api/favs/"))

    def test_anchored_no_prefix_match(self):
        """A registration of /api/foo must not match /api/foo/extra."""
        self.r.get("/api/foo", _ok)
        self.assertIsNone(self.r.resolve("GET", "/api/foo/extra"))

    def test_anchored_no_suffix_match(self):
        """Likewise /api/foo must not match /api-foo or similar."""
        self.r.get("/api/foo", _ok)
        self.assertIsNone(self.r.resolve("GET", "/Xapi/foo"))
        self.assertIsNone(self.r.resolve("GET", "/api/foo?"))


if __name__ == "__main__":
    unittest.main()
