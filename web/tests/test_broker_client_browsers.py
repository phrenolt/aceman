import unittest
from unittest.mock import MagicMock
from server.broker_client.browsers import BrowsersBrokerClient
from server.broker_client.base import BrokerClient

class TestBrowsersBrokerClient(unittest.TestCase):
    def test_list(self):
        mock_broker = MagicMock(spec=BrokerClient)
        mock_broker.call.return_value = {"platform": "linux", "available": []}
        client = BrowsersBrokerClient(mock_broker)
        self.assertEqual(client.list(), {"platform": "linux", "available": []})
        mock_broker.call.assert_called_with("browsers.list", timeout=10)

    def test_spawn(self):
        mock_broker = MagicMock(spec=BrokerClient)
        mock_broker.call.return_value = {"spawned": True}
        client = BrowsersBrokerClient(mock_broker)
        self.assertEqual(client.spawn("firefox", "system", "http://localhost"), {"spawned": True})
        mock_broker.call.assert_called_with(
            "browser.spawn",
            params={"name": "firefox", "source": "system", "url": "http://localhost"},
            timeout=10
        )
