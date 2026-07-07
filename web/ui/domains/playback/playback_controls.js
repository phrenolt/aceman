// Playback card controls: the in-tab stats line and the pre-roll buffer
// slider. Both are card UI backed by localStorage (+ the server config
// for the buffer, so the aceman CLI's external player matches the tab).
import { $ } from '../../shared/dom.js';
import { api } from '../../shared/api.js';
import { KEYS } from '../../lib/storage_keys.js';
import { bufferLabel, clampBuffer, BUFFER_DEFAULT } from './lib/playback_buffer.js';
import { notifyRestartNeeded } from './playback.js';

export function initPlaybackControls() {
  initStatsToggle();
  initBufferSlider();
}

// The buffer-persist steps, factored out so the slider handlers and
// setPlaybackBuffer share one implementation (the slider splits them: local
// on every drag tick, server only on release). clampBuffer (the canonical
// [0,60] clamp, also used by getPlaybackBuffer) keeps both paths consistent.
// Slider value + read-out label + localStorage.
function _persistBufferLocal(v) {
  const bufSlider = $('playback-buffer');
  const bufOut    = $('playback-buffer-out');
  if (bufSlider) bufSlider.value = String(v);
  if (bufOut) bufOut.textContent = bufferLabel(v, 60);
  localStorage.setItem(KEYS.PLAYBACK_BUFFER, String(v));
}
// Server config (config.json:buffer_secs) so the aceman CLI's external
// player uses the same seconds. Best-effort.
function _persistBufferServer(v) {
  api('/api/config', {
    method: 'POST', body: JSON.stringify({ buffer_secs: v }),
  }).catch(() => {});
}

// Set the pre-roll buffer programmatically (clamped 0–60), persisting both
// locally and to the server. Used by the buffer-overflow notice's "Reset to
// default" action; reusable anywhere a reset is needed. Defaults to
// BUFFER_DEFAULT when called with no value.
export function setPlaybackBuffer(n = BUFFER_DEFAULT) {
  const v = clampBuffer(n);
  _persistBufferLocal(v);
  _persistBufferServer(v);
  return v;
}

// Stats visibility is a preference (statsHidden) AND a precondition: the
// stats line / "Display Stats" button are meaningful only while the
// in-browser <video> is actually on screen. #now-playing is also shown
// for external playback (no in-browser window), so without the video
// check the button leaks in with no player behind it.
let statsHidden = localStorage.getItem(KEYS.STATS_HIDDEN) === '1';

export function refreshStatsVisibility() {
  const s = $('pb-video-status');
  const b = $('show-stats-btn');
  const v = $('pb-video');
  if (!s || !b) return;
  const videoShown = !!v && v.style.display !== 'none';
  if (!videoShown) { s.style.display = 'none'; b.style.display = 'none'; return; }
  s.style.display = statsHidden ? 'none' : '';
  b.style.display = statsHidden ? '' : 'none';
}

// Stats line toggle — click to hide, "Display Stats" button to restore.
function initStatsToggle() {
  const applyStatsVis = refreshStatsVisibility;
  applyStatsVis();
  const pbStatus = $('pb-video-status');
  if (pbStatus) {
    pbStatus.onclick = () => {
      statsHidden = true;
      localStorage.setItem(KEYS.STATS_HIDDEN, '1');
      applyStatsVis();
    };
    pbStatus.oncontextmenu = e => {
      e.preventDefault();
      const text = pbStatus.textContent;
      if (!text) return;
      navigator.clipboard.writeText(text).then(() => {
        const prev = pbStatus.style.opacity;
        pbStatus.style.opacity = '1';
        pbStatus.style.color = 'var(--acc)';
        setTimeout(() => {
          pbStatus.style.opacity = prev;
          pbStatus.style.color = '';
        }, 600);
      }).catch(() => {});
    };
  }
  const showStatsBtn = $('show-stats-btn');
  if (showStatsBtn) showStatsBtn.onclick = () => {
    statsHidden = false;
    localStorage.setItem(KEYS.STATS_HIDDEN, '0');
    applyStatsVis();
  };
}

// In-tab pre-roll buffer slider. 0 = Off (live edge). Read at play time.
function initBufferSlider() {
  const bufSlider = $('playback-buffer');
  if (!bufSlider) return;
  bufSlider.max = '60';
  const v = clampBuffer(localStorage.getItem(KEYS.PLAYBACK_BUFFER) || '10');
  _persistBufferLocal(v);
  // Seed the server from localStorage on load so the aceman CLI's
  // buffer_secs isn't stale when the slider goes untouched.
  _persistBufferServer(v);
  // Drag: local only (cheap, every tick — no server spam).
  bufSlider.oninput  = () => _persistBufferLocal(clampBuffer(bufSlider.value));
  // Release: persist server-side so the aceman CLI applies the same seconds
  // to the external player cache, and remind that it takes effect next start.
  bufSlider.onchange = () => {
    _persistBufferServer(clampBuffer(bufSlider.value));
    notifyRestartNeeded();
  };
}
