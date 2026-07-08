import sys
import unittest
from unittest.mock import patch, MagicMock

from aceman_broker import config

class TestConfig(unittest.TestCase):
    @patch("aceman_broker.config.subprocess.run")
    def test_head_sha_success(self, mock_run):
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = " 123456 \n"
        mock_run.return_value = mock_result
        self.assertEqual(config.head_sha(), "123456")

    @patch("aceman_broker.config.subprocess.run")
    def test_head_sha_fail(self, mock_run):
        mock_result = MagicMock()
        mock_result.returncode = 1
        mock_run.return_value = mock_result
        self.assertEqual(config.head_sha(), "")
        
    @patch("aceman_broker.config.RUN_SH")
    @patch("aceman_broker.config.RUN_GW_SH")
    @patch("aceman_broker.config.validate_container_name")
    @patch("aceman_broker.config.validate_image_tag")
    @patch("aceman_broker.config.validate_engine_url")
    def test_validate_at_startup_success(self, mock_veu, mock_vit, mock_vcn, mock_gw_sh, mock_run_sh):
        mock_run_sh.is_file.return_value = True
        mock_gw_sh.is_file.return_value = True
        # should not raise
        config.validate_at_startup()

    @patch("aceman_broker.config.RUN_SH")
    @patch("aceman_broker.config.validate_container_name")
    def test_validate_at_startup_missing_run_sh(self, mock_vcn, mock_run_sh):
        mock_run_sh.is_file.return_value = False
        with self.assertRaises(SystemExit):
            config.validate_at_startup()

if __name__ == "__main__":
    unittest.main()
