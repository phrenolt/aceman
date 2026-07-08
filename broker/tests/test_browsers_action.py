import unittest
from unittest.mock import patch, MagicMock

from aceman_broker.actions import browsers

class TestBrowsersAction(unittest.TestCase):
    @patch("aceman_broker.actions.browsers._BROWSER_PROBES", {"linux": [lambda: [{"name": "firefox", "source": "system", "argv": ["/bin/firefox"]}]]})
    @patch("aceman_broker.actions.browsers.PLATFORM", "linux")
    def test_browsers_list(self):
        res = browsers.action_browsers_list()
        self.assertEqual(res["platform"], "linux")
        self.assertEqual(len(res["available"]), 1)
        self.assertEqual(res["available"][0]["name"], "firefox")

    @patch("aceman_broker.actions.browsers.action_browsers_list")
    def test_resolve_argv(self, mock_abl):
        mock_abl.return_value = {"available": [{"name": "firefox", "source": "system", "argv": ["/bin/firefox"]}]}
        self.assertEqual(browsers._resolve_argv("firefox", "system"), ["/bin/firefox"])
        self.assertEqual(browsers._resolve_argv("firefox", ""), ["/bin/firefox"])
        self.assertIsNone(browsers._resolve_argv("brave", ""))

    @patch("aceman_broker.actions.browsers._resolve_argv")
    @patch("aceman_broker.actions.browsers.subprocess.Popen")
    def test_browser_spawn_success(self, mock_popen, mock_ra):
        mock_ra.return_value = ["/bin/firefox"]
        res = browsers.action_browser_spawn({"name": "firefox", "source": "system", "url": "https://example.com"})
        self.assertTrue(res["opened"])
        mock_popen.assert_called_once()
        
    def test_browser_spawn_invalid_url(self):
        res = browsers.action_browser_spawn({"name": "firefox", "url": "javascript:alert(1)"})
        self.assertFalse(res["opened"])
        self.assertEqual(res["reason"], "invalid url")

    def test_browser_spawn_missing_name(self):
        res = browsers.action_browser_spawn({"url": "https://example.com"})
        self.assertFalse(res["opened"])
        self.assertEqual(res["reason"], "missing name")
        
    @patch("aceman_broker.actions.browsers._resolve_argv")
    def test_browser_spawn_not_found(self, mock_ra):
        mock_ra.return_value = None
        res = browsers.action_browser_spawn({"name": "firefox", "url": "https://example.com"})
        self.assertFalse(res["opened"])
        self.assertIn("not found", res["reason"])

if __name__ == "__main__":
    unittest.main()
