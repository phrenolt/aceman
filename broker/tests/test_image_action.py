import unittest
from unittest.mock import patch, MagicMock

from aceman_broker.actions import image

class TestImageAction(unittest.TestCase):
    @patch("aceman_broker.actions.image.build_state")
    @patch("aceman_broker.actions.image.image_present")
    def test_image_status(self, mock_ip, mock_bs):
        mock_bs.is_busy.return_value = False
        mock_bs.state.side_effect = ["unknown", "installed"]
        mock_bs.error.return_value = None
        mock_bs.tail.return_value = ["line"]
        mock_ip.return_value = True

        res = image.action_image_status()
        self.assertEqual(res["installed"], True)
        self.assertEqual(res["state"], "installed")
        self.assertEqual(res["log_tail"], ["line"])

    @patch("aceman_broker.actions.image.PROJECT_ROOT")
    @patch("aceman_broker.actions.image.build_state")
    def test_image_install_missing_tarball(self, mock_bs, mock_pr):
        mock_tarball = MagicMock()
        mock_tarball.is_file.return_value = False
        mock_pr.__truediv__.return_value.__truediv__.return_value.__truediv__.return_value.__truediv__.return_value = mock_tarball
        
        mock_bs.is_busy.return_value = False
        mock_bs.state.return_value = "failed"
        mock_bs.error.return_value = "engine.tar.gz not found"
        mock_bs.tail.return_value = []
        
        res = image.action_image_install()
        self.assertEqual(res["state"], "failed")
        mock_bs.transition.assert_called_with("failed", error=unittest.mock.ANY)

    @patch("aceman_broker.actions.image.subprocess.run")
    @patch("aceman_broker.actions.image.build_state")
    def test_image_remove_success(self, mock_bs, mock_run):
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_run.return_value = mock_result
        
        res = image.action_image_remove()
        self.assertTrue(res["removed"])
        mock_bs.transition.assert_called_with("absent")

    @patch("aceman_broker.actions.image.subprocess.run")
    def test_image_remove_fail(self, mock_run):
        mock_result = MagicMock()
        mock_result.returncode = 1
        mock_result.stderr = "error removing"
        mock_run.return_value = mock_result
        
        res = image.action_image_remove()
        self.assertFalse(res["removed"])
        self.assertEqual(res["error"], "error removing")

if __name__ == "__main__":
    unittest.main()
