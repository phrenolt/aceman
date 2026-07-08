import unittest
from unittest.mock import MagicMock
from server.broker_client.web import WebBrokerClient
from server.broker_client.base import BrokerClient, BrokerError

class TestWebBrokerClient(unittest.TestCase):
    def test_memory_success(self):
        mock_broker = MagicMock(spec=BrokerClient)
        mock_broker.call.return_value = {"rss": 1024}
        client = WebBrokerClient(mock_broker)
        self.assertEqual(client.memory(), {"rss": 1024})
        mock_broker.call.assert_called_with("web.memory", timeout=8)

    def test_memory_error(self):
        mock_broker = MagicMock(spec=BrokerClient)
        mock_broker.call.side_effect = BrokerError("error")
        client = WebBrokerClient(mock_broker)
        self.assertEqual(client.memory(), {"available": False})
