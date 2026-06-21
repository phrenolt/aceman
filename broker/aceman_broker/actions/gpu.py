"""GPU capability detection.

Probes the host for NVIDIA (nvidia-smi) and VA-API (/dev/dri/renderD128
+ vainfo). Returns a capability map the web uses to build the ffmpeg
command. Refuses nvidia capabilities if nvidia-smi is absent.
"""

from __future__ import annotations

import pathlib
import re
import shutil
import subprocess

from ..logging_util import _log
from . import register as _register


def _probe_nvidia() -> "dict | None":
    if not shutil.which("nvidia-smi"):
        return None
    try:
        r = subprocess.run(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
            capture_output=True, text=True, timeout=5,
        )
        name = (r.stdout.strip().splitlines() or ["unknown"])[0]
    except (subprocess.TimeoutExpired, OSError):
        name = "unknown"
    return {"name": name}


def _probe_vaapi() -> "dict | None":
    device = pathlib.Path("/dev/dri/renderD128")
    if not device.exists():
        return None
    h264_enc = False
    va_driver = None
    if shutil.which("vainfo"):
        try:
            r = subprocess.run(
                ["vainfo", "--display", "drm", "--device", str(device)],
                capture_output=True, text=True, timeout=5,
            )
            combined = r.stdout + r.stderr
            h264_enc = (
                "VAProfileH264" in combined
                and "VAEntrypointEncSlice" in combined
            )
            # e.g. "libva info: Trying to open .../radeonsi_drv_video.so"
            m = re.search(r"/(\w+)_drv_video\.so", combined)
            if m:
                va_driver = m.group(1)
        except (subprocess.TimeoutExpired, OSError):
            pass
    # Fallback: infer driver from kernel DRM driver name (no vainfo needed).
    if va_driver is None:
        drm_link = pathlib.Path("/sys/class/drm/renderD128/device/driver")
        if drm_link.exists():
            drm = drm_link.resolve().name
            if drm == "amdgpu":
                va_driver = "radeonsi"
            elif drm in ("i915", "xe"):
                va_driver = "iHD"
    return {"device": str(device), "h264_enc": h264_enc, "driver": va_driver}


def _probe_qsv(vaapi: "dict | None") -> bool:
    if vaapi is None or not shutil.which("vainfo"):
        return False
    try:
        r = subprocess.run(
            ["vainfo"],
            capture_output=True, text=True, timeout=5,
        )
        return "iHD" in r.stdout or "i965" in r.stdout
    except (subprocess.TimeoutExpired, OSError):
        return False


def action_gpu_status(params: "dict | None" = None) -> dict:
    nvidia = _probe_nvidia()
    vaapi = _probe_vaapi()
    qsv = _probe_qsv(vaapi)
    _log("gpu", "status: nvidia=%s vaapi=%s qsv=%s",
         bool(nvidia), bool(vaapi), qsv)
    return {
        "available": nvidia is not None or vaapi is not None,
        "nvidia": nvidia,
        "vaapi": vaapi,
        "qsv": qsv,
    }


def register(actions: dict) -> None:
    _register(actions, "gpu.status", action_gpu_status)
