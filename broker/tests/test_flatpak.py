import unittest
import time
from unittest.mock import patch, MagicMock

from aceman_broker import flatpak

class TestFlatpak(unittest.TestCase):
    def setUp(self):
        flatpak.reset_cache_for_tests()

    @patch("aceman_broker.flatpak.shutil.which")
    @patch("aceman_broker.flatpak.subprocess.run")
    def test_query_flatpak_list(self, mock_run, mock_which):
        mock_which.return_value = "/bin/flatpak"
        mock_res = MagicMock()
        mock_res.returncode = 0
        mock_res.stdout = b"org.mozilla.firefox\ncom.brave.Browser\n"
        mock_run.return_value = mock_res
        
        ids = flatpak._query_flatpak_list()
        self.assertEqual(ids, frozenset(["org.mozilla.firefox", "com.brave.Browser"]))

    @patch("aceman_broker.flatpak._query_flatpak_list")
    def test_has_flatpak_app(self, mock_qfl):
        mock_qfl.return_value = frozenset(["org.mozilla.firefox"])
        self.assertTrue(flatpak.has_flatpak_app("org.mozilla.firefox"))
        self.assertFalse(flatpak.has_flatpak_app("com.brave.Browser"))
        
        # Test caching
        mock_qfl.reset_mock()
        self.assertTrue(flatpak.has_flatpak_app("org.mozilla.firefox"))
        mock_qfl.assert_not_called()

if __name__ == "__main__":
    unittest.main()
