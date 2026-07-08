import unittest
from unittest.mock import MagicMock
from server.context import RouteContext
from server.http_io import Request
from server.routes.browsers import list_browsers, register
from server.router import Router
from server.engine_client import EngineError

class TestBrowsersRoutes(unittest.TestCase):
    def test_list_browsers_disabled(self):
        ctx = RouteContext(browsers_client=None)
        req = Request(method="GET", path="/api/browsers")
        resp = list_browsers(req, ctx)
        self.assertEqual(resp.status, 404)

    def test_list_browsers_success(self):
        mock_client = MagicMock()
        mock_client.list.return_value = {"platform": "linux", "available": [{"name": "firefox", "argv": ["firefox"]}]}
        ctx = RouteContext(browsers_client=mock_client)
        req = Request(method="GET", path="/api/browsers")
        resp = list_browsers(req, ctx)
        self.assertEqual(resp.status, 200)
        self.assertIn(b'"name": "firefox"', resp.body)
        self.assertNotIn(b"argv", resp.body)

    def test_list_browsers_error(self):
        mock_client = MagicMock()
        mock_client.list.side_effect = EngineError("error")
        ctx = RouteContext(browsers_client=mock_client)
        req = Request(method="GET", path="/api/browsers")
        resp = list_browsers(req, ctx)
        self.assertEqual(resp.status, 200)
        self.assertIn(b'"broker_error": true', resp.body)

    def test_register(self):
        router = Router()
        register(router)
        pass
