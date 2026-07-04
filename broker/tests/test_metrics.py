"""Tests for host CPU / GPU utilisation sampling (sys.usage).

CPU is a /proc/stat busy-delta between calls (first call has no baseline).
GPU is vendor-aware: NVIDIA via nvidia-smi, AMD + Intel-Xe via the
gpu_busy_percent sysfs, and unavailable (None) when the driver exposes no
load metric (older Intel i915). The rolling window averages over ~10 s.
"""

from __future__ import annotations

from . import _setup  # noqa: F401

import os
import pathlib
import tempfile
import unittest
import unittest.mock as mock

from aceman_broker.actions import metrics


def _make_card(root: pathlib.Path, name: str, driver: str,
               busy: "str | None") -> pathlib.Path:
    """Build a fake /sys/class/drm/<name> with a driver symlink whose
    resolved basename is <driver>, and optionally a gpu_busy_percent file."""
    card = root / name
    device = card / "device"
    device.mkdir(parents=True)
    driver_target = root / "_drivers" / driver
    driver_target.mkdir(parents=True, exist_ok=True)
    os.symlink(driver_target, device / "driver")
    if busy is not None:
        (device / "gpu_busy_percent").write_text(busy)
    return card


class CpuSamplingTests(unittest.TestCase):
    def setUp(self):
        metrics._prev_cpu = None
        metrics._window.clear()

    def test_read_cpu_times_parses_idle_and_total(self):
        line = "cpu  100 20 30 700 40 5 5 0 0 0\n"
        with mock.patch("builtins.open", mock.mock_open(read_data=line)):
            total, idle = metrics._read_cpu_times()
        self.assertEqual(idle, 700 + 40)          # idle + iowait
        self.assertEqual(total, 100 + 20 + 30 + 700 + 40 + 5 + 5)

    def test_cpu_pct_none_on_first_call_then_delta(self):
        # First call establishes the baseline and returns None.
        with mock.patch.object(metrics, "_read_cpu_times", return_value=(1000, 800)):
            self.assertIsNone(metrics._cpu_pct())
        # +100 idle of +200 total ⇒ 50% busy.
        with mock.patch.object(metrics, "_read_cpu_times", return_value=(1200, 900)):
            self.assertEqual(metrics._cpu_pct(), 50.0)

    def test_cpu_pct_zero_delta_is_none(self):
        with mock.patch.object(metrics, "_read_cpu_times", return_value=(1000, 800)):
            metrics._cpu_pct()
        with mock.patch.object(metrics, "_read_cpu_times", return_value=(1000, 800)):
            self.assertIsNone(metrics._cpu_pct())


class GpuVendorTests(unittest.TestCase):
    def test_kind_nvidia_via_smi(self):
        with mock.patch("shutil.which", return_value="/usr/bin/nvidia-smi"), \
             mock.patch("pathlib.Path.exists", return_value=True):
            self.assertEqual(metrics._gpu_kind(), "nvidia")

    def test_kind_amd_and_intel_from_drm_driver(self):
        with tempfile.TemporaryDirectory() as d:
            root = pathlib.Path(d)
            amd = _make_card(root, "card0", "amdgpu", "37")
            with mock.patch("shutil.which", return_value=None), \
                 mock.patch.object(metrics, "_drm_cards", return_value=[amd]):
                self.assertEqual(metrics._gpu_kind(), "amd")
        with tempfile.TemporaryDirectory() as d:
            root = pathlib.Path(d)
            intel = _make_card(root, "card0", "i915", None)
            with mock.patch("shutil.which", return_value=None), \
                 mock.patch.object(metrics, "_drm_cards", return_value=[intel]):
                self.assertEqual(metrics._gpu_kind(), "intel")

    def test_kind_none_when_no_known_gpu(self):
        with tempfile.TemporaryDirectory() as d:
            root = pathlib.Path(d)
            other = _make_card(root, "card0", "virtio_gpu", None)
            with mock.patch("shutil.which", return_value=None), \
                 mock.patch.object(metrics, "_drm_cards", return_value=[other]):
                self.assertIsNone(metrics._gpu_kind())


