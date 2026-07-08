import json
import unittest
from server.http_io import Request, Response

class TestHttpIo(unittest.TestCase):
    def test_request_defaults(self):
        req = Request(method="GET", path="/test")
        self.assertEqual(req.method, "GET")
        self.assertEqual(req.path, "/test")
        self.assertEqual(req.query, {})
        self.assertEqual(req.body, {})
        self.assertEqual(req.headers, {})
        self.assertEqual(req.path_params, {})

    def test_response_json(self):
        resp = Response.json(200, {"hello": "world"})
        self.assertEqual(resp.status, 200)
        self.assertEqual(resp.body, b'{"hello": "world"}')
        self.assertEqual(resp.content_type, "application/json; charset=utf-8")
        self.assertEqual(resp.extra_headers, {})

    def test_response_error(self):
        resp = Response.error(400, "Bad request")
        self.assertEqual(resp.status, 400)
        self.assertEqual(json.loads(resp.body), {"error": "Bad request"})

    def test_response_empty(self):
        resp = Response.empty()
        self.assertEqual(resp.status, 204)
        self.assertEqual(resp.body, b"")

        resp2 = Response.empty(200)
        self.assertEqual(resp2.status, 200)
