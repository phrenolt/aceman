import os
import signal
import unittest
from unittest.mock import patch, MagicMock

from aceman_broker import main

class TestMain(unittest.TestCase):
    @patch("aceman_broker.main.validate_at_startup")
    @patch("aceman_broker.main.acquire_singleton")
    def test_main_already_running(self, mock_acquire, mock_validate):
        mock_acquire.return_value = None
        self.assertEqual(main.main(), 0)
        mock_validate.assert_called_once()

    @patch("aceman_broker.main.validate_at_startup")
    @patch("aceman_broker.main.acquire_singleton")
    @patch("aceman_broker.main.sock_path")
    @patch("aceman_broker.main.signal.signal")
    @patch("aceman_broker.main.os.stat")
    def test_main_startup_shutdown(self, mock_stat, mock_signal, mock_sock_path, mock_acquire, mock_validate):
        mock_srv = MagicMock()
        mock_srv.accept.side_effect = OSError("Socket closed")
        mock_acquire.return_value = (mock_srv, (10, 20))
        
        mock_sp = MagicMock()
        mock_sock_path.return_value = mock_sp

        mock_stat_obj = MagicMock()
        mock_stat_obj.st_dev = 10
        mock_stat_obj.st_ino = 20
        mock_stat.return_value = mock_stat_obj
        
        handlers = {}
        def mock_signal_call(sig, handler):
            handlers[sig] = handler
            if sig == signal.SIGINT:
                # call handler
                handlers[signal.SIGTERM](signal.SIGTERM, None)
        mock_signal.side_effect = mock_signal_call

        self.assertEqual(main.main(), 0)
        mock_srv.close.assert_called()
        mock_sp.unlink.assert_called_once()
        
    @patch("aceman_broker.main.validate_at_startup")
    @patch("aceman_broker.main.acquire_singleton")
    @patch("aceman_broker.main.sock_path")
    @patch("aceman_broker.main.signal.signal")
    @patch("aceman_broker.main.os.stat")
    def test_main_rebound_socket(self, mock_stat, mock_signal, mock_sock_path, mock_acquire, mock_validate):
        mock_srv = MagicMock()
        mock_srv.accept.side_effect = OSError("Socket closed")
        mock_acquire.return_value = (mock_srv, (10, 20))
        mock_sp = MagicMock()
        mock_sock_path.return_value = mock_sp
        mock_stat_obj = MagicMock()
        mock_stat_obj.st_dev = 10
        mock_stat_obj.st_ino = 99 # different inode
        mock_stat.return_value = mock_stat_obj
        
        handlers = {}
        def mock_signal_call(sig, handler):
            handlers[sig] = handler
            if sig == signal.SIGINT:
                handlers[signal.SIGTERM](signal.SIGTERM, None)
        mock_signal.side_effect = mock_signal_call

        self.assertEqual(main.main(), 0)
        mock_srv.close.assert_called()
        mock_sp.unlink.assert_not_called()

if __name__ == "__main__":
    unittest.main()
