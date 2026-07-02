"""Tests for the engine LAN-exposure action and the engine gateway.

Two modes:
  * gateway (default): the engine has no host port; a gateway container
    publishes it and blocks browser requests. The LAN toggle re-spawns
    only the gateway. The engine env carries ACE_ENGINE_GATEWAY=1 and
    never ACE_API_HOST.
  * opt-out (ACE_ENGINE_GATEWAY=0): the engine publishes its own port;
    the LAN toggle re-spawns the engine with ACE_API_HOST=0.0.0.0.

Everything is mocked — no podman, no real socket, no subprocess.
"""

from __future__ import annotations

from . import _setup  # noqa: F401

import unittest
import unittest.mock as mock

from aceman_broker.actions import engine


class LanInfoTests(unittest.TestCase):
    def tearDown(self):
        engine._lan_exposed = False

    def test_port_parsed_from_engine_url(self):
        self.assertEqual(engine._lan_port(), 6878)

    def test_default_is_loopback(self):
        self.assertFalse(engine._lan_exposed)

    def test_lan_info_shape(self):
        engine._lan_exposed = True
        with mock.patch.object(engine, "_detect_lan_ip",
                               return_value="192.168.1.5"):
            info = engine._lan_info()
        self.assertEqual(
            info,
            {"lan_exposed": True, "lan_ip": "192.168.1.5", "lan_port": 6878})


class GatewayHelperTests(unittest.TestCase):
    def tearDown(self):
        engine._lan_exposed = False

    def test_publish_host_follows_exposure(self):
        engine._lan_exposed = False
        self.assertEqual(engine._gateway_publish_host(), "127.0.0.1")
        engine._lan_exposed = True
        self.assertEqual(engine._gateway_publish_host(), "0.0.0.0")

    def test_start_gateway_passes_publish_host_and_image(self):
        engine._lan_exposed = True
        captured = {}

        def fake_run(cmd, env=None, **kw):
            captured["cmd"] = cmd
            captured["env"] = env
            return mock.Mock(returncode=0, stdout="", stderr="")

        with mock.patch.dict("os.environ", {}, clear=True), \
                mock.patch.object(engine.subprocess, "run",
                                  side_effect=fake_run):
            engine._start_gateway_unlocked()
        self.assertEqual(captured["env"]["ACE_GW_HOST"], "0.0.0.0")
        self.assertEqual(captured["env"]["ACE_GW_NAME"], engine.GATEWAY_NAME)
        self.assertEqual(captured["env"]["ACE_NAME"], engine.NAME)
        self.assertEqual(captured["env"]["ACE_WEB_IMAGE"], engine.WEB_IMAGE)


class StartEnvGatewayModeTests(unittest.TestCase):
    """Default mode: engine env says gateway=1, never ACE_API_HOST, and the
    gateway is brought up as part of the start."""

    def tearDown(self):
        engine._lan_exposed = False

    def _start(self):
        captured = {}

        def fake_run(cmd, env=None, **kw):
            captured["env"] = env
            return mock.Mock(returncode=0, stdout="", stderr="")

        gw = mock.Mock()
        with mock.patch.dict("os.environ", {}, clear=True), \
                mock.patch.object(engine, "ENGINE_GATEWAY", True), \
                mock.patch.object(engine, "container_running",
                                  return_value=False), \
                mock.patch.object(engine, "_start_gateway_unlocked", gw), \
                mock.patch.object(engine.subprocess, "run",
                                  side_effect=fake_run), \
                mock.patch.object(engine, "engine_probe", return_value=True):
            engine._start_engine_unlocked()
        return captured["env"], gw

    def test_sets_gateway_flag_no_api_host(self):
        engine._lan_exposed = False
        env, gw = self._start()
        self.assertEqual(env.get("ACE_ENGINE_GATEWAY"), "1")
        self.assertNotIn("ACE_API_HOST", env)
        gw.assert_called_once()

    def test_no_api_host_even_when_exposed(self):
        engine._lan_exposed = True
        env, gw = self._start()
        self.assertNotIn("ACE_API_HOST", env)
        gw.assert_called_once()


