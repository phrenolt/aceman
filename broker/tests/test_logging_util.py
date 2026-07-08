import unittest
import sys
from io import StringIO
from unittest.mock import patch
from aceman_broker.logging_util import _safe, _log

class TestLoggingUtil(unittest.TestCase):
    def test_safe(self):
        self.assertEqual(_safe("normal"), "normal")
        self.assertEqual(_safe("with\nnewline"), "with\nnewline")
        self.assertEqual(_safe("with\rreturn"), "with?return")
        self.assertEqual(_safe("with\x1b[31mcolor"), "with?[31mcolor")
        self.assertEqual(_safe(123), "123")
        long_str = "A" * 2000
        self.assertEqual(len(_safe(long_str)), 1024)

    @patch("aceman_broker.logging_util.sys.stderr", new_callable=StringIO)
    def test_log_fmt(self, mock_stderr):
        _log("test", "hello %s", "world")
        self.assertEqual(mock_stderr.getvalue(), "[broker:test] hello world\n")

    @patch("aceman_broker.logging_util.sys.stderr", new_callable=StringIO)
    def test_log_bad_fmt(self, mock_stderr):
        _log("test", "hello %s", "world", "extra")
        self.assertEqual(mock_stderr.getvalue(), "[broker:test] hello %s 'world' 'extra'\n")

if __name__ == "__main__":
    unittest.main()
