import unittest
from unittest.mock import MagicMock, patch
from server.broker_client.engine import EngineBrokerClient
from server.broker_client.base import BrokerClient, BrokerError

class TestEngineBrokerClient(unittest.TestCase):
    @patch("server.broker_client.engine.engine_probe")
    def test_probe(self, mock_probe):
        mock_probe.return_value = True
        mock_broker = MagicMock(spec=BrokerClient)
        client = EngineBrokerClient(mock_broker, "http://engine")
        self.assertTrue(client.probe())
        mock_probe.assert_called_with("http://engine", timeout=5.0)

    def test_container_running_true(self):
        mock_broker = MagicMock(spec=BrokerClient)
        mock_broker.call.return_value = {"container": True}
        client = EngineBrokerClient(mock_broker, "http://engine")
        self.assertTrue(client.container_running())

    def test_container_running_false(self):
        mock_broker = MagicMock(spec=BrokerClient)
        mock_broker.call.return_value = {"container": False}
        client = EngineBrokerClient(mock_broker, "http://engine")
        self.assertFalse(client.container_running())

    def test_container_running_error(self):
        mock_broker = MagicMock(spec=BrokerClient)
        mock_broker.call.side_effect = BrokerError("error")
        client = EngineBrokerClient(mock_broker, "http://engine")
        self.assertFalse(client.container_running())

    def test_status(self):
        mock_broker = MagicMock(spec=BrokerClient)
        mock_broker.call.return_value = {"state": "running"}
        client = EngineBrokerClient(mock_broker, "http://engine")
        self.assertEqual(client.status(), {"state": "running"})

    def test_start(self):
        mock_broker = MagicMock(spec=BrokerClient)
        mock_broker.call.return_value = {"started": True}
        client = EngineBrokerClient(mock_broker, "http://engine")
        self.assertEqual(client.start(), {"started": True})

    def test_stop(self):
        mock_broker = MagicMock(spec=BrokerClient)
        mock_broker.call.return_value = {"stopped": True}
        client = EngineBrokerClient(mock_broker, "http://engine")
        self.assertEqual(client.stop(), {"stopped": True})

    def test_set_lan(self):
        mock_broker = MagicMock(spec=BrokerClient)
        mock_broker.call.return_value = {"lan": True}
        client = EngineBrokerClient(mock_broker, "http://engine")
        self.assertEqual(client.set_lan(enabled=True), {"lan": True})

    def test_memory_success(self):
        mock_broker = MagicMock(spec=BrokerClient)
        mock_broker.call.return_value = {"rss": 512}
        client = EngineBrokerClient(mock_broker, "http://engine")
        self.assertEqual(client.memory(), {"rss": 512})

    def test_memory_error(self):
        mock_broker = MagicMock(spec=BrokerClient)
        mock_broker.call.side_effect = BrokerError("error")
        client = EngineBrokerClient(mock_broker, "http://engine")
        self.assertEqual(client.memory(), {"available": False})
