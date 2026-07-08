import unittest
from unittest.mock import MagicMock
from server.broker_client.desktop import DesktopBrokerClient
from server.broker_client.base import BrokerClient

class TestDesktopBrokerClient(unittest.TestCase):
    def test_status(self):
        mock_broker = MagicMock(spec=BrokerClient)
        mock_broker.call.return_value = {"status": "ok"}
        client = DesktopBrokerClient(mock_broker, host="localhost", port=8080)
        self.assertEqual(client.status(), {"status": "ok"})
        mock_broker.call.assert_called_with("desktop.status", timeout=5)

    def test_install(self):
        mock_broker = MagicMock(spec=BrokerClient)
        mock_broker.call.return_value = {"installed": True}
        client = DesktopBrokerClient(mock_broker, host="localhost", port=8080)
        self.assertEqual(client.install(register_scheme=True), {"installed": True})
        mock_broker.call.assert_called_with("desktop.install", params={"host": "localhost", "port": 8080, "register_scheme": True}, timeout=15)

    def test_uninstall(self):
        mock_broker = MagicMock(spec=BrokerClient)
        mock_broker.call.return_value = {"uninstalled": True}
        client = DesktopBrokerClient(mock_broker, host="localhost", port=8080)
        self.assertEqual(client.uninstall(), {"uninstalled": True})
        mock_broker.call.assert_called_with("desktop.uninstall", timeout=10)

    def test_restore_mimeapps_backup(self):
        mock_broker = MagicMock(spec=BrokerClient)
        mock_broker.call.return_value = {"restored": True}
        client = DesktopBrokerClient(mock_broker, host="localhost", port=8080)
        self.assertEqual(client.restore_mimeapps_backup(), {"restored": True})
        mock_broker.call.assert_called_with("desktop.restore_mimeapps_backup", timeout=5)
