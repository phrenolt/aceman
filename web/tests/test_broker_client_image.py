import unittest
from unittest.mock import MagicMock
from server.broker_client.image import ImageBrokerClient
from server.broker_client.base import BrokerClient

class TestImageBrokerClient(unittest.TestCase):
    def test_status(self):
        mock_broker = MagicMock(spec=BrokerClient)
        mock_broker.call.return_value = {"status": "ok"}
        client = ImageBrokerClient(mock_broker)
        self.assertEqual(client.status(), {"status": "ok"})
        mock_broker.call.assert_called_with("image.status", timeout=10)

    def test_install(self):
        mock_broker = MagicMock(spec=BrokerClient)
        mock_broker.call.return_value = {"installing": True}
        client = ImageBrokerClient(mock_broker)
        self.assertEqual(client.install(), {"installing": True})
        mock_broker.call.assert_called_with("image.install", timeout=15)

    def test_remove(self):
        mock_broker = MagicMock(spec=BrokerClient)
        mock_broker.call.return_value = {"removed": True}
        client = ImageBrokerClient(mock_broker)
        self.assertEqual(client.remove(), {"removed": True})
        mock_broker.call.assert_called_with("image.remove", timeout=60)
