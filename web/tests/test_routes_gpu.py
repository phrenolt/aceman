import unittest
from unittest.mock import MagicMock
from server.context import RouteContext
from server.http_io import Request
from server.routes.gpu import gpu_status, register
from server.router import Router
from server.engine_client import EngineError

class TestGpuRoutes(unittest.TestCase):
    def test_gpu_status_disabled(self):
        ctx = RouteContext(gpu_client=None)
        req = Request(method="GET", path="/api/gpu/status")
        resp = gpu_status(req, ctx)
        self.assertEqual(resp.status, 404)

    def test_gpu_status_success(self):
        mock_client = MagicMock()
        mock_client.status.return_value = {"available": True}
        ctx = RouteContext(gpu_client=mock_client)
        ctx.cpu_reencode = lambda: False
        req = Request(method="GET", path="/api/gpu/status")
        resp = gpu_status(req, ctx)
        self.assertEqual(resp.status, 200)
        self.assertIn(b'"available": true', resp.body)
        self.assertIn(b'"cpu_reencode": false', resp.body)

    def test_gpu_status_error(self):
        mock_client = MagicMock()
        mock_client.status.side_effect = EngineError("error")
        ctx = RouteContext(gpu_client=mock_client)
        ctx.cpu_reencode = lambda: True
        req = Request(method="GET", path="/api/gpu/status")
        resp = gpu_status(req, ctx)
        self.assertEqual(resp.status, 200)
        self.assertIn(b'"available": false', resp.body)
        self.assertIn(b'"cpu_reencode": true', resp.body)

    def test_register(self):
        router = Router()
        register(router)
        self.assertIsNotNone(router.resolve("GET", "/api/gpu/status"))
