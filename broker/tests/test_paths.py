import os
import pathlib
import unittest
from unittest.mock import patch
from aceman_broker import paths

class TestPaths(unittest.TestCase):
    @patch("aceman_broker.paths.os.environ.get")
    @patch("aceman_broker.paths.os.getuid")
    def test_xdg_runtime_dir_env(self, mock_uid, mock_env_get):
        mock_env_get.return_value = "/custom/runtime"
        self.assertEqual(str(paths.xdg_runtime_dir()), "/custom/runtime")

    @patch("aceman_broker.paths.os.environ.get")
    @patch("aceman_broker.paths.os.getuid")
    def test_xdg_runtime_dir_fallback(self, mock_uid, mock_env_get):
        mock_env_get.return_value = None
        mock_uid.return_value = 1000
        self.assertEqual(str(paths.xdg_runtime_dir()), "/run/user/1000")

    @patch("aceman_broker.paths.xdg_runtime_dir")
    def test_sock_dir(self, mock_xdg):
        mock_xdg.return_value = pathlib.Path("/runtime")
        self.assertEqual(str(paths.sock_dir()), "/runtime/aceman")

    @patch("aceman_broker.paths.sock_dir")
    def test_sock_path(self, mock_sock):
        mock_sock.return_value = pathlib.Path("/runtime/aceman")
        self.assertEqual(str(paths.sock_path()), "/runtime/aceman/broker.sock")
        
    @patch("aceman_broker.paths.xdg_runtime_dir")
    def test_wrapper_pid_file(self, mock_xdg):
        mock_xdg.return_value = pathlib.Path("/runtime")
        self.assertEqual(str(paths.wrapper_pid_file()), "/runtime/aceman.active.pid")

    @patch("aceman_broker.paths.xdg_runtime_dir")
    def test_wrapper_cid_file(self, mock_xdg):
        mock_xdg.return_value = pathlib.Path("/runtime")
        self.assertEqual(str(paths.wrapper_cid_file()), "/runtime/aceman.active.cid")

    @patch("aceman_broker.paths.os.environ.get")
    def test_desktop_applications_dir_env(self, mock_env_get):
        mock_env_get.return_value = "/data"
        self.assertEqual(str(paths.desktop_applications_dir()), "/data/applications")

    @patch("aceman_broker.paths.os.environ.get")
    @patch("aceman_broker.paths.pathlib.Path.home")
    def test_desktop_applications_dir_fallback(self, mock_home, mock_env_get):
        mock_env_get.return_value = None
        mock_home.return_value = pathlib.Path("/home/user")
        self.assertEqual(str(paths.desktop_applications_dir()), "/home/user/.local/share/applications")

    @patch("aceman_broker.paths.os.environ.get")
    def test_mimeapps_list_path_env(self, mock_env_get):
        mock_env_get.return_value = "/conf"
        self.assertEqual(str(paths.mimeapps_list_path()), "/conf/mimeapps.list")

    @patch("aceman_broker.paths.os.environ.get")
    @patch("aceman_broker.paths.pathlib.Path.home")
    def test_mimeapps_list_path_fallback(self, mock_home, mock_env_get):
        mock_env_get.return_value = None
        mock_home.return_value = pathlib.Path("/home/user")
        self.assertEqual(str(paths.mimeapps_list_path()), "/home/user/.config/mimeapps.list")

if __name__ == "__main__":
    unittest.main()
