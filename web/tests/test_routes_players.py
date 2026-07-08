import unittest
from unittest.mock import MagicMock
from server.context import RouteContext
from server.http_io import Request
from server.routes.players import list_players, register
from server.router import Router
from server.engine_client import EngineError

class TestPlayersRoutes(unittest.TestCase):
    def test_list_players_disabled(self):
        ctx = RouteContext(players_client=None)
        req = Request(method="GET", path="/api/players")
        resp = list_players(req, ctx)
        self.assertEqual(resp.status, 404)

    def test_list_players_success(self):
        mock_client = MagicMock()
        mock_client.list.return_value = {"platform": "linux", "available": [{"name": "vlc"}]}
        ctx = RouteContext(players_client=mock_client)
        req = Request(method="GET", path="/api/players")
        resp = list_players(req, ctx)
        self.assertEqual(resp.status, 200)
        self.assertIn(b'"name": "vlc"', resp.body)

    def test_list_players_error(self):
        mock_client = MagicMock()
        mock_client.list.side_effect = EngineError("error")
        ctx = RouteContext(players_client=mock_client)
        req = Request(method="GET", path="/api/players")
        resp = list_players(req, ctx)
        self.assertEqual(resp.status, 200)
        self.assertIn(b'"broker_error": true', resp.body)

    def test_register(self):
        router = Router()
        register(router)
        self.assertIsNotNone(router.resolve("GET", "/api/players"))
