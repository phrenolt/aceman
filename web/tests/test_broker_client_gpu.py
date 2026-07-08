import unittest
from unittest.mock import MagicMock
from server.broker_client.gpu import GpuBrokerClient
from server.broker_client.base import BrokerClient

class TestGpuBrokerClient(unittest.TestCase):
    def test_status(self):
        mock_broker = MagicMock(spec=BrokerClient)
        mock_broker.call.return_value = {"available": True}
        client = GpuBrokerClient(mock_broker)
        self.assertEqual(client.status(), {"available": True})
        mock_broker.call.assert_called_with("gpu.status", timeout=10)
