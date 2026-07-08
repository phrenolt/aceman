import unittest
from aceman_broker.desktop_helpers import desktop_quote_arg

class TestDesktopHelpers(unittest.TestCase):
    def test_desktop_quote_arg(self):
        self.assertEqual(desktop_quote_arg("abc"), '"abc"')
        self.assertEqual(desktop_quote_arg("a\\b\"c`d$e"), '"a\\\\b\\"c\\`d\\$e"')

if __name__ == "__main__":
    unittest.main()
