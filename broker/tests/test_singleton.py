import os
import socket
import unittest
from unittest.mock import patch, MagicMock

from aceman_broker.singleton import acquire_singleton

class TestSingleton(unittest.TestCase):
    @patch("aceman_broker.singleton.sock_dir")
    @patch("aceman_broker.singleton.sock_path")
    @patch("aceman_broker.singleton.os")
    @patch("aceman_broker.singleton.fcntl")
    @patch("aceman_broker.singleton.socket")
    def test_acquire_singleton_success(self, mock_socket, mock_fcntl, mock_os, mock_sock_path, mock_sock_dir):
        mock_sd = MagicMock()
        mock_sock_dir.return_value = mock_sd
        mock_sp = MagicMock()
        mock_sp.exists.return_value = False
        mock_sock_path.return_value = mock_sp
        
        mock_os.open.return_value = 123
        mock_os.O_CREAT = os.O_CREAT
        mock_os.O_RDWR = os.O_RDWR
        mock_stat = MagicMock()
        mock_stat.st_dev = 10
        mock_stat.st_ino = 20
        mock_os.stat.return_value = mock_stat

        mock_srv = MagicMock()
        mock_socket.socket.return_value = mock_srv
        
        res = acquire_singleton()
        self.assertIsNotNone(res)
        srv, dev_ino = res
        self.assertEqual(srv, mock_srv)
        self.assertEqual(dev_ino, (10, 20))
        
        mock_fcntl.flock.assert_called_once()
        mock_srv.bind.assert_called_once_with(str(mock_sp))
        mock_srv.listen.assert_called_once_with(8)

    @patch("aceman_broker.singleton.sock_dir")
    @patch("aceman_broker.singleton.sock_path")
    @patch("aceman_broker.singleton.os")
    @patch("aceman_broker.singleton.fcntl")
    def test_acquire_singleton_blocking(self, mock_fcntl, mock_os, mock_sock_path, mock_sock_dir):
        mock_os.open.return_value = 123
        mock_fcntl.flock.side_effect = BlockingIOError
        
        res = acquire_singleton()
        self.assertIsNone(res)
        mock_os.close.assert_called_once_with(123)

if __name__ == "__main__":
    unittest.main()
