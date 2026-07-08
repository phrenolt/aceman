import pathlib
import subprocess
import unittest
from unittest.mock import patch, MagicMock

from aceman_broker.actions import desktop

class TestDesktopAction(unittest.TestCase):
    @patch("aceman_broker.actions.desktop._desktop_path")
    def test_desktop_status(self, mock_dp):
        mock_path = MagicMock()
        mock_path.is_file.return_value = True
        mock_dp.return_value = mock_path
        res = desktop.action_desktop_status()
        self.assertTrue(res["installed"])
        
    @patch("aceman_broker.actions.desktop._desktop_path")
    @patch("aceman_broker.actions.desktop.query_current_scheme_handler")
    @patch("aceman_broker.actions.desktop.refresh_desktop_database")
    @patch("aceman_broker.actions.desktop.mimeapps_list_path")
    @patch("aceman_broker.actions.desktop.shutil")
    @patch("aceman_broker.actions.desktop.subprocess")
    def test_desktop_install(self, mock_subprocess, mock_shutil, mock_mlp, mock_rdd, mock_qcsh, mock_dp):
        mock_path = MagicMock()
        mock_dp.return_value = mock_path
        mock_qcsh.return_value = None
        mock_shutil.which.return_value = "/usr/bin/xdg-mime"
        
        res = desktop.action_desktop_install({"host": "127.0.0.1", "port": 8080})
        self.assertEqual(res["scheme"], "x-scheme-handler/acestream")
        
    @patch("aceman_broker.actions.desktop._desktop_path")
    @patch("aceman_broker.actions.desktop.refresh_desktop_database")
    @patch("aceman_broker.actions.desktop._scrub_mimeapps_entry")
    def test_desktop_uninstall(self, mock_sme, mock_rdd, mock_dp):
        mock_path = MagicMock()
        mock_path.is_file.return_value = False
        mock_dp.return_value = mock_path
        mock_sme.return_value = True
        
        res = desktop.action_desktop_uninstall()
        self.assertTrue(res["removed"])
        self.assertTrue(res["mimeapps_scrubbed"])
        
    @patch("aceman_broker.actions.desktop.mimeapps_list_path")
    @patch("aceman_broker.actions.desktop.shutil")
    def test_restore_backup(self, mock_shutil, mock_mlp):
        mock_path = MagicMock()
        mock_mlp.return_value = mock_path
        mock_bk = MagicMock()
        mock_bk.is_file.return_value = True
        mock_path.with_name.return_value = mock_bk
        
        res = desktop.action_desktop_restore_mimeapps_backup()
        self.assertTrue(res["restored"])
        mock_bk.unlink.assert_called_once()

if __name__ == "__main__":
    unittest.main()
