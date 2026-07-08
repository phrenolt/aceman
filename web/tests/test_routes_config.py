import unittest
from unittest.mock import MagicMock
from server.context import RouteContext
from server.http_io import Request
from server.routes.config_routes import get_config, patch_config, register
from server.router import Router

class TestConfigRoutes(unittest.TestCase):
    def test_get_config_disabled(self):
        ctx = RouteContext(config=None)
        req = Request(method="GET", path="/api/config")
        resp = get_config(req, ctx)
        self.assertEqual(resp.status, 404)

    def test_get_config_enabled(self):
        mock_config = MagicMock()
        mock_config.snapshot.return_value = {"buffer_secs": 10}
        ctx = RouteContext(config=mock_config)
        req = Request(method="GET", path="/api/config")
        resp = get_config(req, ctx)
        self.assertEqual(resp.status, 200)
        self.assertIn(b"buffer_secs", resp.body)

    def test_patch_config_disabled(self):
        ctx = RouteContext(config=None)
        req = Request(method="POST", path="/api/config", body={"buffer_secs": 20})
        resp = patch_config(req, ctx)
        self.assertEqual(resp.status, 404)

    def test_patch_config_bad_body(self):
        mock_config = MagicMock()
        ctx = RouteContext(config=mock_config)
        req = Request(method="POST", path="/api/config", body=[])
        resp = patch_config(req, ctx)
        self.assertEqual(resp.status, 400)

    def test_patch_config_valid(self):
        mock_config = MagicMock()
        mock_config.update.return_value = {"buffer_secs": 20}
        ctx = RouteContext(config=mock_config)
        req = Request(method="POST", path="/api/config", body={"buffer_secs": 20})
        resp = patch_config(req, ctx)
        self.assertEqual(resp.status, 200)

    def test_register(self):
        pass
