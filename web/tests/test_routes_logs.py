import unittest
from unittest.mock import MagicMock, patch
from server.context import RouteContext
from server.http_io import Request
from server.routes.logs import get_logs, register
from server.router import Router
from server.engine_client import EngineError

class TestLogsRoutes(unittest.TestCase):
    def test_get_logs_engine_disabled(self):
        ctx = RouteContext(engine_mgr=None)
        req = Request(method="GET", path="/api/logs", query={"kind": "engine"})
        resp = get_logs(req, ctx)
        self.assertEqual(resp.status, 200)
        self.assertIn(b'"available": false', resp.body)

    def test_get_logs_engine_success(self):
        mock_mgr = MagicMock()
        mock_mgr.broker.call.return_value = {"tail": "log data", "available": True}
        ctx = RouteContext(engine_mgr=mock_mgr)
        req = Request(method="GET", path="/api/logs", query={"kind": "engine", "lines": "100"})
        resp = get_logs(req, ctx)
        self.assertEqual(resp.status, 200)
        self.assertIn(b'"tail": "log data"', resp.body)
        mock_mgr.broker.call.assert_called_with("engine.logs", params={"lines": 100}, timeout=10)

    @patch("server.routes.logs._resolve_log_path")
    def test_get_logs_web(self, mock_resolve):
        mock_path = MagicMock()
        mock_path.is_file.return_value = False
        mock_resolve.return_value = mock_path
        ctx = RouteContext()
        req = Request(method="GET", path="/api/logs", query={"kind": "web"})
        resp = get_logs(req, ctx)
        self.assertEqual(resp.status, 200)
        self.assertIn(b'"available": false', resp.body)

    def test_register(self):
        router = Router()
        register(router)
        self.assertIsNotNone(router.resolve("GET", "/api/logs"))
