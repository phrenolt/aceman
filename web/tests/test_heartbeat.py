import unittest
from unittest.mock import patch
from server.heartbeat import HeartbeatTracker

class TestHeartbeat(unittest.TestCase):
    def test_heartbeat_initial(self):
        tracker = HeartbeatTracker()
        self.assertIsNone(tracker.idle_for())

    @patch("server.heartbeat.time.monotonic")
    def test_heartbeat_ping_and_idle(self, mock_monotonic):
        tracker = HeartbeatTracker()
        
        mock_monotonic.return_value = 100.0
        tracker.ping()
        
        mock_monotonic.return_value = 105.0
        self.assertEqual(tracker.idle_for(), 5.0)
