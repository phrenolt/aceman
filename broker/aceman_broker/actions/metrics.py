"""Host CPU / GPU utilisation for the lifecycle read-out.

Runs on the host (the web container can't see host CPU or the GPU driver),
same rationale as the gpu.status probe. Sampling is LAZY: each `sys.usage`
call takes one sample and appends it to a rolling 20-second window, then
returns the window average. The frontend polls every few seconds, so ~6-7
samples make up the average — no always-on background thread spawning
nvidia-smi when nobody's looking.

CPU is a /proc/stat busy-delta between calls. GPU is read per vendor:
  * NVIDIA — nvidia-smi utilization.gpu
  * AMD    — /sys/class/drm/card*/device/gpu_busy_percent (amdgpu)
  * Intel  — same gpu_busy_percent when the driver exposes it (newer Xe);
             i915 generally doesn't without intel_gpu_top + CAP_PERFMON, so
             Intel is best-effort and reports null when unavailable.
"""

from __future__ import annotations

import pathlib
import shutil
import subprocess
import threading
import time
from collections import deque

from .gpu import _NVIDIA_CTL
from . import register as _register

_WINDOW_SECS = 20.0
_lock = threading.Lock()
_prev_cpu: "tuple[int, int] | None" = None       # (total, idle) from last call
_window: "deque[tuple[float, float | None, float | None]]" = deque()  # (ts, cpu%, gpu%)


def _read_cpu_times() -> "tuple[int, int] | None":
    """(total, idle) jiffies from the aggregate `cpu` line of /proc/stat."""
    try:
        with open("/proc/stat") as f:
            fields = f.readline().split()
    except OSError:
        return None
    if not fields or fields[0] != "cpu" or len(fields) < 5:
        return None
    try:
        vals = [int(x) for x in fields[1:]]
    except ValueError:
        return None
    idle = vals[3] + (vals[4] if len(vals) > 4 else 0)   # idle + iowait
    return sum(vals), idle


def _cpu_pct() -> "float | None":
    """Busy % since the previous call. None on the first call (no baseline)."""
    global _prev_cpu
    now = _read_cpu_times()
    if now is None:
        return None
    prev, _prev_cpu = _prev_cpu, now
    if prev is None:
        return None
    d_total = now[0] - prev[0]
    d_idle = now[1] - prev[1]
    if d_total <= 0:
        return None
    return round(100.0 * (d_total - d_idle) / d_total, 1)


def _drm_cards() -> "list[pathlib.Path]":
    return sorted(pathlib.Path("/sys/class/drm").glob("card[0-9]*"))


def _gpu_kind() -> "str | None":
    """Which GPU vendor drives this box, checked across ALL DRM cards (not
    just renderD128) so a second/primary card is still recognised."""
    if shutil.which("nvidia-smi") and pathlib.Path(_NVIDIA_CTL).exists():
        return "nvidia"
    for card in _drm_cards():
        drv = card / "device" / "driver"
        if not drv.exists():
            continue
        name = drv.resolve().name
        if name == "amdgpu":
            return "amd"
        if name in ("i915", "xe"):
            return "intel"
        if name == "nvidia":            # nvidia-smi absent but nvidia-drm bound
            return "nvidia"
    return None


def _sysfs_gpu_busy() -> "float | None":
    """0-100 busy % from amdgpu / Xe sysfs. amdgpu always exposes
    gpu_busy_percent; the newer Intel Xe driver does too. Older Intel i915
    does NOT (needs intel_gpu_top + CAP_PERFMON), so this returns None there
    and the GPU load reads as unavailable rather than wrong."""
    for card in _drm_cards():
        p = card / "device" / "gpu_busy_percent"
        if not p.exists():
            continue
        try:
            return float(p.read_text().strip())
        except (OSError, ValueError):
            continue
    return None


def _gpu_pct(kind: "str | None") -> "float | None":
    if kind == "nvidia" and shutil.which("nvidia-smi"):
        # utilization.gpu is ONLY the SM (graphics/compute) engine — it does
        # NOT include NVENC or NVDEC, which are separate fixed-function blocks
        # with their own counters. A pure NVENC transcode can pin the encoder
        # while utilization.gpu reads near zero, so we query all three engines
        # and report the busiest. Without this, "GPU encode" looks idle.
        try:
            r = subprocess.run(
                ["nvidia-smi",
                 "--query-gpu=utilization.gpu,utilization.encoder,"
                 "utilization.decoder",
                 "--format=csv,noheader,nounits"],
                capture_output=True, text=True, timeout=3,
            )
            line = r.stdout.strip().splitlines()
            if not line:
                return None
            vals = [float(x) for x in line[0].split(",")]
            return max(vals) if vals else None
        except (subprocess.TimeoutExpired, OSError, ValueError):
            return None
    # AMD + Intel (and nvidia-drm without nvidia-smi) all read the same sysfs.
    # gpu_busy_percent is a whole-GPU figure that already reflects the VCN
    # video engines, so no separate encode/decode query is needed there.
    return _sysfs_gpu_busy()


def action_sys_usage(params: "dict | None" = None) -> dict:
    with _lock:
        kind = _gpu_kind()
        cpu = _cpu_pct()
        gpu = _gpu_pct(kind)
        now = time.monotonic()
        _window.append((now, cpu, gpu))
        while _window and now - _window[0][0] > _WINDOW_SECS:
            _window.popleft()
        cpus = [c for _, c, _ in _window if c is not None]
        gpus = [g for _, _, g in _window if g is not None]
        avg_cpu = round(sum(cpus) / len(cpus), 1) if cpus else None
        avg_gpu = round(sum(gpus) / len(gpus), 1) if gpus else None
    return {"cpu": avg_cpu, "gpu": avg_gpu, "gpu_kind": kind,
            "window_secs": int(_WINDOW_SECS)}


def register(actions: dict) -> None:
    _register(actions, "sys.usage", action_sys_usage)
