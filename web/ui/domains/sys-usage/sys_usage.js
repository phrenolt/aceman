// System-usage domain. When enabled via the Lifecycle toggle, polls host
// CPU + GPU utilisation (10 s rolling average, computed broker-side) every
// 3 s and paints the row below the memory cells. Each cell hides itself
// when its figure is unavailable (no CPU baseline yet, or the GPU vendor
// doesn't expose a busy metric — e.g. Intel i915 without intel_gpu_top).
//
// OFF by default and fully inert when off: no interval, no fetch, so the
// broker is never called and nvidia-smi is never spawned. The choice
// persists in localStorage so it survives reloads.
import { $ } from '../../shared/dom.js';

const POLL_MS = 3000;
// Colour the figure as load climbs, so a glance tells you if you're pinned.
const WARN_PCT = 85;
const SYS_USAGE_KEY = 'aceman:sysUsageEnabled';

const GPU_NAME = { nvidia: 'NVIDIA', amd: 'AMD', intel: 'Intel' };

let _sysTimer = null;

function _sysEnabled() {
  return localStorage.getItem(SYS_USAGE_KEY) === '1';
}

function applyCell(cellId, displayId, pct) {
  const cell = $(cellId);
  if (!cell) return false;
  if (pct == null || Number.isNaN(pct)) { cell.style.display = 'none'; return false; }
  const display = $(displayId);
  if (display) display.textContent = Math.round(pct) + '%';
  cell.classList.toggle('mem-cell-warn', pct >= WARN_PCT);
  cell.style.display = '';
  return true;
}

// The GPU cell also carries the vendor label (NVIDIA / AMD / Intel). When a
// GPU is detected but its driver exposes no load metric — Intel i915 without
// intel_gpu_top being the common case — show "n/a" rather than hiding it, so
// the user can see the GPU was recognised.
function applyGpuCell(u) {
  const cell = $('sys-gpu-cell');
  if (!cell) return false;
  const label = $('sys-gpu-label');
  if (label) label.textContent = u.gpu_kind ? 'GPU (' + (GPU_NAME[u.gpu_kind] || u.gpu_kind) + ')' : 'GPU';
  const display = $('sys-gpu-display');
  const known = u.gpu != null && !Number.isNaN(u.gpu);
  if (known) {
    if (display) display.textContent = Math.round(u.gpu) + '%';
    cell.classList.toggle('mem-cell-warn', u.gpu >= WARN_PCT);
    cell.style.display = '';
    return true;
  }
  if (u.gpu_kind) {
    if (display) display.textContent = 'n/a';
    cell.classList.remove('mem-cell-warn');
    cell.style.display = '';
    return true;
  }
  cell.style.display = 'none';
  return false;
}

async function refreshSysUsage() {
  const row = $('sys-usage-row');
  if (!row) return;
  try {
    const u = await fetch('/api/sys/usage', { cache: 'no-store' }).then(r => r.json());
    const cpuOn = applyCell('sys-cpu-cell', 'sys-cpu-display', u.cpu);
    const gpuOn = applyGpuCell(u);
    row.style.display = (cpuOn || gpuOn) ? 'flex' : 'none';
  } catch (_) {
    row.style.display = 'none';
  }
}

function _startSysUsage() {
  if (_sysTimer) return;
  refreshSysUsage();
  _sysTimer = setInterval(refreshSysUsage, POLL_MS);
}

function _stopSysUsage() {
  if (_sysTimer) { clearInterval(_sysTimer); _sysTimer = null; }
  const row = $('sys-usage-row');
  if (row) row.style.display = 'none';
}

export function initSysUsage() {
  const toggle = $('sys-usage-toggle');
  if (toggle) {
    toggle.checked = _sysEnabled();
    toggle.onchange = () => {
      localStorage.setItem(SYS_USAGE_KEY, toggle.checked ? '1' : '0');
      if (toggle.checked) _startSysUsage();
      else _stopSysUsage();
    };
  }
  if (_sysEnabled()) _startSysUsage();
}
