import unittest
from unittest.mock import MagicMock
from server.context import RouteContext
from server.http_io import Request
from server.routes.heartbeat import heartbeat, register
from server.router import Router

class TestHeartbeatRoutes(unittest.TestCase):
    def test_heartbeat(self):
        mock_tracker = MagicMock()
        ctx = RouteContext(heartbeat=mock_tracker)
        req = Request(method="POST", path="/api/heartbeat")
        resp = heartbeat(req, ctx)
        self.assertEqual(resp.status, 200)
        mock_tracker.ping.assert_called_once()

    def test_register(self):
        pass
