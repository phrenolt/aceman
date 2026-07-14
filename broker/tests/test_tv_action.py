import unittest
from unittest.mock import patch

from aceman_broker.actions import tv


class TestTvValidation(unittest.TestCase):
    def test_valid_ip(self):
        self.assertTrue(tv._valid_ip("192.168.88.192"))
        self.assertTrue(tv._valid_ip("10.0.0.1"))
        self.assertFalse(tv._valid_ip("256.1.1.1"))
        self.assertFalse(tv._valid_ip("192.168.88"))
        self.assertFalse(tv._valid_ip("1.2.3.4; rm -rf /"))
        self.assertFalse(tv._valid_ip("example.com"))
        self.assertFalse(tv._valid_ip(None))

    def test_connect_invalid_ip(self):
        self.assertEqual(tv.action_tv_connect({"ip": "nope"})["status"], "invalid-ip")

    def test_cast_invalid_ip(self):
        res = tv.action_tv_cast({"ip": "nope", "cid": "a" * 40})
        self.assertFalse(res["cast"])
        self.assertEqual(res["status"], "invalid-ip")

    def test_cast_invalid_cid(self):
        res = tv.action_tv_cast({"ip": "192.168.1.5", "cid": "xyz"})
        self.assertFalse(res["cast"])
        self.assertEqual(res["status"], "invalid-cid")


class TestTvConnect(unittest.TestCase):
    @patch("aceman_broker.actions.tv.shutil.which", return_value=None)
    def test_no_adb(self, _which):
        self.assertEqual(
            tv.action_tv_connect({"ip": "192.168.1.5"})["status"], "no-adb")

    @patch("aceman_broker.actions.tv._connect", return_value="device")
    @patch("aceman_broker.actions.tv.shutil.which", return_value="/usr/bin/adb")
    def test_authorized(self, _which, _conn):
        res = tv.action_tv_connect({"ip": "192.168.1.5"})
        self.assertEqual(res["status"], "authorized")
        self.assertEqual(res["ip"], "192.168.1.5")

    @patch("aceman_broker.actions.tv._connect", return_value="unauthorized")
    @patch("aceman_broker.actions.tv.shutil.which", return_value="/usr/bin/adb")
    def test_unauthorized(self, _which, _conn):
        self.assertEqual(
            tv.action_tv_connect({"ip": "192.168.1.5"})["status"], "unauthorized")

    @patch("aceman_broker.actions.tv._connect", return_value="")
    @patch("aceman_broker.actions.tv.shutil.which", return_value="/usr/bin/adb")
    def test_unreachable(self, _which, _conn):
        self.assertEqual(
            tv.action_tv_connect({"ip": "192.168.1.5"})["status"], "unreachable")


class TestDeviceState(unittest.TestCase):
    @patch("aceman_broker.actions.tv._adb")
    def test_parses_device_line(self, mock_adb):
        mock_adb.return_value = (0, "List of devices attached\n"
                                    "192.168.1.5:5555\tdevice\n")
        self.assertEqual(tv._device_state("192.168.1.5"), "device")

    @patch("aceman_broker.actions.tv._adb")
    def test_unauthorized_line(self, mock_adb):
        mock_adb.return_value = (0, "192.168.1.5:5555\tunauthorized\n")
        self.assertEqual(tv._device_state("192.168.1.5"), "unauthorized")

    @patch("aceman_broker.actions.tv._adb")
    def test_not_listed(self, mock_adb):
        mock_adb.return_value = (0, "192.168.9.9:5555\tdevice\n")
        self.assertEqual(tv._device_state("192.168.1.5"), "")

    @patch("aceman_broker.actions.tv._adb", side_effect=OSError("boom"))
    def test_adb_error_is_empty(self, _mock_adb):
        self.assertEqual(tv._device_state("192.168.1.5"), "")


class TestTvCast(unittest.TestCase):
    @patch("aceman_broker.actions.tv._connect", return_value="unauthorized")
    @patch("aceman_broker.actions.tv.shutil.which", return_value="/usr/bin/adb")
    def test_cast_not_authorized(self, _which, _conn):
        res = tv.action_tv_cast({"ip": "192.168.1.5", "cid": "a" * 40})
        self.assertFalse(res["cast"])
        self.assertEqual(res["status"], "unauthorized")

    @patch("aceman_broker.actions.tv._detect_lan_ip", return_value="192.168.1.10")
    @patch("aceman_broker.actions.tv._lan_port", return_value=6878)
    @patch("aceman_broker.actions.tv._adb", return_value=(0, "Starting: Intent {...}"))
    @patch("aceman_broker.actions.tv._connect", return_value="device")
    @patch("aceman_broker.actions.tv.shutil.which", return_value="/usr/bin/adb")
    def test_cast_success(self, _which, _conn, mock_adb, _port, _ip):
        cid = "a" * 40
        res = tv.action_tv_cast({"ip": "192.168.1.5", "cid": cid})
        self.assertTrue(res["cast"])
        self.assertEqual(res["status"], "casting")
        # URL built from OUR lan ip + port + cid, never a client value.
        self.assertIn(f"http://192.168.1.10:6878/ace/getstream?id={cid}", res["url"])
        # The intent argv targets VLC's StartActivity and single-quotes the URL.
        args = mock_adb.call_args[0]
        joined = " ".join(str(a) for a in args)
        self.assertIn("org.videolan.vlc/.StartActivity", joined)
        self.assertIn(f"'http://192.168.1.10:6878/ace/getstream?id={cid}'", joined)

    @patch("aceman_broker.actions.tv._detect_lan_ip", return_value="192.168.1.10")
    @patch("aceman_broker.actions.tv._lan_port", return_value=6878)
    @patch("aceman_broker.actions.tv._adb",
           return_value=(0, "Error: Activity not started"))
    @patch("aceman_broker.actions.tv._connect", return_value="device")
    @patch("aceman_broker.actions.tv.shutil.which", return_value="/usr/bin/adb")
    def test_cast_launch_failed(self, _which, _conn, _adb, _port, _ip):
        res = tv.action_tv_cast({"ip": "192.168.1.5", "cid": "a" * 40})
        self.assertFalse(res["cast"])
        self.assertEqual(res["status"], "launch-failed")

    @patch("aceman_broker.actions.tv._detect_lan_ip", return_value="")
    @patch("aceman_broker.actions.tv._connect", return_value="device")
    @patch("aceman_broker.actions.tv.shutil.which", return_value="/usr/bin/adb")
    def test_cast_no_lan_ip(self, _which, _conn, _ip):
        res = tv.action_tv_cast({"ip": "192.168.1.5", "cid": "a" * 40})
        self.assertFalse(res["cast"])
        self.assertEqual(res["status"], "no-lan-ip")


if __name__ == "__main__":
    unittest.main()
