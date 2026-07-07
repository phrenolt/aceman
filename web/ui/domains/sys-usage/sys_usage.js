// System-usage domain. When enabled via the Lifecycle toggle, polls host
// CPU + GPU utilisation (20 s rolling average, computed broker-side) every
// 3 s and folds the live figures into the toggle's own label — e.g.
// "CPU / GPU usage — 42% / 30%" — rather than repeating "CPU"/"GPU" in a
// separate row. The GPU figure is omitted when no GPU exists, and shown as
// "n/a" when a GPU is detected but its driver exposes no busy metric (Intel
// i915 without intel_gpu_top being the common case).
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

// Escape text going into the innerHTML string. text is normally numeric and
// title a known vendor label, but gpu_kind is broker-sourced and could carry a
// stray quote/angle-bracket for an unknown driver — escape so it can't break
// out of the attribute or inject markup.
function _esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// A single "42%" figure, reddened via .mem-cell-warn once it crosses WARN_PCT.
// `title` carries context that no longer has room in the compact label.
function _figure(text, warn, title) {
  const cls = warn ? ' class="mem-cell-warn"' : '';
  const t = title ? ` title="${_esc(title)}"` : '';
  return `<span${cls}${t}>${_esc(text)}</span>`;
}

function _clearFigures() {
  const fig = $('sys-usage-figures');
  if (fig) { fig.textContent = ''; fig.style.display = 'none'; }
}

// Paint the live figures into the label. CPU always leads (matching the
// "CPU / GPU" wording); the GPU slot follows only when a GPU is present, so
// the "/" ordering stays unambiguous. A pending CPU baseline shows "…".
function _paintFigures(u) {
  const fig = $('sys-usage-figures');
  if (!fig) return;
  const cpuKnown = u.cpu != null && !Number.isNaN(u.cpu);
  const gpuKnown = u.gpu != null && !Number.isNaN(u.gpu);
  const slots = [
    cpuKnown ? _figure(Math.round(u.cpu) + '%', u.cpu >= WARN_PCT, 'Host CPU, 20-second average')
             : _figure('…', false, 'Waiting for CPU baseline'),
  ];
  if (gpuKnown || u.gpu_kind) {
    const vendor = (GPU_NAME[u.gpu_kind] || u.gpu_kind || '') + ' GPU, 20-second average';
    slots.push(gpuKnown ? _figure(Math.round(u.gpu) + '%', u.gpu >= WARN_PCT, vendor.trim())
                        : _figure('n/a', false, vendor.trim()));
  }
  fig.innerHTML = ' — ' + slots.join(' / ');
  fig.style.display = '';
}

async function refreshSysUsage() {
  if (!$('sys-usage-figures')) return;
  try {
    const u = await fetch('/api/sys/usage', { cache: 'no-store' }).then(r => r.json());
    _paintFigures(u);
  } catch (_) {
    _clearFigures();
  }
}

function _startSysUsage() {
  if (_sysTimer) return;
  refreshSysUsage();
  _sysTimer = setInterval(refreshSysUsage, POLL_MS);
}

function _stopSysUsage() {
  if (_sysTimer) { clearInterval(_sysTimer); _sysTimer = null; }
  _clearFigures();
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