class StartEnvOptOutTests(unittest.TestCase):
    """Opt-out mode: engine publishes itself; ACE_API_HOST follows exposure;
    no gateway is started."""

    def tearDown(self):
        engine._lan_exposed = False

    def _start(self):
        captured = {}

        def fake_run(cmd, env=None, **kw):
            captured["env"] = env
            return mock.Mock(returncode=0, stdout="", stderr="")

        gw = mock.Mock()
        with mock.patch.dict("os.environ", {}, clear=True), \
                mock.patch.object(engine, "ENGINE_GATEWAY", False), \
                mock.patch.object(engine, "container_running",
                                  return_value=False), \
                mock.patch.object(engine, "_start_gateway_unlocked", gw), \
                mock.patch.object(engine.subprocess, "run",
                                  side_effect=fake_run), \
                mock.patch.object(engine, "engine_probe", return_value=True):
            engine._start_engine_unlocked()
        return captured["env"], gw

    def test_loopback_by_default(self):
        engine._lan_exposed = False
        env, gw = self._start()
        self.assertEqual(env.get("ACE_ENGINE_GATEWAY"), "0")
        self.assertNotIn("ACE_API_HOST", env)
        gw.assert_not_called()

    def test_bind_all_when_exposed(self):
        engine._lan_exposed = True
        env, gw = self._start()
        self.assertEqual(env.get("ACE_API_HOST"), "0.0.0.0")
        gw.assert_not_called()


class SetLanTests(unittest.TestCase):
    def tearDown(self):
        engine._lan_exposed = False

    def test_rejects_non_bool(self):
        for bad in ("true", 1, None):
            with self.subTest(bad=bad):
                with self.assertRaises(ValueError):
                    engine.action_engine_set_lan({"enabled": bad})

    def test_enable_when_not_running_sets_flag_only(self):
        with mock.patch.object(engine, "container_running",
                               return_value=False), \
                mock.patch.object(engine, "_detect_lan_ip", return_value=""):
            r = engine.action_engine_set_lan({"enabled": True})
        self.assertTrue(engine._lan_exposed)
        self.assertTrue(r["lan_exposed"])
        self.assertFalse(r["relaunched"])

    def test_gateway_mode_respawns_only_gateway(self):
        with mock.patch.object(engine, "ENGINE_GATEWAY", True), \
                mock.patch.object(engine, "container_running",
                                  return_value=True), \
                mock.patch.object(engine, "_detect_lan_ip", return_value=""), \
                mock.patch.object(engine, "_start_gateway_unlocked") as gw, \
                mock.patch.object(engine, "_stop_engine_unlocked") as stop, \
                mock.patch.object(engine, "_start_engine_unlocked") as start:
            r = engine.action_engine_set_lan({"enabled": True})
        gw.assert_called_once()
        stop.assert_not_called()
        start.assert_not_called()
        self.assertTrue(r["relaunched"])

    def test_optout_mode_respawns_engine(self):
        with mock.patch.object(engine, "ENGINE_GATEWAY", False), \
                mock.patch.object(engine, "container_running",
                                  return_value=True), \
                mock.patch.object(engine, "_detect_lan_ip", return_value=""), \
                mock.patch.object(engine, "_start_gateway_unlocked") as gw, \
                mock.patch.object(engine, "_stop_engine_unlocked") as stop, \
                mock.patch.object(engine, "_start_engine_unlocked") as start:
            r = engine.action_engine_set_lan({"enabled": True})
        gw.assert_not_called()
        stop.assert_called_once()
        start.assert_called_once()
        self.assertTrue(r["relaunched"])

    def test_no_change_does_not_bounce(self):
        with mock.patch.object(engine, "container_running",
                               return_value=True), \
                mock.patch.object(engine, "_detect_lan_ip", return_value=""), \
                mock.patch.object(engine, "_start_gateway_unlocked") as gw, \
                mock.patch.object(engine, "_stop_engine_unlocked") as stop:
            r = engine.action_engine_set_lan({"enabled": False})
        gw.assert_not_called()
        stop.assert_not_called()
        self.assertFalse(r["relaunched"])


class StopTests(unittest.TestCase):
    def test_gateway_torn_down_on_stop(self):
        with mock.patch.object(engine, "ENGINE_GATEWAY", True), \
                mock.patch.object(engine, "container_running",
                                  return_value=False), \
                mock.patch.object(engine, "_stop_gateway") as gw:
            engine._stop_engine_unlocked()
        gw.assert_called_once()


if __name__ == "__main__":
    unittest.main()
