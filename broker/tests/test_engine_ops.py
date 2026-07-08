import unittest
from unittest.mock import patch, MagicMock

from aceman_broker import engine_ops

class TestEngineOps(unittest.TestCase):
    @patch("aceman_broker.engine_ops.urllib.request.urlopen")
    def test_engine_probe_success(self, mock_urlopen):
        mock_r = MagicMock()
        mock_r.status = 200
        mock_urlopen.return_value.__enter__.return_value = mock_r
        self.assertTrue(engine_ops.engine_probe())
        
    @patch("aceman_broker.engine_ops.subprocess.run")
    def test_container_running_named(self, mock_run):
        mock_res = MagicMock()
        mock_res.returncode = 0
        mock_res.stdout = "test_name\nother_name\n"
        mock_run.return_value = mock_res
        self.assertTrue(engine_ops.container_running_named("test_name"))
        self.assertFalse(engine_ops.container_running_named("not_found"))
        
    @patch("aceman_broker.engine_ops.subprocess.run")
    def test_container_state(self, mock_run):
        mock_res = MagicMock()
        mock_res.returncode = 0
        mock_res.stdout = "running\n"
        mock_run.return_value = mock_res
        self.assertEqual(engine_ops.container_state(), "running")
        
        mock_res.stdout = "stopping\n"
        self.assertEqual(engine_ops.container_state(), "exited")
        
        mock_res.stdout = "paused\n"
        self.assertEqual(engine_ops.container_state(), "running")

    @patch("aceman_broker.engine_ops.subprocess.run")
    def test_image_present(self, mock_run):
        mock_res = MagicMock()
        mock_res.returncode = 0
        mock_run.return_value = mock_res
        self.assertTrue(engine_ops.image_present())
        
    @patch("aceman_broker.engine_ops.subprocess.run")
    def test_image_commit_label(self, mock_run):
        mock_res = MagicMock()
        mock_res.returncode = 0
        mock_res.stdout = " 123456\n"
        mock_run.return_value = mock_res
        self.assertEqual(engine_ops.image_commit_label("tag"), "123456")

if __name__ == "__main__":
    unittest.main()
