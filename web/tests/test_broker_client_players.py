import unittest
from unittest.mock import MagicMock
from server.broker_client.players import PlayersBrokerClient
from server.broker_client.base import BrokerClient

class TestPlayersBrokerClient(unittest.TestCase):
    def test_list(self):
        mock_broker = MagicMock(spec=BrokerClient)
        mock_broker.call.return_value = {"platform": "linux", "available": []}
        client = PlayersBrokerClient(mock_broker)
        self.assertEqual(client.list(), {"platform": "linux", "available": []})
        mock_broker.call.assert_called_with("players.list", timeout=10)

    def test_stop(self):
        mock_broker = MagicMock(spec=BrokerClient)
        mock_broker.call.return_value = {"stopped": True}
        client = PlayersBrokerClient(mock_broker)
        self.assertEqual(client.stop(), {"stopped": True})
        mock_broker.call.assert_called_with("player.stop", timeout=8)
