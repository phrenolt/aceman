import unittest
from unittest.mock import MagicMock
from server.context import RouteContext
from server.http_io import Request
from server.routes.sys import sys_usage, register
from server.router import Router
from server.engine_client import EngineError

class TestSysRoutes(unittest.TestCase):
    def test_sys_usage_disabled(self):
        ctx = RouteContext(sys_client=None)
        req = Request(method="GET", path="/api/sys/usage")
        resp = sys_usage(req, ctx)
        self.assertEqual(resp.status, 200)
        self.assertIn(b'"cpu": null', resp.body)

    def test_sys_usage_success(self):
        mock_client = MagicMock()
        mock_client.usage.return_value = {"cpu": 25.0}
        ctx = RouteContext(sys_client=mock_client)
        req = Request(method="GET", path="/api/sys/usage")
        resp = sys_usage(req, ctx)
        self.assertEqual(resp.status, 200)
        self.assertIn(b'"cpu": 25.0', resp.body)

    def test_sys_usage_error(self):
        mock_client = MagicMock()
        mock_client.usage.side_effect = EngineError("error")
        ctx = RouteContext(sys_client=mock_client)
        req = Request(method="GET", path="/api/sys/usage")
        resp = sys_usage(req, ctx)
        self.assertEqual(resp.status, 200)
        self.assertIn(b'"cpu": null', resp.body)

    def test_register(self):
        router = Router()
        register(router)
        self.assertIsNotNone(router.resolve("GET", "/api/sys/usage"))
