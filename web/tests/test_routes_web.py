import unittest
from unittest.mock import MagicMock
from server.context import RouteContext
from server.http_io import Request
from server.routes.web_routes import web_memory, register
from server.router import Router

class TestWebRoutes(unittest.TestCase):
    def test_web_memory_disabled(self):
        ctx = RouteContext(web_client=None)
        req = Request(method="GET", path="/api/web/memory")
        resp = web_memory(req, ctx)
        self.assertEqual(resp.status, 200)
        self.assertIn(b'"available": false', resp.body)

    def test_web_memory_enabled(self):
        mock_client = MagicMock()
        mock_client.memory.return_value = {"rss": 1000}
        ctx = RouteContext(web_client=mock_client)
        req = Request(method="GET", path="/api/web/memory")
        resp = web_memory(req, ctx)
        self.assertEqual(resp.status, 200)
        self.assertIn(b'"rss": 1000', resp.body)

    def test_register(self):
        pass
