import pathlib
import subprocess
import unittest
from unittest.mock import patch, MagicMock

from aceman_broker import scheme_handler

class TestSchemeHandler(unittest.TestCase):
    @patch("aceman_broker.scheme_handler.shutil.which")
    @patch("aceman_broker.scheme_handler.subprocess.run")
    def test_query_current_scheme_handler_success(self, mock_run, mock_which):
        mock_which.return_value = "/usr/bin/xdg-mime"
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = "aceman.desktop\n"
        mock_run.return_value = mock_result
        self.assertEqual(scheme_handler.query_current_scheme_handler(), "aceman.desktop")
        
    @patch("aceman_broker.scheme_handler.shutil.which")
    def test_query_current_scheme_handler_missing_xdg_mime(self, mock_which):
        mock_which.return_value = None
        self.assertIsNone(scheme_handler.query_current_scheme_handler())

    @patch("aceman_broker.scheme_handler.shutil.which")
    @patch("aceman_broker.scheme_handler.subprocess.run")
    def test_query_current_scheme_handler_fail(self, mock_run, mock_which):
        mock_which.return_value = "/usr/bin/xdg-mime"
        mock_result = MagicMock()
        mock_result.returncode = 1
        mock_run.return_value = mock_result
        self.assertIsNone(scheme_handler.query_current_scheme_handler())

    @patch("aceman_broker.scheme_handler.shutil.which")
    @patch("aceman_broker.scheme_handler.subprocess.run")
    def test_query_current_scheme_handler_empty(self, mock_run, mock_which):
        mock_which.return_value = "/usr/bin/xdg-mime"
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = "\n"
        mock_run.return_value = mock_result
        self.assertIsNone(scheme_handler.query_current_scheme_handler())

    @patch("aceman_broker.scheme_handler.shutil.which")
    @patch("aceman_broker.scheme_handler.subprocess.run")
    def test_query_current_scheme_handler_timeout(self, mock_run, mock_which):
        mock_which.return_value = "/usr/bin/xdg-mime"
        mock_run.side_effect = subprocess.TimeoutExpired(cmd="xdg-mime", timeout=5)
        self.assertIsNone(scheme_handler.query_current_scheme_handler())

    @patch("aceman_broker.scheme_handler.shutil.which")
    @patch("aceman_broker.scheme_handler.subprocess.run")
    def test_refresh_desktop_database(self, mock_run, mock_which):
        mock_which.return_value = "/usr/bin/update-desktop-database"
        p = pathlib.Path("/tmp/apps")
        scheme_handler.refresh_desktop_database(p)
        mock_run.assert_called_once_with(["update-desktop-database", "/tmp/apps"], capture_output=True, timeout=10)

    @patch("aceman_broker.scheme_handler.shutil.which")
    @patch("aceman_broker.scheme_handler.subprocess.run")
    def test_refresh_desktop_database_missing(self, mock_run, mock_which):
        mock_which.return_value = None
        scheme_handler.refresh_desktop_database(pathlib.Path("/tmp"))
        mock_run.assert_not_called()

    @patch("aceman_broker.scheme_handler.shutil.which")
    @patch("aceman_broker.scheme_handler.subprocess.run")
    def test_refresh_desktop_database_timeout(self, mock_run, mock_which):
        mock_which.return_value = "/usr/bin/update-desktop-database"
        mock_run.side_effect = subprocess.TimeoutExpired(cmd="update", timeout=10)
        # Should catch exception and not raise
        scheme_handler.refresh_desktop_database(pathlib.Path("/tmp"))

if __name__ == "__main__":
    unittest.main()
