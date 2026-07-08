import unittest
from unittest.mock import patch, MagicMock
import subprocess

from aceman_broker.actions import web_lifecycle

class TestWebLifecycle(unittest.TestCase):
    @patch("aceman_broker.actions.web_lifecycle.STARTUP_COMMIT", "12345")
    def test_broker_version(self):
        res = web_lifecycle.action_broker_version()
        self.assertEqual(res["commit"], "12345")

    @patch("aceman_broker.actions.web_lifecycle.head_sha")
    @patch("aceman_broker.actions.web_lifecycle.image_commit_label")
    def test_restart_preflight(self, mock_icl, mock_head):
        mock_head.return_value = "commit1"
        mock_icl.side_effect = ["commit1", "commit2"]
        res = web_lifecycle.action_restart_preflight()
        self.assertTrue(res["rebuild_recommended"])

    @patch("aceman_broker.actions.web_lifecycle.subprocess.run")
    def test_broker_respawn_preflight_fail(self, mock_run):
        mock_res = MagicMock()
        mock_res.returncode = 1
        mock_res.stderr = "SyntaxError"
        mock_run.return_value = mock_res
        res = web_lifecycle.action_broker_respawn()
        self.assertFalse(res["respawned"])
        self.assertIn("SyntaxError", res["stderr"])
        
    @patch("aceman_broker.actions.web_lifecycle.container_running_named")
    def test_web_restart_not_running(self, mock_crn):
        mock_crn.return_value = False
        with self.assertRaises(RuntimeError):
            web_lifecycle.action_web_restart()

    @patch("aceman_broker.actions.web_lifecycle.container_running_named")
    @patch("aceman_broker.actions.web_lifecycle.subprocess.run")
    def test_web_restart_success(self, mock_run, mock_crn):
        mock_crn.return_value = True
        mock_res = MagicMock()
        mock_res.returncode = 0
        mock_run.return_value = mock_res
        res = web_lifecycle.action_web_restart()
        self.assertTrue(res["restarted"])
        self.assertFalse(res["rebuilt"])

    @patch("aceman_broker.actions.web_lifecycle.container_running_named")
    @patch("aceman_broker.actions.web_lifecycle.pick_up_image_changes")
    @patch("aceman_broker.actions.web_lifecycle.recreate_container")
    def test_web_restart_rebuild(self, mock_rc, mock_pic, mock_crn):
        mock_crn.return_value = True
        res = web_lifecycle.action_web_restart({"rebuild": True})
        self.assertTrue(res["restarted"])
        self.assertTrue(res["rebuilt"])
        mock_pic.assert_called_once()
        mock_rc.assert_called_once()

    def test_parse_mem_str(self):
        self.assertEqual(web_lifecycle._parse_mem_str("1.5 MiB"), int(1.5 * 1024**2))
        self.assertEqual(web_lifecycle._parse_mem_str("500 MB"), 500 * 1000**2)
        self.assertEqual(web_lifecycle._parse_mem_str("invalid"), 0)

if __name__ == "__main__":
    unittest.main()
