import unittest
from unittest.mock import MagicMock
from server.context import RouteContext
from server.http_io import Request
from server.routes.desktop_routes import get_desktop_entry, install_desktop_entry, uninstall_desktop_entry, register
from server.router import Router
from server.engine_client import EngineError

class TestDesktopRoutes(unittest.TestCase):
    def test_get_desktop_entry_disabled(self):
        ctx = RouteContext(desktop_entry=None)
        req = Request(method="GET", path="/api/desktop-entry/app")
        resp = get_desktop_entry(req, ctx)
        self.assertEqual(resp.status, 404)

    def test_get_desktop_entry_success(self):
        mock_client = MagicMock()
        mock_client.status.return_value = {"installed": True}
        ctx = RouteContext(desktop_entry=mock_client)
        req = Request(method="GET", path="/api/desktop-entry/app")
        resp = get_desktop_entry(req, ctx)
        self.assertEqual(resp.status, 200)

    def test_install_desktop_entry(self):
        mock_client = MagicMock()
        mock_client.install.return_value = {"installed": True}
        ctx = RouteContext(desktop_entry=mock_client)
        req = Request(method="POST", path="/api/desktop-entry/app", body={"register_scheme": False})
        resp = install_desktop_entry(req, ctx)
        self.assertEqual(resp.status, 200)
        mock_client.install.assert_called_with(register_scheme=False)

    def test_uninstall_desktop_entry(self):
        mock_client = MagicMock()
        mock_client.uninstall.return_value = {"uninstalled": True}
        ctx = RouteContext(desktop_entry=mock_client)
        req = Request(method="DELETE", path="/api/desktop-entry/app")
        resp = uninstall_desktop_entry(req, ctx)
        self.assertEqual(resp.status, 200)

    def test_register(self):
        router = Router()
        register(router)
        pass
