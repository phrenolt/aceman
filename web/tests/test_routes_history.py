import unittest
from unittest.mock import MagicMock
from server.context import RouteContext
from server.http_io import Request
from server.routes.history_routes import list_history, record_history, delete_history, clear_history, register
from server.router import Router

class TestHistoryRoutes(unittest.TestCase):
    def test_list_history_disabled(self):
        ctx = RouteContext(history_store=None)
        req = Request(method="GET", path="/api/history")
        resp = list_history(req, ctx)
        self.assertEqual(resp.status, 404)

    def test_list_history_success(self):
        mock_store = MagicMock()
        mock_store.list.return_value = [{"cid": "0" * 40, "name": "foo"}]
        ctx = RouteContext(history_store=mock_store)
        req = Request(method="GET", path="/api/history", query={"limit": "10"})
        resp = list_history(req, ctx)
        self.assertEqual(resp.status, 200)
        mock_store.list.assert_called_with(10)

    def test_record_history_bad_body(self):
        mock_store = MagicMock()
        ctx = RouteContext(history_store=mock_store)
        req = Request(method="POST", path="/api/history", body=[])
        resp = record_history(req, ctx)
        self.assertEqual(resp.status, 400)

    def test_record_history_success(self):
        mock_store = MagicMock()
        ctx = RouteContext(history_store=mock_store)
        req = Request(method="POST", path="/api/history", body={"cid": "0" * 40, "name": "foo"})
        resp = record_history(req, ctx)
        self.assertEqual(resp.status, 200)
        mock_store.record.assert_called_with("0" * 40, "foo")

    def test_delete_history(self):
        mock_store = MagicMock()
        mock_store.delete.return_value = True
        ctx = RouteContext(history_store=mock_store)
        req = Request(method="DELETE", path="/api/history/0000000000000000000000000000000000000000", path_params={"cid": "0" * 40})
        resp = delete_history(req, ctx)
        self.assertEqual(resp.status, 200)

    def test_clear_history(self):
        mock_store = MagicMock()
        ctx = RouteContext(history_store=mock_store)
        req = Request(method="DELETE", path="/api/history")
        resp = clear_history(req, ctx)
        self.assertEqual(resp.status, 200)
        mock_store.clear.assert_called_once()
        
    def test_register(self):
        router = Router()
        register(router)
        self.assertIsNotNone(router.resolve("GET", "/api/history"))
