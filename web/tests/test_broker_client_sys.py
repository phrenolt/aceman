import unittest
from unittest.mock import MagicMock
from server.broker_client.sys import SysBrokerClient
from server.broker_client.base import BrokerClient

class TestSysBrokerClient(unittest.TestCase):
    def test_usage(self):
        mock_broker = MagicMock(spec=BrokerClient)
        mock_broker.call.return_value = {"cpu": 10.0, "gpu": 5.0}
        client = SysBrokerClient(mock_broker)
        self.assertEqual(client.usage(), {"cpu": 10.0, "gpu": 5.0})
        mock_broker.call.assert_called_with("sys.usage", timeout=8)