class GpuBusyTests(unittest.TestCase):
    def test_sysfs_busy_reads_amd_intel_percent(self):
        with tempfile.TemporaryDirectory() as d:
            root = pathlib.Path(d)
            card = _make_card(root, "card0", "amdgpu", "42")
            with mock.patch.object(metrics, "_drm_cards", return_value=[card]):
                self.assertEqual(metrics._sysfs_gpu_busy(), 42.0)

    def test_sysfs_busy_none_when_absent(self):
        with tempfile.TemporaryDirectory() as d:
            root = pathlib.Path(d)
            card = _make_card(root, "card0", "i915", None)   # i915: no busy file
            with mock.patch.object(metrics, "_drm_cards", return_value=[card]):
                self.assertIsNone(metrics._sysfs_gpu_busy())

    def test_gpu_pct_nvidia_uses_smi(self):
        completed = mock.Mock(stdout="27\n")
        with mock.patch("shutil.which", return_value="/usr/bin/nvidia-smi"), \
             mock.patch("subprocess.run", return_value=completed) as run:
            self.assertEqual(metrics._gpu_pct("nvidia"), 27.0)
            self.assertIn("nvidia-smi", run.call_args.args[0][0])

    def test_gpu_pct_amd_uses_sysfs_not_smi(self):
        with mock.patch.object(metrics, "_sysfs_gpu_busy", return_value=55.0) as busy, \
             mock.patch("subprocess.run", side_effect=AssertionError("no smi for amd")):
            self.assertEqual(metrics._gpu_pct("amd"), 55.0)
            busy.assert_called_once()


class RollingWindowTests(unittest.TestCase):
    def setUp(self):
        metrics._prev_cpu = None
        metrics._window.clear()

    def test_usage_averages_over_window_and_reports_kind(self):
        samples = iter([(10.0, 20.0), (30.0, 40.0)])   # (cpu, gpu) per call
        with mock.patch.object(metrics, "_gpu_kind", return_value="amd"), \
             mock.patch.object(metrics, "_cpu_pct", side_effect=lambda: next(_c)), \
             mock.patch.object(metrics, "_gpu_pct", side_effect=lambda k: next(_g)):
            _c = iter([10.0, 30.0])
            _g = iter([20.0, 40.0])
            metrics.action_sys_usage()
            out = metrics.action_sys_usage()
        self.assertEqual(out["cpu"], 20.0)             # (10+30)/2
        self.assertEqual(out["gpu"], 30.0)             # (20+40)/2
        self.assertEqual(out["gpu_kind"], "amd")
        self.assertEqual(out["window_secs"], 10)

    def test_usage_ignores_none_cpu_baseline(self):
        with mock.patch.object(metrics, "_gpu_kind", return_value=None), \
             mock.patch.object(metrics, "_cpu_pct", return_value=None), \
             mock.patch.object(metrics, "_gpu_pct", return_value=None):
            out = metrics.action_sys_usage()
        self.assertIsNone(out["cpu"])
        self.assertIsNone(out["gpu"])
        self.assertIsNone(out["gpu_kind"])

    def test_window_prunes_old_samples(self):
        # Two samples 20 s apart: the first must fall out of the 10 s window.
        clock = iter([100.0, 120.0])
        with mock.patch.object(metrics, "_gpu_kind", return_value="nvidia"), \
             mock.patch.object(metrics, "_cpu_pct", side_effect=[5.0, 90.0]), \
             mock.patch.object(metrics, "_gpu_pct", side_effect=[5.0, 90.0]), \
             mock.patch("time.monotonic", side_effect=lambda: next(clock)):
            metrics.action_sys_usage()
            out = metrics.action_sys_usage()
        self.assertEqual(out["cpu"], 90.0)             # only the recent sample
        self.assertEqual(out["gpu"], 90.0)


if __name__ == "__main__":
    unittest.main()
