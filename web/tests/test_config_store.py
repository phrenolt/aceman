import json
import pathlib
import tempfile
import unittest

from server.config_store import Config


class TestConfigStore(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.config_path = pathlib.Path(self.temp_dir.name) / "config.json"

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_defaults(self):
        config = Config(self.config_path)
        self.assertEqual(config.get("engine_autostart"), True)
        self.assertEqual(config.get("default_player"), "")
        self.assertEqual(config.get("buffer_secs"), 10)
        self.assertEqual(config.get("unknown_key", "fallback"), "fallback")

    def test_load_existing_valid(self):
        self.config_path.write_text(json.dumps({"engine_autostart": False, "buffer_secs": 20}))
        config = Config(self.config_path)
        self.assertEqual(config.get("engine_autostart"), False)
        self.assertEqual(config.get("buffer_secs"), 20)

    def test_load_existing_invalid_type(self):
        self.config_path.write_text(json.dumps({"engine_autostart": "not_a_bool"}))
        config = Config(self.config_path)
        self.assertEqual(config.get("engine_autostart"), True)  # Falls back to default

    def test_load_corrupt_file(self):
        self.config_path.write_text("{invalid_json: true")
        config = Config(self.config_path)
        self.assertEqual(config.get("engine_autostart"), True)  # Uses default

    def test_update_valid(self):
        config = Config(self.config_path)
        new_state = config.update({"engine_autostart": False, "buffer_secs": 15})
        self.assertEqual(new_state["engine_autostart"], False)
        self.assertEqual(new_state["buffer_secs"], 15)
        
        # Verify file was written
        loaded = json.loads(self.config_path.read_text())
        self.assertEqual(loaded["engine_autostart"], False)
        self.assertEqual(loaded["buffer_secs"], 15)

    def test_update_invalid_key(self):
        config = Config(self.config_path)
        with self.assertRaisesRegex(ValueError, "unknown config key: bad_key"):
            config.update({"bad_key": True})

    def test_update_invalid_type(self):
        config = Config(self.config_path)
        with self.assertRaisesRegex(ValueError, "config key buffer_secs must be int"):
            config.update({"buffer_secs": "15"})

    def test_snapshot(self):
        config = Config(self.config_path)
        config.update({"buffer_secs": 5})
        snap = config.snapshot()
        self.assertEqual(snap["buffer_secs"], 5)
        snap["buffer_secs"] = 100
        self.assertEqual(config.get("buffer_secs"), 5)  # Snapshot modification doesn't affect original
