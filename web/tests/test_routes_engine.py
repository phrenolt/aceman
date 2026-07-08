import unittest
from unittest.mock import MagicMock, patch
from server.context import RouteContext
from server.http_io import Request
from server.routes.engine_routes import engine_probe_route, engine_status, engine_start, engine_stop, engine_memory, register
from server.router import Router

class TestEngineRoutes(unittest.TestCase):
    @patch("server.routes.engine_routes.engine_probe")
    def test_engine_probe_route(self, mock_probe):
        mock_probe.return_value = True
        ctx = RouteContext(engine="http://engine")
        req = Request(method="GET", path="/api/engine/probe")
        resp = engine_probe_route(req, ctx)
        self.assertEqual(resp.status, 200)
        self.assertIn(b'"up": true', resp.body)

    def test_engine_status_disabled(self):
        ctx = RouteContext(engine_mgr=None)
        req = Request(method="GET", path="/api/engine/status")
        resp = engine_status(req, ctx)
        self.assertEqual(resp.status, 404)

    def test_engine_status_success(self):
        mock_mgr = MagicMock()
        mock_mgr.status.return_value = {"state": "running"}
        ctx = RouteContext(engine_mgr=mock_mgr)
        req = Request(method="GET", path="/api/engine/status")
        resp = engine_status(req, ctx)
        self.assertEqual(resp.status, 200)
        self.assertIn(b'"state": "running"', resp.body)
        self.assertIn(b'"image_installed": true', resp.body)

    def test_engine_start(self):
        mock_mgr = MagicMock()
        mock_mgr.start.return_value = {"started": True}
        ctx = RouteContext(engine_mgr=mock_mgr)
        req = Request(method="POST", path="/api/engine/start")
        resp = engine_start(req, ctx)
        self.assertEqual(resp.status, 200)

    def test_engine_stop(self):
        mock_mgr = MagicMock()
        mock_mgr.stop.return_value = {"stopped": True}
        ctx = RouteContext(engine_mgr=mock_mgr)
        req = Request(method="POST", path="/api/engine/stop")
        resp = engine_stop(req, ctx)
        self.assertEqual(resp.status, 200)

    def test_engine_memory(self):
        mock_mgr = MagicMock()
        mock_mgr.memory.return_value = {"rss": 1024}
        ctx = RouteContext(engine_mgr=mock_mgr)
        req = Request(method="GET", path="/api/engine/memory")
        resp = engine_memory(req, ctx)
        self.assertEqual(resp.status, 200)
        
    def test_register(self):
        router = Router()
        register(router)
        pass
