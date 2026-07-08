import os
import signal
import time
import unittest
from unittest.mock import patch, MagicMock

from aceman_broker.actions import players

class TestPlayersAction(unittest.TestCase):
    @patch("aceman_broker.actions.players._PROBES", {"linux": [lambda: [{"name": "vlc", "source": "system"}]]})
    @patch("aceman_broker.actions.players.PLATFORM", "linux")
    def test_players_list(self):
        res = players.action_players_list()
        self.assertEqual(res["platform"], "linux")
        self.assertEqual(len(res["available"]), 1)
        self.assertEqual(res["available"][0]["name"], "vlc")

    @patch("aceman_broker.actions.players.read_wrapper_pid")
    def test_player_stop_no_session(self, mock_rwp):
        mock_rwp.return_value = None
        res = players.action_player_stop()
        self.assertFalse(res["stopped"])
        self.assertEqual(res["reason"], "no active session")

    @patch("aceman_broker.actions.players.read_wrapper_pid")
    @patch("aceman_broker.actions.players.os.getpid")
    def test_player_stop_same_pid(self, mock_getpid, mock_rwp):
        mock_getpid.return_value = 1234
        mock_rwp.return_value = 1234
        res = players.action_player_stop()
        self.assertFalse(res["stopped"])

    @patch("aceman_broker.actions.players.read_wrapper_pid")
    @patch("aceman_broker.actions.players.pid_matches_aceman")
    @patch("aceman_broker.actions.players.os.getpid")
    def test_player_stop_not_aceman(self, mock_getpid, mock_pma, mock_rwp):
        mock_getpid.return_value = 1111
        mock_rwp.return_value = 1234
        mock_pma.return_value = False
        res = players.action_player_stop()
        self.assertFalse(res["stopped"])
        self.assertEqual(res["reason"], "pid is not aceman")
        
    @patch("aceman_broker.actions.players.read_wrapper_pid")
    @patch("aceman_broker.actions.players.pid_matches_aceman")
    @patch("aceman_broker.actions.players.os.getpid")
    @patch("aceman_broker.actions.players.os.kill")
    def test_player_stop_success(self, mock_kill, mock_getpid, mock_pma, mock_rwp):
        mock_getpid.return_value = 1111
        mock_rwp.return_value = 1234
        mock_pma.return_value = True
        
        # first kill works, next kill(pid, 0) raises ProcessLookupError meaning it died
        mock_kill.side_effect = [None, ProcessLookupError]
        
        res = players.action_player_stop()
        self.assertTrue(res["stopped"])

if __name__ == "__main__":
    unittest.main()
