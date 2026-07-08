import unittest
from unittest.mock import patch, MagicMock
import subprocess
import json

from aceman_broker.actions import restart_helpers

class TestRestartHelpers(unittest.TestCase):
    @patch("aceman_broker.actions.restart_helpers.subprocess.run")
    def test_image_id(self, mock_run):
        mock_res = MagicMock()
        mock_res.returncode = 0
        mock_res.stdout = "abc12345"
        mock_run.return_value = mock_res
        self.assertEqual(restart_helpers._image_id("tag"), "abc12345")

    @patch("aceman_broker.actions.restart_helpers.subprocess.run")
    def test_image_id_fail(self, mock_run):
        mock_res = MagicMock()
        mock_res.returncode = 1
        mock_run.return_value = mock_res
        self.assertEqual(restart_helpers._image_id("tag"), "")
        
    @patch("aceman_broker.actions.restart_helpers.ENSURE_IMAGE_HELPER")
    @patch("aceman_broker.actions.restart_helpers.image_commit_label")
    @patch("aceman_broker.actions.restart_helpers._image_id")
    @patch("aceman_broker.actions.restart_helpers.subprocess.run")
    def test_pick_up_image_changes_changed_label(self, mock_run, mock_id, mock_icl, mock_eih):
        mock_eih.is_file.return_value = True
        mock_icl.side_effect = ["label1", "label2"]
        mock_id.side_effect = ["id1", "id2"]
        mock_res = MagicMock()
        mock_res.returncode = 0
        mock_run.return_value = mock_res
        
        self.assertTrue(restart_helpers.pick_up_image_changes("engine", "tag"))
        
    @patch("aceman_broker.actions.restart_helpers.ENSURE_IMAGE_HELPER")
    @patch("aceman_broker.actions.restart_helpers.image_commit_label")
    @patch("aceman_broker.actions.restart_helpers._image_id")
    @patch("aceman_broker.actions.restart_helpers.subprocess.run")
    def test_pick_up_image_changes_changed_id(self, mock_run, mock_id, mock_icl, mock_eih):
        mock_eih.is_file.return_value = True
        mock_icl.side_effect = ["", ""]
        mock_id.side_effect = ["id1", "id2"]
        mock_res = MagicMock()
        mock_res.returncode = 0
        mock_run.return_value = mock_res
        
        self.assertTrue(restart_helpers.pick_up_image_changes("engine", "tag"))

    @patch("aceman_broker.actions.restart_helpers.subprocess.check_output")
    @patch("aceman_broker.actions.restart_helpers.subprocess.run")
    def test_recreate_container(self, mock_run, mock_co):
        mock_co.return_value = json.dumps([{"Config": {"CreateCommand": ["podman", "run", "img"]}}]).encode()
        mock_res = MagicMock()
        mock_res.returncode = 0
        mock_run.return_value = mock_res
        
        restart_helpers.recreate_container("test")
        
        self.assertEqual(mock_run.call_count, 2)
        rm_call = mock_run.call_args_list[0]
        self.assertEqual(rm_call[0][0][:3], ["podman", "rm", "-f"])
        
        run_call = mock_run.call_args_list[1]
        self.assertEqual(run_call[0][0], ["podman", "run", "-d", "img"])

if __name__ == "__main__":
    unittest.main()
