// Playback domain — the "watch" core. Three intertwined surfaces that
// share the same live-stream state (`current`, `livePlaybackTarget`,
// `cfg`) and so live together:
//   * playback orchestration — play(), the Play-in target dropdown,
//     move-to-target, restart, the now-playing line, save-button sync;
//   * in-browser playback — the mpegts.js player over /api/stream/proxy,
//     plus buffer-health / stall / pre-roll timers;
//   * engine status + controls — the poll/settle state machine, the
//     start/stop toggle, the play-gate, the acestream:// hand-off.
//
// The pure logic (target encoding, buffer maths, button views, the
// engine settling state machine) lives in lib/playback/ + lib/engine/
// and is unit-tested; this module is the DOM + broker wiring.
//
// Forward imports from sibling domains: favourites (allFavs, loadFavs,
// updateSaveButton), detection (player/browser lists), gpu (param
// builder + encode label). Plus the generic shared/notice component and
// the shared/runtime flag (noLocalDesktop). This domain owns the live
// stream state (current, livePlaybackTarget, cfg) AND the Watch input
// (#cid-input) — a read-only display of the playing Ace ID that the user
// double-clicks to edit / pastes into to play (clearCidInput /
// refreshClearButton live here).

import { $, showError, showConfirm, showBusy, hideBusy } from '../../shared/dom.js';
import { api } from '../../shared/api.js';
import { showNotice, dismissNotice } from '../../shared/notice.js';
import { parseId } from './lib/content_id_parser.js';
import { EngineStatusState } from './lib/engine/engine_state.js';
import { encodeTarget, isExternal } from './lib/playback_target.js';
import { KEYS } from '../../lib/storage_keys.js';
import { saveLastPlay, loadLastPlay, clearLastPlay } from './lib/last_played_stream.js';
import { inBrowserPlaybackSupported } from './lib/playback_feature_detect.js';
import { isFatalMpegtsError, isFatalVideoError } from './lib/playback_error.js';
import { buildPlaybackOptions } from './lib/playback_options.js';
import { buildLanStreamUrl } from './lib/lan_url.js';
import { filterIps, removeIp } from './lib/tv_ip_history.js';
import { decidePlaybackPath } from './lib/playback_decision.js';
import { targetValueToConfig } from './lib/playback_config.js';
import { clampBuffer, bufferedAhead, bufferReady, BUFFER_DEFAULT } from './lib/playback_buffer.js';
import { feedIsDead, STALL_FEED_SILENT_MS } from './lib/playback_stall.js';
import { effectiveSafeBytes, foldObservedCap, maxBufferSecs } from './lib/mse_budget.js';
import { describePlayButton } from './lib/play_stop_button.js';
import { describeMoveButton } from './lib/move_stream_button.js';
import { describeEngineToggle } from './lib/engine/engine_start_stop_toggle.js';
import { resolveDisplayName } from './lib/playback_display_name.js';
import { describePlayButtonGate } from './lib/engine/play_button_gate.js';
import { allFavs, loadFavs, updateSaveButton } from '../favourites/index.js';
import { findFavouriteByCid } from '../favourites/lib/favourite_lookup.js';
import { openFavourite } from '../library/index.js';
import { detectedPlayers, detectedBrowsers, _currentBrowserName } from './detection.js';
import { buildGpuParams, gpuPipelineLabel } from '../gpu/index.js';
import { noLocalDesktop } from '../../shared/runtime.js';
import { refreshStatsVisibility, setPlaybackBuffer } from './playback_controls.js';

// The active stream, just enough to drive the Save button: we no longer
// own the session (the host shell does via acestream:// dispatch), so
// there's no playback_url / command_url to remember.
export let current = null;     // { cid, name }
// setCurrent lets the bootstrap rehydrate `current` after a reload
// without violating the single-writer rule (imported bindings are
// read-only; only this module reassigns).
export function setCurrent(value) { current = value; }
// Where the active stream is actually playing, as a dropdown-value string
// ('browser' | 'external|name|source' | ''). Set when play() fires, NOT
// when the dropdown changes — the dropdown is the user's pending intent,
// this is reality. The "Move current stream here" button compares the two.
export let livePlaybackTarget = '';

// Server config blob (/api/config). The bootstrap loads it via setCfg.
export let cfg = {};
export function setCfg(value) { cfg = value; }

// The Watch input (#cid-input) belongs to this domain now: a read-only
// display of the playing Ace ID, editable only on double-click and a
// paste-to-play target. These helpers own its ✕ clear button and the
// programmatic clear used by Stop.
export function refreshClearButton() {
  const btn = $('cid-clear');
  if (!btn) return;
  // Visibility (not display) so the reserved slot never reflows the row.
  btn.style.visibility = $('cid-input').value ? 'visible' : 'hidden';
}

export function clearCidInput() {
  const input = $('cid-input');
  if (!input) return;
  input.value = '';
  updateSaveButton();
  refreshClearButton();
  refreshDeviceStream();   // a cleared field hides the device QR
}

// Reminder that a setting change (buffer / GPU) only applies on the next
// stream start. Shown only while something is live — nothing to restart
// otherwise. Domain-specific notice built on the generic shared component.
export function notifyRestartNeeded() {
  if (!livePlaybackTarget) return;
  showNotice({
    id: 'restart-needed',
    message: 'Setting changed — restart the stream for it to take effect.',
    actionLabel: '↺ Restart stream',
    onAction: () => { dismissNotice('restart-needed'); restartStream(); },
  });
}

export function clearNowPlaying() {
  stopInBrowserPlayback();
  current = null;
  livePlaybackTarget = '';
  $('now-playing').style.display = 'none';
  setNowPlayingName('', '');
  setTabTitle('');
  refreshPlaybackMoveButton();
}

// ---- in-browser playback (mpegts.js + /api/stream/proxy) ---------------
//
// The library transmuxes MPEG-TS chunks into fMP4 and feeds them into a
// MediaSource. The actual upstream-engine reader lives on the server: a
// single same-origin /api/stream/proxy/<cid> connection that the server
// pipes from the engine's playback URL. This sidesteps both the engine's
// "one global active session" rule (the server holds it) and the
// browser's CORS rules (it's same-origin).

let mpegtsPlayer = null;   // the live mpegts.createPlayer instance, or null

// MediaSource + mpegts.js detection lives in ./lib/feature_detect.js
// and is exercised against stub globals in the test suite.
function inBrowserSupported() {
  return inBrowserPlaybackSupported(window);
}

// Post-handoff "you can close this tab" screen.
//
// Originally this tried window.close() too, but the result was
// inconsistent across browsers: Firefox sometimes obeys, Brave /
// Chrome refuse (the spec lets browsers ignore close() on tabs the
// script didn't open). Asking-then-failing felt buggy. We just
// replace the page with a clear "you may close this tab" notice
// instead so the behavior is identical everywhere.
function _closeThisTab(targetLabel) {
  document.body.innerHTML =
    '<div style="text-align:center;padding:3rem;color:#aaa;' +
    'font:14px/1.5 system-ui,sans-serif">' +
    '<h2 style="color:#eee">Sent to ' + targetLabel + '</h2>' +
    '<p>The stream is now playing in ' + targetLabel + '. ' +
    'You may close this tab.</p></div>';
}

function startInBrowserPlayback(cid) {
  // Tear down any prior player. The library doesn't no-op a destroy on a
  // dead instance and a leaked MediaSource will leak the upstream socket.
  stopInBrowserPlayback();

  // Remember what we're playing so the stall watchdog can match the
  // server's proxy post-mortem (/api/stream/last-error) to this stream —
  // both the id AND a server-clock baseline, so a prior play of the same
  // channel can't lend its stale reason to this one.
  _activeStreamCid = cid;
  _playStartErrorAt = 0;    // until the baseline snapshot below resolves
  _snapshotLastErrorBaseline();
  _streamByteRate = null;   // fresh bitrate estimate for this stream
  _lastByteFlowAt = 0;      // fresh feed-flow tracking for this stream
  _fatalPlaybackHandled = false;   // fresh play — re-arm the fatal-error guard
  const v = $('pb-video');
  const status = $('pb-video-status');
  v.style.display = '';
  refreshStatsVisibility();
  status.textContent = 'Connecting to engine…';
  status.className = 'gate-hint';

  // Cache-buster query so the browser never serves a stale-cached body
  // for the proxy URL (we send no-store but belt + braces).
  const url = '/api/stream/proxy/' + cid + '?t=' + Date.now() + buildGpuParams();
  // Pre-roll buffer (Player card slider): 0 = off / play at the live
  // edge as before; >0 = hold playback back by that many seconds for a
  // hiccup cushion. Read once, at play time.
  const bufferSecs = getPlaybackBuffer();
  // Tracks whether we're still filling the pre-roll buffer, so the
  // MEDIA_INFO handler doesn't stomp the "Buffering N/M s…" read-out
  // with "Playing — …" before the cushion is built.
  let buffering = bufferSecs > 0;
  let mediaInfoText = '';
  let speedMbps = null;
  // Full pipeline label shown in the status line (encoder · deinterlace ·
  // upscaler) — computed once at play time from the GPU settings so it
  // reflects what was actually sent to the proxy.
  const encodeLabel = gpuPipelineLabel();
  let currentFps = null;
  let _lastFrames = null;
  let _lastFrameTime = null;
  const playerCfg = {
    type: 'mpegts', isLive: true, url,
    // When the MSE SourceBuffer fills up (browser memory ceiling),
    // automatically evict the oldest buffered data instead of stalling.
    // Without this, large buffer values (e.g. 300 s) hit the limit and
    // suspend the transmuxing task — "SourceBuffer is full".
    autoCleanupSourceBuffer: true,
    // Keep at most bufferSecs of backward history; evict anything older.
    // This lets mpegts.js reclaim space before the browser hard-caps it.
    autoCleanupMaxBackwardDuration: Math.max(bufferSecs, 60),
    autoCleanupMinBackwardDuration: Math.max(bufferSecs - 10, 30),
  };
  if (bufferSecs > 0) {
    // Stop mpegts.js seeking to the live edge — that chasing would
    // erase the very cushion the slider asks us to hold.
    playerCfg.liveBufferLatencyChasing = false;
  }
  // Quiet mpegts.js's info/debug chatter (the "[MSEController] Received
  // Initialization Segment …" lines etc). We keep our own errors/warnings.
  if (window.mpegts.LoggingControl) {
    window.mpegts.LoggingControl.enableInfo = false;
    window.mpegts.LoggingControl.enableDebug = false;
    window.mpegts.LoggingControl.enableVerbose = false;
    _installMpegtsBufferLog(window.mpegts);
  }
  try {
    mpegtsPlayer = window.mpegts.createPlayer(playerCfg);
  } catch (e) {
    status.textContent = 'mpegts.js init failed: ' + e.message;
    status.className = 'gate-hint warn';
    return;
  }

  // Native HTMLMediaElement error — fires BEFORE the mpegts.js ERROR
  // event when MSE rejects something. Tells us exactly why MSE bailed:
  //   code 1 ABORTED, 2 NETWORK, 3 DECODE (most likely for codec issues),
  //   4 SRC_NOT_SUPPORTED (format outright unsupported).
  v.onerror = () => {
    const e = v.error;
    if (e) console.warn('[video] error code=' + e.code + ' message="' + e.message + '"');
    // A DECODE (3) / SRC_NOT_SUPPORTED (4) error means these bytes can't be
    // played — retrying re-appends the same undecodable data and mpegts.js
    // loops forever. Give up cleanly and steer the user to the external player.
    if (e && isFatalVideoError(e.code)) {
      _failPlaybackFatal('Playback error (code ' + e.code + ')');
    }
  };

  if (window.mpegts.Events) {
    const E = window.mpegts.Events;
    mpegtsPlayer.on(E.MEDIA_INFO, (info) => {
      const codec = (info && (info.videoCodec || info.mimeType)) || 'video';
      const audio = (info && info.audioCodec) ? ' / ' + info.audioCodec : '';
      mediaInfoText = 'Playing — ' + codec + audio;
      // renderStatus keeps the codec/format text and appends the live
      // buffer figure; it no-ops while the pre-roll counter is up.
      renderStatus();
    });
    mpegtsPlayer.on(E.STATISTICS_INFO, (stats) => {
      if (!stats) return;
      if (stats.speed != null) {
        speedMbps = stats.speed * 8 / 1024;  // KB/s → Mbps
        // Smoothed byte throughput (EMA) for the "max buffer" estimate. The
        // instantaneous download rate is bursty on a live stream; the EMA
        // converges to the encode bitrate that actually fills the buffer.
        const r = stats.speed * 1024;        // KB/s → bytes/s
        _streamByteRate = _streamByteRate == null ? r : _streamByteRate * 0.9 + r * 0.1;
        // Mark real feed activity so the pre-roll freeze detector can tell an
        // overflow from a stall (see _preRollBuffer).
        if (stats.speed >= _MIN_FLOW_KBPS) _lastByteFlowAt = performance.now();
      }
      if (stats.decodedFrames != null) {
        const now = performance.now();
        if (_lastFrames !== null && _lastFrameTime !== null) {
          const dt = (now - _lastFrameTime) / 1000;
          if (dt > 0) currentFps = (stats.decodedFrames - _lastFrames) / dt;
        }
        _lastFrames = stats.decodedFrames;
        _lastFrameTime = now;
      }
    });
    mpegtsPlayer.on(E.ERROR, (type, detail) => {
      // Freeze the line on the error — stop the health ticker from
      // overwriting it with the next "· buffer" refresh.
      _stopBufferHealth();
      _clearStall();   // an mpegts error supersedes any pending stall note
      console.warn('[mpegts]', type, detail);
      const label = 'Stream error: ' + type
          + (detail && detail.code ? ' (code ' + detail.code + ')' : '');
      // A MediaError is an undecodable format/codec: mpegts.js would keep
      // re-appending into a dead SourceBuffer ("… no longer usable" loop). Tear
      // the player down instead and point at the external player.
      if (isFatalMpegtsError(type)) {
        _failPlaybackFatal(label);
        return;
      }
      // Recoverable (NetworkError / OtherError): route through the post-mortem
      // so a proxy death that surfaces here still gets the server's WHY and the
      // one-click buffer-reset recovery — same as the hard-stall path.
      _reportStreamDeath(label);
    });
  }

  v.addEventListener('waiting',  _armStall);
  v.addEventListener('stalled',  _armStall);
  v.addEventListener('playing',  _clearStall);
  v.addEventListener('canplay',  _clearStall);

  mpegtsPlayer.attachMediaElement(v);
  mpegtsPlayer.load();
  // play() returns a promise; if the user hasn't interacted with the
  // page yet, autoplay-without-mute will reject — surface that to them.
  const startPlay = () => {
    if (!mpegtsPlayer) return;
    mpegtsPlayer.play().catch(e => {
      status.textContent =
        'Click the video to start (browser blocked autoplay): ' + e.message;
      status.className = 'gate-hint warn';
    });
  };
  // Live status line during playback: the codec/format from MEDIA_INFO
  // PLUS how many seconds are buffered ahead of the playhead, side by
  // side. The buffer figure is the runway — watch it drain toward 0 if
  // the engine stalls or slows before the video actually stutters.
  const renderStatus = () => {
    if (buffering) return;            // pre-roll counter owns the line until release
    if (_stalled) return;             // stall note owns the line until playback resumes
    const base = mediaInfoText || 'Playing';
    const ahead = bufferedAhead(v.buffered, v.currentTime);
    // Honest ceiling for the pre-roll buffer at the current bitrate — the
    // slider can't actually hold more than the browser's byte budget allows.
    const maxSecs = _maxBufferSecs();
    const maxs = maxSecs != null ? ' · max ~' + maxSecs + ' s' : '';
    const mbps = speedMbps != null ? ' · ' + speedMbps.toFixed(1) + ' Mbps' : '';
    const fps  = currentFps != null ? ' · ' + Math.round(currentFps) + ' fps' : '';
    const res  = v.videoWidth  ? ' · ' + v.videoWidth + '×' + v.videoHeight : '';
    status.textContent = base + ' · buffer ' + ahead.toFixed(1) + ' s' + maxs + mbps + fps + res + ' · ' + encodeLabel;
    status.className = 'gate-hint';
  };
  const beginPlayback = () => {
    startPlay();
    _startBufferHealth(renderStatus);
  };
  if (!buffering) {
    beginPlayback();
    return;
  }
  // Strip the native controls while the cushion fills — otherwise the
  // user can hit the controls' Play and start at the live edge with an
  // empty buffer, defeating the pre-roll. Restored on release.
  v.controls = false;
  // Hold playback until the pre-roll cushion is full, then release.
  _preRollBuffer(v, status, bufferSecs, () => {
    buffering = false;
    v.controls = true;
    beginPlayback();
  });
}

// Once-a-second ticker that refreshes the buffered-ahead figure in the
// status line during playback. Module-level so Stop / a fresh Play /
// a stream error can clear it (otherwise it'd keep painting over them).
let _bufferHealthTimer = null;

// The stream we're currently playing in-tab, so the stall watchdog can
// match the server's proxy post-mortem to it (see _reportStreamDeath).
let _activeStreamCid = null;
// The server's last-error `at` timestamp as it stood when this play STARTED
// (server clock, snapshotted via the same endpoint). A record newer than this
// belongs to the current play; one equal to it is a PRIOR play's death. We
// compare server-clock-to-server-clock — never the browser's Date.now(), which
// can be skewed on a LAN client and would mis-match a stale reason to this play.
let _playStartErrorAt = 0;

// How long the pre-roll fill may sit frozen before we treat it as a
// browser-buffer overflow rather than a slow stream (see _preRollBuffer).
const PREROLL_STALL_MS = 12000;

// --- "max buffer" estimate (arithmetic in ./lib/mse_budget.js) ------------
// Smoothed byte throughput of the current stream (bytes/s), fed from mpegts
// STATISTICS_INFO. Module-scoped so the overflow recorder can read it; reset
// per play in startInBrowserPlayback.
let _streamByteRate = null;
// performance.now() of the last time real bytes were arriving from the proxy
// (download speed above _MIN_FLOW_KBPS). Lets the pre-roll freeze detector tell
// a genuine SourceBuffer overflow (bytes still arriving, fill not growing) from
// an engine feed stall (no bytes arriving) — see _preRollBuffer. 0 = never yet.
let _lastByteFlowAt = 0;
// Below this download rate we treat the feed as "not flowing" (a stalled engine
// trickles ~0; a live stream flows at hundreds of KB/s), so the threshold has
// wide daylight and needn't be precise.
const _MIN_FLOW_KBPS = 8;

// Learned SourceBuffer byte ceiling, cached so the 1 s render ticker isn't
// re-reading localStorage every tick for a value that only changes on an
// overflow write. `undefined` = not loaded yet; NaN = nothing stored.
let _learnedMseCapBytes;
function _learnedMseCap() {
  if (_learnedMseCapBytes === undefined)
    _learnedMseCapBytes = parseInt(localStorage.getItem(KEYS.MSE_CAP_BYTES) || '', 10);
  return _learnedMseCapBytes;
}
function _safeMseBytes() {
  return effectiveSafeBytes(_learnedMseCap());
}

// An overflow at `seconds` buffered, at the current byte rate, is a real
// device-specific ceiling (bytes ≈ seconds × rate). Fold it into the stored
// running minimum so the "max ~N s" readout self-calibrates over time.
function _recordObservedMseCap(seconds) {
  if (!(seconds > 0) || !(_streamByteRate > 0)) return;
  const next = foldObservedCap(_learnedMseCap(), seconds * _streamByteRate);
  if (next != null) {
    _learnedMseCapBytes = Math.round(next);
    localStorage.setItem(KEYS.MSE_CAP_BYTES, String(_learnedMseCapBytes));
  }
}

// Seconds of buffer the browser can hold at the current bitrate, or null
// until we have a rate — the honest ceiling the pre-roll slider is bounded by.
function _maxBufferSecs() {
  return maxBufferSecs(_safeMseBytes(), _streamByteRate);
}

// Stall watchdog, two-stage. Short buffering hiccups are normal on live
// streams and usually self-recover, so stage 1 (5 s) shows only a gentle,
// non-alarming note and keeps the health ticker running. Stage 2 (20 s) only
// declares death if the proxy feed has also gone SILENT — a stall while bytes
// still trickle in is a slow network, not a dead stream, so it stays a note
// and re-checks (see _hardStallCheck). A genuinely dead feed surfaces a real
// error and pulls the server's proxy post-mortem so the user learns WHY
// (buffer overflow / engine EOF / corrupt source). Recovery at any point wipes
// both. (Before #21 this was a single 8 s hard error; #21 softened it into a
// note that never escalated — hiding real deaths; the byte-flow gate then
// stopped it firing on slow-but-alive links.)
let _stallSoftTimer = null;
let _stallHardTimer = null;
let _stalled = false;
// The active renderStatus closure, stashed so recovery can repaint the
// normal status line from module scope.
let _renderStatusFn = null;
function _clearStall() {
  if (_stallSoftTimer) { clearTimeout(_stallSoftTimer); _stallSoftTimer = null; }
  if (_stallHardTimer) { clearTimeout(_stallHardTimer); _stallHardTimer = null; }
  if (_stalled) {
    _stalled = false;
    if (!_renderStatusFn) return;
    // A stall that crossed the hard-timeout stopped the health ticker (but
    // kept _renderStatusFn). If playback has recovered, restart it so the
    // status line and buffer/fps figures un-freeze; otherwise just repaint.
    if (_bufferHealthTimer) _renderStatusFn();
    else _startBufferHealth(_renderStatusFn);
  }
}
function _armStall() {
  if (_stallSoftTimer || _stallHardTimer || _stalled) return;
  _stallSoftTimer = setTimeout(() => {
    _stallSoftTimer = null;
    _stalled = true;   // renderStatus no-ops so the note owns the line
    const s = $('pb-video-status');
    if (s) { s.textContent = 'Buffering — the stream paused, still trying…'; s.className = 'gate-hint'; }
  }, 5000);
  _stallHardTimer = setTimeout(_hardStallCheck, 20000);
}

// Stage-2 escalation, byte-flow aware. A buffer underrun on a very slow link
// looks identical to a dead proxy here (playback just stops), so disambiguate
// the same way _preRollBuffer does — by whether bytes are still arriving:
//
//   * feed still trickling in (bytes above the flow floor within the silence
//     window) → slow network, NOT a dead stream. Keep the soft "still
//     receiving" note and re-check later; given time it recovers. Crying
//     "proxy disconnected" here was the false alarm slow-network users hit.
//   * feed gone silent for STALL_FEED_SILENT_MS (or never delivered a byte) →
//     genuinely dead. Freeze the readout and surface the real error + the
//     server's post-mortem.
function _hardStallCheck() {
  _stallHardTimer = null;
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  if (!feedIsDead(now, _lastByteFlowAt)) {
    _stalled = true;   // renderStatus no-ops so the note owns the line
    const s = $('pb-video-status');
    if (s) { s.textContent = 'Buffering — slow network, still receiving…'; s.className = 'gate-hint'; }
    // Re-arm; a later true silence escalates, recovery ('playing'/'canplay' →
    // _clearStall) cancels this timer. _clearStall already clears _stallHardTimer.
    _stallHardTimer = setTimeout(_hardStallCheck, STALL_FEED_SILENT_MS);
    return;
  }
  _stalled = true;
  // Freeze the readout on the error, but keep _renderStatusFn so
  // _clearStall can un-freeze if the stream turns out to be recoverable.
  _stopBufferHealthTicker();
  _reportStreamDeath('Stream stalled — proxy disconnected or stream ended');
}

// A dismissible top-header notice for the pre-roll buffer overflowing:
// says what happened and offers a one-click fix. Resetting the buffer
// alone leaves the dead stream spinning, so the action ALSO restarts the
// stream — the reset only takes effect on the next start (buffer is read
// at play time), so reset-then-restart is the complete recovery.
// `atSecs` is the measured buffer fill depth at overflow (from the pre-roll
// path). Pass null when it isn't known (the server post-mortem only knows the
// stream ran, not how deep the buffer got) — the message then omits the figure
// rather than printing a misleading one.
function _bufferOverflowNotice(atSecs, target) {
  const at = atSecs != null ? '~' + atSecs + ' s' : 'its limit';
  console.warn('[playback/buffer] pre-roll buffer overflow — MSE SourceBuffer '
    + 'filled at ' + at + (atSecs != null ? '/' + target + ' s' : '')
    + '; lower the Player buffer.');
  showNotice({
    id: 'buffer-overflow',
    variant: 'danger',
    message: 'Buffer target ' + target + ' s is too high for this stream — the '
      + 'browser buffer filled at ' + at + ' and the stream dropped. '
      + 'Lower the Player buffer to keep playback stable.',
    actionLabel: '↺ Reset to ' + BUFFER_DEFAULT + ' s & restart',
    onAction: () => {
      setPlaybackBuffer(BUFFER_DEFAULT);
      dismissNotice('buffer-overflow');
      restartStream();   // reset applies on next start, so restart now
    },
  });
}

// Paint a real error on the video line, then enrich it with the server's
// last proxy end reason (the WHY) when that post-mortem lines up with the
// stream we were playing. Best-effort — a fetch failure just leaves the
// base message. When the server reports the classic buffer-overflow
// signature, also raise the reset-buffer notice.
async function _reportStreamDeath(baseMsg) {
  const s = $('pb-video-status');
  if (s) { s.textContent = baseMsg; s.className = 'gate-hint warn'; }
  let reason = null;
  try {
    const r = await fetch('/api/stream/last-error', { cache: 'no-store' }).then(x => x.json());
    // Accept only a record for THIS stream: same channel AND newer than the
    // last-error baseline we snapshotted when this play started (a prior
    // play's death shares that baseline `at`, so it's excluded).
    if (r && r.available && r.cid === _activeStreamCid
        && r.at > _playStartErrorAt) reason = r;
  } catch (_) { /* keep the base message */ }
  if (reason && s) s.textContent = baseMsg + ' — ' + reason.hint;
  if (reason && /browser dropped|buffer/.test(reason.hint)) {
    // We don't know the exact fill depth server-side (duration_s is the
    // stream's total runtime, not the buffer level), so pass null — the
    // notice phrases it without a bogus "filled at ~300 s" figure.
    _bufferOverflowNotice(null, getPlaybackBuffer());
  }
}

// Snapshot the server's current last-error `at` at play start, so
// _reportStreamDeath can tell a fresh death (newer `at`) from a stale record
// for the same channel — all on the server clock. Best-effort and fire-and-
// forget; if it never resolves, _playStartErrorAt stays 0 and only the cid
// match gates (the pre-existing behaviour, minus the clock-skew bug).
async function _snapshotLastErrorBaseline() {
  const startedCid = _activeStreamCid;
  try {
    const r = await fetch('/api/stream/last-error', { cache: 'no-store' }).then(x => x.json());
    // Ignore if another play superseded us while the fetch was in flight.
    if (_activeStreamCid !== startedCid) return;
    if (r && r.available && typeof r.at === 'number') _playStartErrorAt = r.at;
  } catch (_) { /* leave the baseline at 0 */ }
}

// One-time: forward mpegts.js's buffer diagnostics to the console even
// though we keep its default info/debug/verbose console output off. The
// Log listener fires via ENABLE_CALLBACK *independently* of those flags,
// so this surfaces the "SourceBuffer is full, suspend transmuxing" lines
// (the buffer-overflow breadcrumb the console used to show) WITHOUT the
// noisy init-segment chatter #21 silenced.
let _mpegtsBufLogInstalled = false;
function _installMpegtsBufferLog(mpegts) {
  const lc = mpegts && mpegts.LoggingControl;
  if (_mpegtsBufLogInstalled || !lc || typeof lc.addLogListener !== 'function') return;
  _mpegtsBufLogInstalled = true;
  lc.addLogListener((type, str) => {
    if (/SourceBuffer is full|buffering duration exceeded|buffer exceeded/i.test(str)) {
      console.warn('[playback/buffer]', str);
    }
  });
}

// Stop the 1s ticker but KEEP _renderStatusFn, so _clearStall can restart it
// when a long-but-recoverable stall resumes (see the hard-stall path).
function _stopBufferHealthTicker() {
  if (!_bufferHealthTimer) return;
  clearInterval(_bufferHealthTimer);
  _bufferHealthTimer = null;
}

// Full stop: ticker off AND the render closure dropped. Used on teardown
// (Stop / fresh Play), where nothing should repaint the old stream.
function _stopBufferHealth() {
  _stopBufferHealthTicker();
  _renderStatusFn = null;
}

function _startBufferHealth(render) {
  _stopBufferHealth();
  _renderStatusFn = render;          // let stall-recovery repaint from module scope
  render();                          // paint immediately, don't wait 1 s
  _bufferHealthTimer = setInterval(render, 1000);
}

// Pending pre-roll timers, so a Stop / fresh Play can cancel an
// in-flight buffer wait instead of leaking a 0–75 s setTimeout closure.
let _preRollHandle = null;

function _cancelPreRoll() {
  if (!_preRollHandle) return;
  clearInterval(_preRollHandle.timer);
  clearTimeout(_preRollHandle.cap);
  _preRollHandle = null;
}

// Keep the in-tab player paused until `target` seconds are buffered
// ahead of the playhead, then run `onRelease` (which calls play()).
// Polls the <video>'s buffered ranges every 250 ms; a safety cap
// releases anyway on slow / low-bitrate streams so we never strand the
// user on a frozen first frame.
function _preRollBuffer(v, status, target, onRelease) {
  _cancelPreRoll();
  let done = false;
  let lastHave = -1;      // highest buffered-ahead seconds seen so far
  let frozenSince = 0;    // timestamp the fill last advanced
  const release = () => {
    if (done) return;
    done = true;
    _cancelPreRoll();
    onRelease();
  };
  const tick = () => {
    if (!mpegtsPlayer) { _cancelPreRoll(); return; }
    if (bufferReady(v.buffered, v.currentTime, target)) { release(); return; }
    const have = Math.floor(bufferedAhead(v.buffered, v.currentTime));
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (have > lastHave) { lastHave = have; frozenSince = now; }
    // Fill stopped advancing well short of target for PREROLL_STALL_MS. Two
    // very different causes look identical here (the fill just stops growing),
    // so disambiguate by whether bytes are still arriving from the proxy:
    //
    //   * bytes STILL flowing while the fill won't grow → the browser's MSE
    //     SourceBuffer hit its memory ceiling (nothing plays during pre-roll,
    //     so autoCleanup can't evict). That's a real, measured ceiling: warn
    //     with the cause + a one-click buffer reset, feed it to "max ~N s",
    //     and release so the playhead advances and the buffer can drain.
    //   * bytes NOT flowing → the engine feed stalled, which is NOT a buffer
    //     problem. Don't cry "lower your buffer" (the old false alarm); keep
    //     waiting with a gentle note until the feed resumes or the safety cap
    //     releases us.
    else if (have > 0 && frozenSince && now - frozenSince > PREROLL_STALL_MS) {
      const bytesStillArriving = _lastByteFlowAt > frozenSince;
      if (bytesStillArriving) {
        _recordObservedMseCap(have);
        _bufferOverflowNotice(have, target);
        release();
        return;
      }
      // Engine feed stalled — hold and wait (idempotent: this branch just
      // repaints until `have` grows again or the safety-cap timeout fires).
      status.textContent = 'Buffering ' + Math.min(have, target) + '/' + target
        + ' s… waiting for the stream';
      status.className = 'gate-hint';
      return;
    }
    status.textContent = 'Buffering ' + Math.min(have, target) + '/' + target + ' s…';
    status.className = 'gate-hint';
  };
  const timer = setInterval(tick, 250);
  const cap = setTimeout(release, (target + 15) * 1000);
  _preRollHandle = { timer, cap };
  tick();
}

function getPlaybackBuffer() {
  const el = $('playback-buffer');
  if (el) return clampBuffer(el.value, 60);
  return clampBuffer(localStorage.getItem(KEYS.PLAYBACK_BUFFER), 60);
}

function stopInBrowserPlayback() {
  const v = $('pb-video');
  const status = $('pb-video-status');
  // Drop any in-flight pre-roll wait and the buffer-health ticker
  // before tearing the player down.
  _cancelPreRoll();
  _stopBufferHealth();
  _clearStall();
  _activeStreamCid = null;
  dismissNotice('buffer-overflow');   // a fresh Stop/Play clears the warning
  if (mpegtsPlayer) {
    try { mpegtsPlayer.pause(); } catch (_) {}
    try { mpegtsPlayer.unload(); } catch (_) {}
    try { mpegtsPlayer.detachMediaElement(); } catch (_) {}
    try { mpegtsPlayer.destroy(); } catch (_) {}
    mpegtsPlayer = null;
  }
  if (v) {
    v.pause();
    v.removeAttribute('src');
    v.load();
    v.style.display = 'none';
    refreshStatsVisibility();
    // Restore controls in case we stopped mid pre-roll (where they were
    // stripped) — the next play starts from a clean default.
    v.controls = true;
  }
  if (status) { status.textContent = ''; status.className = 'gate-hint'; }
  // Nothing is playing in this tab anymore — pull the Move button.
  if (livePlaybackTarget === 'browser') {
    livePlaybackTarget = '';
    if (typeof refreshPlaybackMoveButton === 'function') refreshPlaybackMoveButton();
  }
}

// A fatal in-browser playback failure: the channel's container/codec can't be
// decoded (NS_ERROR_FAILURE / "could not be decoded"). Retrying re-appends the
// undecodable data, so mpegts.js loops forever throwing "SourceBuffer … no
// longer usable". Tear the player down — which also clears livePlaybackTarget,
// so nothing (the probe included) still counts this as "playing" — and point
// the user at the external player, which decodes formats MSE can't. Fires once
// per play; both the native <video> onerror and mpegts' ERROR event call it.
let _fatalPlaybackHandled = false;
function _failPlaybackFatal(why) {
  if (_fatalPlaybackHandled) return;
  _fatalPlaybackHandled = true;
  // Defer the teardown one tick. Destroying/detaching the player synchronously
  // from inside the media-error (or a SourceBuffer `updateend`) callback yanks
  // the media element out from under a SourceBuffer op that's still finishing,
  // and mpegts.js then dereferences the now-null video
  // (_onSourceBufferUpdateEnd → "e.video is null"). Letting the current event
  // settle first avoids that. mpegts stops feeding on a fatal MediaError, so a
  // one-tick delay can't reopen the old append loop.
  const msg = 'This channel can’t play in the browser (its video stream stops '
    + 'decoding). Try the external player (VLC / mpv).';
  setTimeout(() => {
    stopInBrowserPlayback();          // destroys the player, clears livePlaybackTarget
    const status = $('pb-video-status');
    if (status) {
      status.textContent = why + ' — ' + msg;
      status.className = 'gate-hint warn';
    }
    // The status line sits inside the (now video-less) card and is easy to
    // miss — also raise a top notice so the stop is never silent.
    showNotice({ id: 'playback-unplayable', message: '⚠ ' + msg });
  }, 0);
}

// Updates the channel-name line above the playback URL. Empty primary
// hides the row entirely so a cid-typed-by-hand session doesn't get a
// misleading placeholder.
// Reflect the playing channel in the tab title so a row of tabs still
// tells you which is which. Falls back to plain "Aceman" when nothing's
// playing or when the channel has no display name (raw cid play).
export function setTabTitle(name) {
  const base = 'Aceman';
  document.title = name ? `${base} - ${name}` : base;
}

// One reused, auto-dismissing top toast for the small confirmations (Ace ID /
// device-link copy, "already playing"). Single id → only ever one banner; it
// fades out after 2s (showNotice owns the timer + fade).
function _toast(message) {
  showNotice({ id: 'aceman-toast', message, autoDismissMs: 2000 });
}

// True when `cid` is the channel actually playing right now — a live target AND
// the active channel. Lets a row re-click no-op instead of tearing down and
// restarting a working stream.
export function isCurrentlyPlaying(cid) {
  return !!(livePlaybackTarget && current && current.cid && cid
    && current.cid.toLowerCase() === String(cid).toLowerCase());
}

// Row-click guard: if `cid` is already playing, flash a brief toast and return
// true (the caller should bail); otherwise return false so it proceeds to play.
export function notifyIfAlreadyPlaying(cid) {
  if (!isCurrentlyPlaying(cid)) return false;
  _toast('Already playing.');
  return true;
}

// Copy the playing cid to the clipboard, with a brief top notice. The Watch
// input already displays the id, so this is purely the copy affordance.
export function copyPlayingCid() {
  if (!current || !current.cid) return;
  const cid = current.cid;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(cid)
      .then(() => _toast('Saved Ace ID to clipboard'))
      .catch(() => _toast('Could not copy the Ace ID (clipboard blocked)'));
  } else {
    _toast('Clipboard unavailable');
  }
}

// Playback-title interaction: single-click copies the Ace ID, double-click
// opens the channel in the Favourites tab (when it's actually saved). We copy
// SYNCHRONOUSLY in the click handler — deferring it (to "wait out" a possible
// double-click) drops the click's transient user activation, so
// navigator.clipboard.writeText rejects on Safari/WebKit. A double-click just
// copies on its first click (harmless) and then opens; no timer needed.
export function onPlaybackTitleClick() {
  copyPlayingCid();
}
export function onPlaybackTitleDblClick() {
  if (!current || !current.cid) return;
  const fav = findFavouriteByCid(allFavs, current.cid);
  if (fav) openFavourite(fav.name);   // only meaningful for a saved channel
}

export function setNowPlayingName(primary, sub) {
  const el = $('playback-title');
  el.textContent = '';
  // Only offer the click-to-copy affordance while a stream is playing.
  el.classList.toggle('clickable', !!primary);
  if (!primary) {
    // Card title falls back to the same string the empty-state HTML
    // uses — "Watch". Anything else here desyncs the title from the
    // input's placeholder ("Channel name, acestream://...") and
    // leaves the operator wondering whether a stale stream is still
    // referenced somewhere.
    el.textContent = 'Watch';
    return;
  }
  el.appendChild(document.createTextNode(primary));
  if (sub && sub !== primary) {
    const s = document.createElement('span');
    s.className = 'sub';
    s.textContent = sub;
    el.appendChild(s);
  }
}

// play() optionally takes context about *where* the Play came from so the
// now-playing card can show the channel name. If no name is passed (e.g.
// the user typed a cid directly), we try to look it up in the favourites
// list — typing a cid you've saved should still show its name.
//
// opts.skipConfirm=true suppresses the "Open in Brave and close this tab"
// confirm modal on the open-in-other-browser path. Used by the
// acestream:// pending-play pickup: the user already configured the
// target browser AND clicked the link — both are the same "I want to
// watch this" signal, asking again would be noise. Manual Play-button
// clicks keep the confirm.
export async function play(opts = {}) {
  showError('');
  const cid = parseId($('cid-input').value);
  if (!cid) { showError('Enter a 40-hex content id or an acestream:// URI.'); return; }

  // Resolve a display name: caller-provided name wins; missing
  // primary falls back to a favourite lookup so a raw cid typed
  // into the input still gets its proper saved label. See
  // ./lib/display_name.js.
  const { name: displayName, sub: displaySub } =
      resolveDisplayName(opts, allFavs, cid);
  current = { cid, name: displayName, altName: displaySub };
  setTabTitle(displayName);
  // Persist the live cid + display name so a page reload can rehydrate
  // the input + now-playing card. We only restore on load when the
  // broker confirms the wrapper is actually alive — see
  // refreshEngineStatus — so a stale key from a long-dead session
  // never repopulates the UI.
  saveLastPlay(localStorage, { cid, name: displayName, sub: displaySub });
  setNowPlayingName(displayName, displaySub);
  $('now-playing').style.display = 'block';
  updateSaveButton();
  refreshPlaybackMoveButton();

  // "Another device" target: nothing plays locally — the device's own
  // player opens the stream. Just (re)render the QR/URL for this cid.
  // Single playback: the device IS the session.
  if (deviceTargetSelected) {
    renderDeviceStream();
    return;
  }

  // Stamp last_played so the "watched N days ago" badge updates without a
  // refresh, and record the play in watch history. Both go through the
  // server (sqlite). Best-effort — Play must not fail on a bookkeeping write.
  const recordPlay = () => {
    api('/api/favs/touch', {
      method: 'POST', body: JSON.stringify({ cid }),
    }).catch(() => {});
    if (displayName) {
      api('/api/history', {
        method: 'POST', body: JSON.stringify({ cid, name: displayName }),
      }).catch(() => {});
    }
    loadFavs();
  };

  // "Android TV (VLC)" target: nothing plays locally — the broker pokes VLC
  // on the box over ADB to open the getstream URL. Single playback: the TV
  // is the session (the engine is already LAN-exposed by the target switch).
  // Cast FIRST and only record the play if it actually launched — a failed
  // cast (unauthorized / unreachable) must not write a phantom "watched" row.
  if (androidtvTargetSelected) {
    if (await castToAndroidTv(cid)) recordPlay();
    return;
  }

  // Local playback path — record the play up front (it's about to start).
  recordPlay();

  // Pure decision — see ./lib/playback_decision.js for the matrix
  // (playback_mode × default_browser × inBrowserSupported). Every
  // side effect below is gated by `path.kind`.
  const path = decidePlaybackPath(cfg, {
    inBrowserSupported: inBrowserSupported(),
  });

  // Stop any host-side player before starting in-browser paths.
  // open-in-other-browser is excluded — it shows a confirm modal
  // first and kills the player only after the user says yes, so
  // cancelling the confirm doesn't leave the user with a dead VLC
  // and no stream. external-scheme does its own teardown inside its case.
  if (path.kind === 'in-tab' || path.kind === 'in-tab-unsupported-fallback') {
    try { await api('/api/player/stop', { method: 'POST', body: '{}' }); }
    catch (_) { /* best-effort */ }
  }

  switch (path.kind) {
    case 'open-in-other-browser': {
      // Specific-browser target → open a new window there with
      // ?play=<cid>; its own JS picks up the cid and starts
      // in-page playback. We don't open anything in *this* tab.
      //
      // Skip the confirm modal when the caller already has implicit
      // consent (acestream://-link pickup): the user configured the
      // target browser AND clicked the link. Asking again would
      // make every link click two clicks.
      if (!opts.skipConfirm && !(await showConfirm({
          title: `Open in ${path.label}`,
          message: `Open the stream in ${path.label} and close this tab? `
                 + `A new window will open in ${path.label}. This tab will then `
                 + `close automatically so you don't end up with two players running.`,
          confirmText: 'Open & close',
      }))) {
        return;
      }
      // User confirmed — now safe to stop any external player (VLC/mpv).
      try { await api('/api/player/stop', { method: 'POST', body: '{}' }); }
      catch (_) { /* best-effort */ }
      stopInBrowserPlayback();   // free this tab so we don't double-stream
      try {
        await api('/api/open-in-browser', {
          method: 'POST', body: JSON.stringify({ cid }),
        });
        livePlaybackTarget = _currentTargetValue();
      } catch (e) {
        showError('Could not open browser: ' + e.message);
        refreshPlaybackMoveButton();
        return;
      }
      _closeThisTab(path.label);
      return;
    }

    case 'in-tab-unsupported-fallback': {
      showError(path.warning);
      livePlaybackTarget = path.target;
      window.location.href = 'acestream://' + cid;
      return;
    }

    case 'in-tab': {
      // Order matters: startInBrowserPlayback calls
      // stopInBrowserPlayback first to tear down any prior player,
      // and that helper clears livePlaybackTarget when it sees it
      // set to 'browser'. So we set the live target AFTER the start
      // call — otherwise we'd immediately blow away the value and
      // the Move button would think nothing is playing.
      startInBrowserPlayback(cid);
      livePlaybackTarget = 'browser';
      refreshPlaybackMoveButton();
      return;
    }

    case 'external-scheme': {
      // External player. Tear down BOTH possible previous players:
      //   (a) an in-browser proxy in this tab, and
      //   (b) any host-side VLC/mpv held by an earlier wrapper.
      if (mpegtsPlayer) stopInBrowserPlayback();
      try { await api('/api/player/stop', { method: 'POST', body: '{}' }); }
      catch (_) { /* best-effort */ }
      livePlaybackTarget = path.target;
      refreshPlaybackMoveButton();
      // The desktop entry installed for this app claims
      // x-scheme-handler/acestream and routes the URL to the host
      // aceman shell. The page stays put — browsers don't navigate
      // when the target scheme has a handler.
      window.location.href = 'acestream://' + cid;
      return;
    }
  }
}

// Unified "Play in" dropdown: in-browser tab + every detected browser
// + every detected external player are one flat list. Three classes
// of target, one decision:
//   "browser"               — this tab (in-page mpegts.js player)
//   "browser|name|source"   — open a new window in a specific browser
//                             which then auto-plays in its own tab
//   "external|name|source"  — VLC/mpv via the acestream:// scheme
function _currentTargetValue() {
  if (cfg.playback_mode === 'browser') {
    return encodeTarget('browser', cfg.default_browser, cfg.default_browser_source);
  }
  return encodeTarget('external', cfg.default_player, cfg.default_player_source);
}

function _addOptgroup(sel, label) {
  const g = document.createElement('optgroup');
  g.label = label;
  sel.appendChild(g);
  return g;
}

export function renderPlaybackTargets() {
  const sel = $('playback-target');
  const hint = $('player-hint');
  if (!sel) return;
  sel.innerHTML = '';
  hint.textContent = ''; hint.className = 'gate-hint';

  const showAll = $('show-all-browsers') && $('show-all-browsers').checked;
  const view = buildPlaybackOptions({
    detectedPlayers,
    detectedBrowsers,
    currentBrowser: _currentBrowserName,
    showAll,
    inBrowserSupported: inBrowserSupported(),
  });

  // Apply the group tree to the <select>. Top-level options (label
  // === null) attach directly; everything else gets an <optgroup>.
  for (const group of view.groups) {
    // No-local-desktop (WSL / macOS VM): host-side browsers + players
    // aren't reachable from the remote browser, so offer only "This tab"
    // (the null-label group) plus "Another device" (appended below).
    if (noLocalDesktop && group.label !== null) continue;
    const parent = group.label ? _addOptgroup(sel, group.label) : sel;
    for (const o of group.options) {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.text;
      opt.disabled = o.disabled;
      parent.appendChild(opt);
    }
  }

  // "Another device" is always available (engine-only — needs no local
  // player). Selecting it exposes the engine + shows a QR on the player
  // card; see onPlaybackTargetChange.
  const devGroup = _addOptgroup(sel, 'Other Devices');
  const devOpt = document.createElement('option');
  devOpt.value = 'device';
  devOpt.textContent = 'Another Device (e.g. smartphone with VLC)';
  devGroup.appendChild(devOpt);
  // "Android TV (VLC)" — auto-launch VLC on an Android/Google/Fire TV box
  // over ADB (one click, no typing on the TV). Engine-only like the device
  // target; see onPlaybackTargetChange for the connect/cast flow.
  const tvOpt = document.createElement('option');
  tvOpt.value = 'androidtv';
  tvOpt.textContent = 'Android TV (VLC — auto-play, no typing)';
  devGroup.appendChild(tvOpt);
  sel.disabled = false;

  if (!view.hasAnyTarget) {
    // No local browser/player. Both off-box targets still work here. Keep an
    // already-active Android-TV selection instead of snapping back to the QR
    // device target (a re-render must not clobber the user's choice);
    // otherwise land on "Another device" as the sane default.
    if (androidtvTargetSelected) {
      sel.value = 'androidtv';
      renderAndroidTvPanel();
    } else {
      sel.value = 'device';
      deviceTargetSelected = true;
      renderDeviceStream();
    }
    refreshPlaybackMoveButton();
    refreshPlayGate();
    return;
  }

  // In no-local-desktop mode the Player card is hidden — but we still need
  // a sane default selection for the Play button to use. Every detected
  // external player / browser belongs to the Linux side and isn't
  // reachable from a browser on another host; the only target that
  // actually works is the in-tab mpegts.js stream. Force it here and
  // persist, so a stale `default_player: vlc` left over from a previous
  // local-desktop session doesn't silently break Play.
  const wanted = noLocalDesktop ? 'browser' : _currentTargetValue();
  const wantedAvailable = wanted
      && Array.from(sel.options).some(o => o.value === wanted);
  if (wantedAvailable) {
    sel.value = wanted;
  } else if (sel.options.length) {
    sel.value = sel.options[0].value;
    persistPlaybackTarget(sel.value, /*silent=*/true);
  }
  // Independent of the path above: in no-local-desktop mode, if the
  // persisted config still names a Linux-side target, rewrite it to
  // 'browser' so the next /api/config read agrees with what we selected.
  const noLocalDesktopDrift = noLocalDesktop
      && wantedAvailable
      && cfg && cfg.playback_mode !== 'browser';
  if (noLocalDesktopDrift) {
    persistPlaybackTarget('browser', /*silent=*/true);
  }
  // Keep the dropdown on the transient device target across re-renders
  // (it's never persisted to cfg, so the wanted-selection above can't
  // pick it). Otherwise remember the real target for modal-cancel revert.
  if (deviceTargetSelected) {
    sel.value = 'device';
  } else if (androidtvTargetSelected) {
    sel.value = 'androidtv';
  } else {
    lastNonDeviceTarget = sel.value;
  }
  refreshPlaybackMoveButton();
}

// Stores the dropdown selection as config; no live-stream handoff
// here. `silent` suppresses the showError on save failure (used by
// the auto-fallback in renderPlaybackTargets).
export async function persistPlaybackTarget(value, silent) {
  const payload = targetValueToConfig(value);
  try {
    cfg = await api('/api/config', {
      method: 'POST', body: JSON.stringify(payload),
    });
  } catch (e) {
    if (!silent) showError(e.message);
  }
  refreshPlaybackMoveButton();
}

// Shows the "Move current stream here" button only when a stream is
// playing AND the dropdown's selection differs from where it's
// currently playing. Self-rebuilt on every render/save so the user
// never sees the button suggest a no-op.
// Swap the Play button between ▶ (idle) and ⏹ (something playing).
// The button keeps its primary blue style in both states; only the
// glyph + tooltip change. Anything that mutates livePlaybackTarget
// should call this (refreshPlaybackMoveButton is the canonical
// recompute point and already does).
// Blocking "please wait" overlay used during play/stop transitions
// where multiple awaits can run for a few hundred ms (broker call to
// kill the wrapper, in-tab proxy teardown, etc.). Without this users
// click again mid-flight and double-fire the whole sequence — leading
// to the very races we just spent days fixing. The modal-backdrop
// already covers the viewport and intercepts pointer events on
// everything below it.
// Block the UI behind the busy modal until the engine reports both
// container + HTTP API up, or until `timeoutMs` elapses. Caller can
// await this to sequence work after the engine is ready.
export async function waitForEngineReady(msg, timeoutMs = 90_000) {
  // Eager pre-check: ask the broker about the engine + image state
  // BEFORE showing the modal. If the image is uninstalled, the modal
  // never paints — we go straight to the actionable error. Saves the
  // ~600 ms minVisibleMs flash and avoids the poll-loop timing race
  // where the modal would paint, then dismiss the next tick.
  //
  // Failures here (BrokerError, connection refused, etc.) fall through
  // to the polling-loop path below, which is the right thing for a
  // transient blip: the loop will retry every 4 s via the standing
  // refreshEngineStatus interval and dismiss on first healthy read.
  try {
    const s = await api('/api/engine/status');
    engineState.applyPoll(s);
    // Image-missing bail: silently. The play-button gate hint
    // (`install the engine image in Setup & tools first`) already
    // paints next to the Play button from describePlayButton — adding
    // a second `showError` line above the play card was a duplicate.
    if (s && s.image_installed === false) return false;
    if (engineState.isHealthy()) return true;
  } catch (_) { /* fall through to the polling loop */ }

  showBusy(msg || 'Please wait while Aceman is getting ready…');
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  // Minimum visible duration so the modal actually paints — without it
  // a same-tick stale "engine up" snapshot would resolve before the
  // browser ever draws the backdrop.
  const minVisibleMs = 600;
  try {
    while (Date.now() < deadline) {
      if (engineState.isReadyToDismissSince(startedAt, minVisibleMs)) {
        return true;
      }
      // Same image-missing short-circuit (silent), for the case where
      // the eager pre-check above failed (BrokerError) and a later
      // poll comes through with image_installed=false. The
      // play-button gate hint already surfaces the actionable text.
      const s = engineState.last;
      const haveFreshRead = engineState.isFreshSince(startedAt);
      const minHeld = (Date.now() - startedAt) >= minVisibleMs;
      if (haveFreshRead && minHeld && s && s.image_installed === false) {
        return false;
      }
      await new Promise(r => setTimeout(r, 250));
    }
    return false;
  } finally { hideBusy(); }
}

// Cold-start gate. Launched from the desktop entry, the browser opens
// (and the static page paints) a beat before the web backend is
// accepting connections — the wrapper may still be (re)creating the
// --rm web container. The first /api/* fetch then rejects with a bare
// NetworkError (no .status) and the user lands on a live-looking page
// behind a "Could not contact backend" line. Hold behind the busy
// modal and retry until the server answers.
//
// Retries ONLY on connection-level failures. An error carrying a
// .status means the server DID respond (some real HTTP error) — that's
// not a "still booting" case, so we surface it rather than spin.
// Returns true once reachable, false if the deadline passes first.
export async function waitForBackend(msg, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let shown = false;
  try {
    for (;;) {
      try {
        await api('/api/storage-mode');
        return true;
      } catch (e) {
        if (e && e.status !== undefined) throw e;   // reachable, real error
        if (Date.now() >= deadline) return false;
        if (!shown) {
          showBusy(msg || 'Please wait while Aceman is getting ready…');
          shown = true;
        }
        await new Promise(r => setTimeout(r, 500));
      }
    }
  } finally {
    if (shown) hideBusy();
  }
}

function refreshPlayButton() {
  const btn = $('play-btn');
  if (!btn) return;
  const v = describePlayButton(!!livePlaybackTarget);
  btn.textContent = v.text;
  btn.title = v.title;
  btn.setAttribute('aria-label', v.ariaLabel);
  btn.classList.toggle('playing', v.playingClass);
  const rbtn = $('restream-btn');
  // Show the restart (↺) button whenever anything is live — browser OR
  // external. restartStream() handles both: for external it stops the
  // host player and re-fires acestream://, which relaunches VLC/mpv with
  // the current buffer_secs. Restart is how a changed buffer/GPU setting
  // takes effect.
  // Visibility (not display) so the reserved slot never reflows the row.
  if (rbtn) rbtn.style.visibility = livePlaybackTarget ? 'visible' : 'hidden';
  // Nothing live → no stream to restart, so retire the reminder.
  if (!livePlaybackTarget) dismissNotice('restart-needed');
}

export async function restartStream() {
  if (!current) return;
  const cid = current.cid;
  dismissNotice('restart-needed');   // restarting resolves the reminder
  showBusy('Restarting…');
  try {
    stopInBrowserPlayback();
    try { await api('/api/player/stop', { method: 'POST', body: '{}' }); }
    catch (_) { /* best-effort */ }
    $('cid-input').value = cid;
    await play({ name: current.name });
  } finally {
    hideBusy();
  }
}

function refreshPlaybackMoveButton() {
  const btn = $('playback-move');
  const sel = $('playback-target');
  // "Live" pip on the PLAYBACK card label reuses the same authoritative
  // "is anything actually playing right now" flag the move button does.
  const livePip = $('playback-live');
  if (livePip) livePip.style.display = livePlaybackTarget ? '' : 'none';
  refreshPlayButton();
  // Canonical recompute point for live state. Refresh the ✕ clear
  // button (depends on the input value) from here so anything that
  // changes cid-input programmatically — play(), play-on-load,
  // search/history/favourite click — updates it even if no `input`
  // event fired.
  refreshClearButton();
  if (!btn || !sel) return;
  const selectedLabel = sel.selectedIndex >= 0
      ? sel.options[sel.selectedIndex].textContent
      : '';
  const view = describeMoveButton(livePlaybackTarget, sel.value, selectedLabel);
  btn.style.display = view.visible ? '' : 'none';
  if (view.visible) btn.textContent = view.text;
  requestAnimationFrame(refreshPlayerRowAlignment);
}

// Align #playback-move and #show-all-row when they wrap to a new flex row.
//
// Move button: indent to 5.5rem (left-aligns under the dropdown trigger).
// Show all: center horizontally under the Move button. When Move is hidden,
// fall back to centering under the dropdown trigger itself.
// When either item is on the same row as the label it gets no forced indent
// (move) or auto-push-right (show-all) instead.
export function refreshPlayerRowAlignment() {
  const field = $('player-select-row');
  if (!field) return;
  const label = field.querySelector('.field-label');
  if (!label) return;
  const labelBottom = label.getBoundingClientRect().bottom;

  const moveBtn = $('playback-move');
  const moveBtnVisible = moveBtn && moveBtn.offsetParent !== null;
  const moveBtnWrapped = moveBtnVisible &&
    moveBtn.getBoundingClientRect().top > labelBottom - 4;

  if (moveBtnVisible) {
    moveBtn.style.marginLeft = moveBtnWrapped ? '5.5rem' : '';
  }

  const showAll = $('show-all-row');
  if (!showAll) return;
  const showAllWrapped = showAll.getBoundingClientRect().top > labelBottom - 4;
  if (!showAllWrapped) { showAll.style.marginLeft = 'auto'; return; }

  // Center show-all under the reference element (Move button when visible,
  // otherwise the dropdown trigger). Move button's left edge is already
  // known to be 5.5rem when wrapped, so compute its centre without a reflow.
  const remPx = parseFloat(getComputedStyle(document.documentElement).fontSize);
  const showAllWidth = showAll.offsetWidth;

  if (moveBtnWrapped) {
    const moveCenter = 5.5 * remPx + moveBtn.offsetWidth / 2;
    showAll.style.marginLeft = Math.max(0, moveCenter - showAllWidth / 2) + 'px';
  } else {
    const trigger = field.querySelector('.aceman-select-trigger');
    if (trigger) {
      const fieldLeft = field.getBoundingClientRect().left;
      const tr = trigger.getBoundingClientRect();
      const trigCenter = tr.left - fieldLeft + tr.width / 2;
      showAll.style.marginLeft = Math.max(0, trigCenter - showAllWidth / 2) + 'px';
    } else {
      showAll.style.marginLeft = '5.5rem';
    }
  }
}

export async function movePlaybackToSelection() {
  if (!current) return;
  const value = $('playback-target').value;

  // Pre-compute what path the new target will take so we can ask
  // for confirmation BEFORE showing any busy overlay or touching
  // the current player — cancelling must leave VLC/mpv untouched.
  const prospectivePath = decidePlaybackPath(
    targetValueToConfig(value), { inBrowserSupported: inBrowserSupported() });

  // Always confirm before moving a live stream — all paths kill the
  // current player and the user may have clicked by accident.
  // open-in-other-browser gets a specific warning because the tab
  // closes; all other paths get a generic "move to X?" prompt.
  const sel = $('playback-target');
  const destLabel = sel.options[sel.selectedIndex]
    ? sel.options[sel.selectedIndex].textContent.trim()
    : 'selected player';

  const confirmOpts = prospectivePath.kind === 'open-in-other-browser'
    ? {
        title: `Open in ${prospectivePath.label}`,
        message: `Open the stream in ${prospectivePath.label} and close this tab? `
               + `A new window will open in ${prospectivePath.label}. This tab will then `
               + `close automatically so you don't end up with two players running.`,
        confirmText: 'Open & close',
      }
    : {
        title: 'Move stream',
        message: `Move the current stream to ${destLabel}?`,
        confirmText: 'Move',
      };

  if (!(await showConfirm(confirmOpts))) return;

  // User confirmed. Now safe to stop the current player.
  showBusy('Switching player…');
  try {
    try { await api('/api/player/stop', { method: 'POST', body: '{}' }); }
    catch (_) { /* best-effort */ }
    stopInBrowserPlayback();
    await persistPlaybackTarget(value, /*silent=*/false);
    $('cid-input').value = current.cid;
    await play({ name: current.name, skipConfirm: true });
    refreshPlaybackMoveButton();
  } finally {
    hideBusy();
  }
}

// ---- engine status + controls ------------------------------------------
let pendingEngineAction = false; // suppress polling label flicker while a button is mid-action
let pendingLanAction = false;    // same, for the LAN-expose toggle's in-flight POST
let lanExposed = false;          // last-known engine LAN-exposure state (from status)
let lanIp = '';                  // stashed from engine status for the device URL
let lanPort = 0;
let deviceTargetSelected = false;// 'Another device' is the active "Play in" target (transient)
let androidtvTargetSelected = false; // 'Android TV (VLC)' is the active target (transient, like device)
let lastNonDeviceTarget = '';    // restore the dropdown if the expose modal is cancelled

// Settling-window state machine — see ./lib/engine_state.js. The
// transitions (running→down, held-enough exit, healthy clear) are
// pure logic that lives in the module and is unit-tested under
// web/js_tests/engine_state.test.mjs. This file owns only the
// poll / hydrate / render wiring around it.
export const engineState = new EngineStatusState();

// First-to-claim acestream:// handoff. The wrapper's fast-path POSTs
// the cid to /api/play-request when a second invocation fires; every
// open tab sees s.pending_play_cid on the next status poll. POST the
// claim — server atomically clears the slot, only the first POST
// returns claimed:true. Multiple tabs each call play() at most once
// because the server is the synchronisation point.
async function maybePickUpPendingPlay(s) {
  const cid = (s && typeof s.pending_play_cid === 'string')
              ? s.pending_play_cid : '';
  if (!/^[a-f0-9]{40}$/.test(cid)) return;
  // Already live with this cid? Don't bounce playback.
  if (current && current.cid === cid) return;
  let claim;
  try {
    claim = await api('/api/play-request/claim', {
      method: 'POST', body: JSON.stringify({ cid }),
    });
  } catch (_) { return; }
  if (!claim || claim.claimed !== true) return;
  // We own this handoff. Fill the Watch input and play through the
  // same code path a fav-click uses — resolveDisplayName picks up the
  // name from favourites if it's saved. skipConfirm so a configured
  // "play in Brave" target doesn't prompt the user mid-link-click.
  $('cid-input').value = cid;
  refreshClearButton();
  try { await play({ skipConfirm: true }); }
  catch (_) { /* surfaced via showError */ }
}

export async function refreshEngineStatus() {
  if (pendingEngineAction) return;
  let s;
  try {
    s = await api('/api/engine/status');
  } catch (_) {
    return;  // leave previous state on the UI
  }
  engineState.applyPoll(s);
  // Fire-and-forget — pending-play handling shouldn't block the rest
  // of the status refresh. The claim POST has its own short timeout.
  maybePickUpPendingPlay(s);
  // External player went away (user closed VLC window, mpv crashed,
  // wrapper exited normally) — clear the live pip so it stops
  // blinking when nothing is actually playing.
  if (isExternal(livePlaybackTarget) && s.wrapper_alive === false) {
    livePlaybackTarget = '';
    refreshPlaybackMoveButton();
  }
  // External player IS alive but the page just loaded / reloaded so
  // we lost the in-memory livePlaybackTarget. Recover it from the
  // saved player preference so the Play button immediately shows the
  // stop glyph (▶ → ⏹) without waiting for the user to act. Same go
  // for the cid + display name:
  //   1. server-provided wrapper_cid wins (covers the
  //      acestream://-link flow where the web never played anything
  //      itself — localStorage is empty there, but the shell wrapper
  //      writes its cid to a runtime file the broker surfaces)
  //   2. fall back to the localStorage stash (covers the in-tab Play
  //      then reload flow)
  // Name is resolved from favourites whenever we only have a cid —
  // typing/clicking a saved cid should still show its name.
  if (!livePlaybackTarget && s.wrapper_alive === true
      && cfg.playback_mode === 'external' && cfg.default_player) {
    livePlaybackTarget = encodeTarget('external', cfg.default_player, cfg.default_player_source);
    const last = loadLastPlay(localStorage);
    const cid = (s.wrapper_cid && /^[a-f0-9]{40}$/.test(s.wrapper_cid))
                ? s.wrapper_cid
                : (last && last.cid) || '';
    if (cid) {
      // If we got the cid from the wrapper we don't have a name —
      // resolveDisplayName takes care of the favourites lookup
      // (same call play() uses) so an already-saved channel surfaces
      // its name automatically.
      const fromLast = last && last.cid === cid ? last : null;
      const { name: displayName, sub: displaySub } =
          resolveDisplayName(fromLast || {}, allFavs, cid);
      current = { cid, name: displayName, altName: displaySub };
      setTabTitle(displayName);
      $('cid-input').value = cid;
      refreshClearButton();
      setNowPlayingName(displayName, displaySub);
      $('now-playing').style.display = 'block';
      updateSaveButton();
    }
    refreshPlaybackMoveButton();
  }
  // Wrapper is definitely gone — drop the stash so a future reload
  // doesn't repopulate the input from a stale session. BUT only when
  // we're actually in external-player mode: in-browser playback has
  // no host-side wrapper by design (wrapper_alive is permanently
  // false), so an unconditional clear here would wipe the cid every
  // poll cycle and the in-browser refresh-rehydrate path would never
  // see anything in localStorage.
  if (s.wrapper_alive === false
      && cfg.playback_mode === 'external'
      && !mpegtsPlayer) {
    clearLastPlay(localStorage);
  }
  const el = $('engine-status');
  const btn = $('engine-toggle');
  const hint = $('engine-toggle-hint');

  const view = describeEngineToggle(s, engineState.isSettling());
  el.textContent = view.status;
  el.className = view.statusClass;
  btn.textContent = view.button.text;
  btn.dataset.action = view.button.action;
  btn.className = view.button.className;
  btn.disabled = view.button.disabled;
  hint.textContent = view.hint.text;
  hint.className = view.hint.className;

  renderEngineLanToggle(s);
  // Keep the player-card QR fresh as the cid / lan state changes.
  if (deviceTargetSelected) renderDeviceStream();
  refreshPlayGate();
}

// Engine card: reflect the broker's LAN-exposure state on the manual
// expose/unexpose checkbox + its warning, and stash lan_ip/lan_port for
// the device URL. The QR lives on the player card (renderDeviceStream),
// never here.
function renderEngineLanToggle(s) {
  lanExposed = !!s.lan_exposed;
  if (s.lan_ip != null) lanIp = s.lan_ip;
  if (s.lan_port != null) lanPort = s.lan_port;
  const cb = $('lan-expose');
  if (!cb) return;
  // Don't fight the user's click while their POST is in flight.
  if (!pendingLanAction) cb.checked = lanExposed;
  $('lan-expose-warn').style.display = lanExposed ? '' : 'none';
}

// Manual engine-card checkbox. Toggles exposure directly; the inline
// warning is enough here — the confirm modal is reserved for the
// player-card "Another device" target (the guided path).
export async function toggleLanExpose() {
  const cb = $('lan-expose');
  const enabled = cb.checked;
  pendingLanAction = true;
  cb.disabled = true;
  showError('');
  // Toggling the bind re-spawns the engine — block with the shared overlay.
  showBusy(enabled
    ? 'Restarting engine to expose it on your network…'
    : 'Restarting engine to close network access…');
  try {
    const s = await api('/api/engine/lan-expose', {
      method: 'POST', body: JSON.stringify({ enabled }),
    });
    renderEngineLanToggle(s);
    if (!enabled && deviceTargetSelected) {
      // Unexposing while "Another device" is the target would leave a
      // dead link — fall back to local playback in this tab.
      deviceTargetSelected = false;
      hideDeviceStream();
      const sel = $('playback-target');
      if (sel) sel.value = 'browser';
      lastNonDeviceTarget = 'browser';
      refreshPlayGate();
      persistPlaybackTarget('browser');
    } else if (deviceTargetSelected) {
      renderDeviceStream();
    }
  } catch (e) {
    showError(e.message);
    cb.checked = !enabled; // revert UI on failure
  } finally {
    pendingLanAction = false;
    cb.disabled = false;
    hideBusy();
  }
}

// Player card: render (or hide) the off-box stream URL + QR for the cid
// in focus while the "Another device" target is selected. Reads the
// lan_ip/lan_port stashed from the last engine status. Shows a guiding
// hint instead of a dead link when there's no usable URL yet.
function renderDeviceStream() {
  const box = $('device-stream');
  if (!box) return;
  if (!deviceTargetSelected) {
    box.style.display = 'none';
    box.dataset.url = '';
    return;
  }
  box.style.display = '';
  // Scope the QR to the Watch box only — clearing it (the X) hides the QR.
  // Deliberately NOT falling back to `current` (last played): that stays
  // set so the now-playing card + search-while-playing keep working, but
  // a cleared field shouldn't keep a stale QR alive.
  const cid = parseId($('cid-input').value) || '';
  const url = buildLanStreamUrl({ lanExposed, lanIp, lanPort, cid });
  const hint = $('device-stream-hint');
  const link = $('device-stream-link');
  const qr = $('device-stream-qr');
  if (!url) {
    box.dataset.url = '';
    link.textContent = '';
    link.setAttribute('href', '#');
    link.style.display = 'none';
    qr.innerHTML = '';
    hint.textContent = !lanExposed
      ? 'Engine not exposed yet — tick "Expose engine on local network" on the engine card.'
      : 'Select stream from search or from favourites.';
    return;
  }
  hint.textContent = 'Scan the QR on the other device — or click it to copy the link.';
  // Only rebuild the QR when the URL actually changes.
  if (box.dataset.url === url) return;
  box.dataset.url = url;
  // New stream → stash the link but keep it hidden until the QR is clicked.
  link.href = url;
  link.textContent = url;
  link.style.display = 'none';
  qr.innerHTML = '';
  // `qrcode` is the vendored global (its own <script>). Guard so a
  // blocked/failed vendor load degrades gracefully (the link still works
  // once revealed, even without a rendered QR).
  if (typeof qrcode === 'function') {
    const q = qrcode(0, 'M');
    q.addData(url);
    q.make();
    qr.innerHTML = q.createSvgTag({ cellSize: 4, margin: 1, scalable: true });
  }
}

// Click the QR to reveal the link below it and copy it to the clipboard;
// click again to hide it (the clipboard is left as-is — browsers can't
// selectively un-copy). No-op until there's a usable link.
export function toggleDeviceLink() {
  const link = $('device-stream-link');
  if (!link) return;
  const url = link.getAttribute('href');
  if (!url || url === '#') return;
  if (link.style.display !== 'none') {   // shown → hide
    link.style.display = 'none';
    return;
  }
  link.style.display = '';
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url)
      .then(() => _toast('Device link copied to clipboard'))
      .catch(() => _toast('Link shown (clipboard blocked)'));
  } else {
    _toast('Link shown (clipboard unavailable)');
  }
}

function hideDeviceStream() {
  const box = $('device-stream');
  if (box) { box.style.display = 'none'; box.dataset.url = ''; }
}

// Re-render the device QR/link off the current Watch-box value. Exported
// so the Watch input's change/clear handlers can update it immediately
// (no-ops unless the device target is active). The status poll also
// drives renderDeviceStream, but typing/clearing shouldn't wait for it.
export function refreshDeviceStream() {
  renderDeviceStream();
}

// ---- "Android TV (VLC)" target -----------------------------------------
//
// Unlike "Another device" (which shows a QR you open by hand), this target
// pokes an Android/Google/Fire TV box over network ADB and launches VLC on
// it — one click, no typing on the TV remote. The host-side broker runs
// `adb`; here we only enter the box IP, drive the one-time debugging
// approval, and fire the cast on Play. Like the device target it's a
// single-playback session, so it also LAN-exposes the engine (VLC on the
// box fetches the getstream URL directly) — the broker builds that URL.

function _androidTvIp() {
  const el = $('androidtv-ip');
  // Fall back to the most-recent cached IP when the field is still empty
  // (e.g. the prefill fetch hasn't landed) so a Connect/Cast doesn't
  // spuriously report "invalid-ip" for a box we already remember.
  return (((el && el.value) || '').trim()) || (_tvIps[0] || '');
}

function _setAndroidTvStatus(msg, kind) {
  const s = $('androidtv-status');
  if (!s) return;
  s.textContent = msg || '';
  s.className = 'gate-hint' + (kind === 'warn' ? ' warn' : '');
}

// Show/hide the inline Android-TV panel; pull the remembered IPs from the
// server and prefill the most-recent one so the common case (same box every
// time) is a single click.
function renderAndroidTvPanel() {
  const box = $('androidtv-panel');
  if (!box) return;
  if (!androidtvTargetSelected) { box.style.display = 'none'; closeTvIpDropdown(); return; }
  box.style.display = '';
  // Sync prefill from whatever's already cached; refreshTvIps() (called by
  // the target switch) then reconciles with the server. Kept sync so callers
  // that need a filled field before acting can await refreshTvIps themselves.
  const ip = $('androidtv-ip');
  if (ip && !ip.value) ip.value = _tvIps[0] || '';
}

// ---- remembered-IP combobox (server-backed history + live search) ------
// The IP list lives in SQLite (/api/tv/ips), shared across browsers/devices;
// the web server records an IP whenever a connect/cast succeeds. Here we keep
// an in-memory cache of that list, filter it client-side as the user types
// (filterIps), and DELETE entries the user removes. filter + optimistic
// remove are the pure bits (lib/tv_ip_history.js).

let _tvIps = [];   // cache of remembered TV IPs, most-recent first

// Reload the cache from the server, then (re)prefill / (re)render as needed.
// Best-effort — a failed fetch keeps the last cache rather than blanking it.
async function refreshTvIps() {
  try {
    const list = await api('/api/tv/ips');
    if (Array.isArray(list)) _tvIps = list;
  } catch (_) { /* keep the existing cache */ }
  const ip = $('androidtv-ip');
  if (ip && !ip.value) ip.value = _tvIps[0] || '';
  const listbox = $('androidtv-ip-list');
  if (listbox && !listbox.hidden) renderTvIpDropdown(ip ? ip.value : '');
}

// One document-level "click outside closes the dropdown" listener, added
// only while it's open so it doesn't leak.
let _tvIpOutsideHandler = null;

function closeTvIpDropdown() {
  const listbox = $('androidtv-ip-list');
  if (listbox) listbox.hidden = true;
  const ip = $('androidtv-ip');
  if (ip) ip.setAttribute('aria-expanded', 'false');
  if (_tvIpOutsideHandler) {
    document.removeEventListener('click', _tvIpOutsideHandler, true);
    _tvIpOutsideHandler = null;
  }
}

function openTvIpDropdown() {
  const ip = $('androidtv-ip');
  renderTvIpDropdown(ip ? ip.value : '');
  const listbox = $('androidtv-ip-list');
  if (!listbox) return;
  listbox.hidden = false;
  if (ip) ip.setAttribute('aria-expanded', 'true');
  if (!_tvIpOutsideHandler) {
    _tvIpOutsideHandler = (e) => {
      const wrap = $('androidtv-ip-wrap');
      if (wrap && !wrap.contains(e.target)) closeTvIpDropdown();
    };
    document.addEventListener('click', _tvIpOutsideHandler, true);
  }
}

// Build the dropdown body filtered by the current query. Rows carry a
// data-tv-action + data-ip so one delegated handler (onTvIpListClick) drives
// select / remove / close without per-row closures.
function renderTvIpDropdown(query) {
  const listbox = $('androidtv-ip-list');
  if (!listbox) return;
  const all = _tvIps;
  const matches = filterIps(all, query);
  listbox.textContent = '';

  const head = document.createElement('div');
  head.className = 'tv-ip-head';
  const title = document.createElement('span');
  title.textContent = all.length ? 'Saved TVs' : 'No saved TVs yet';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'tv-ip-close';
  close.dataset.tvAction = 'close';
  close.setAttribute('aria-label', 'Close');
  close.textContent = '✕';
  head.appendChild(title);
  head.appendChild(close);
  listbox.appendChild(head);

  const scroll = document.createElement('div');
  scroll.className = 'tv-ip-scroll';
  if (!matches.length) {
    const empty = document.createElement('div');
    empty.className = 'tv-ip-empty';
    empty.textContent = all.length ? 'No matches.' : 'Enter a TV IP above to start.';
    scroll.appendChild(empty);
  } else {
    for (const val of matches) {
      const row = document.createElement('div');
      row.className = 'tv-ip-row';
      row.setAttribute('role', 'option');
      row.dataset.tvAction = 'select';
      row.dataset.ip = val;
      const label = document.createElement('span');
      label.className = 'tv-ip-val';
      label.textContent = val;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'tv-ip-del';
      del.dataset.tvAction = 'remove';
      del.dataset.ip = val;
      del.setAttribute('aria-label', 'Remove ' + val);
      del.title = 'Remove';
      del.textContent = '✕';
      row.appendChild(label);
      row.appendChild(del);
      scroll.appendChild(row);
    }
  }
  listbox.appendChild(scroll);
}

// Delegated click on the dropdown: pick an IP, remove one, or close.
export function onTvIpListClick(e) {
  const hit = e.target.closest('[data-tv-action]');
  if (!hit) return;
  const action = hit.dataset.tvAction;
  if (action === 'close') { closeTvIpDropdown(); return; }
  if (action === 'remove') {
    e.stopPropagation();   // don't also "select" the row we're deleting
    const target = hit.dataset.ip;
    _tvIps = removeIp(_tvIps, target);   // optimistic
    const ip = $('androidtv-ip');
    renderTvIpDropdown(ip ? ip.value : '');
    // Persist the removal; re-sync from the server if it failed.
    api('/api/tv/ips/' + encodeURIComponent(target), { method: 'DELETE' })
      .catch(() => refreshTvIps());
    return;
  }
  if (action === 'select') {
    const ip = $('androidtv-ip');
    if (ip) ip.value = hit.dataset.ip;
    _setAndroidTvStatus('');
    closeTvIpDropdown();
  }
}

// Live search: re-filter (and open) the dropdown as the user types.
export function onTvIpInput() { openTvIpDropdown(); }

// ▾ toggle: open the full list, or close it if already open.
export function toggleTvIpDropdown() {
  const listbox = $('androidtv-ip-list');
  if (listbox && !listbox.hidden) closeTvIpDropdown();
  else openTvIpDropdown();
}

// Turn a broker tv.* status into a human guidance line. Returns true only
// when the box is authorized and ready to receive a cast.
function _applyTvStatus(status) {
  switch (status) {
    case 'authorized':
      _setAndroidTvStatus('TV connected ✓ — press Play to cast.'); return true;
    case 'unauthorized':
      _setAndroidTvStatus('Approve the debugging prompt on your TV (tick '
        + '“Always allow from this computer”), then Connect again.', 'warn');
      return false;
    case 'unreachable':
      _setAndroidTvStatus('Can’t reach the TV — check the IP and that the box '
        + 'is on, with ADB/Network debugging enabled.', 'warn'); return false;
    case 'no-adb':
      _setAndroidTvStatus('adb isn’t installed on the host — run '
        + 'check_install_dependencies.sh to add it.', 'warn'); return false;
    case 'invalid-ip':
      _setAndroidTvStatus('Enter the TV’s IP address (e.g. 192.168.1.50).', 'warn');
      return false;
    default:
      _setAndroidTvStatus('Cast failed (' + status + ').', 'warn'); return false;
  }
}

// Connect + probe the box; drives the one-time on-TV approval. Exported for
// the panel's Connect button. Persists the IP so next time it's prefilled.
export async function connectAndroidTv() {
  const ip = _androidTvIp();
  closeTvIpDropdown();
  if (!ip) { _applyTvStatus('invalid-ip'); return false; }
  _setAndroidTvStatus('Connecting to ' + ip + '…');
  try {
    const r = await api('/api/tv/connect', {
      method: 'POST', body: JSON.stringify({ ip }),
    });
    if (r && r.status === 'authorized') refreshTvIps();   // server recorded it
    return _applyTvStatus(r && r.status);
  } catch (e) {
    _setAndroidTvStatus('Connect failed: ' + e.message, 'warn');
    return false;
  }
}

// Fire the cast: VLC opens on the box and plays the cid. Called from play()
// when the Android-TV target is active. Returns true on a launched cast.
async function castToAndroidTv(cid) {
  const ip = _androidTvIp();
  if (!ip) { _applyTvStatus('invalid-ip'); return false; }
  _setAndroidTvStatus('Casting to ' + ip + '…');
  try {
    const r = await api('/api/tv/cast', {
      method: 'POST', body: JSON.stringify({ ip, cid }),
    });
    if (r && r.cast) {
      refreshTvIps();   // server recorded it — refresh the combobox cache
      _setAndroidTvStatus('Playing on the TV ✓ (VLC).');
      return true;
    }
    _applyTvStatus(r && r.status);
    return false;
  } catch (e) {
    _setAndroidTvStatus('Cast failed: ' + e.message, 'warn');
    return false;
  }
}

// Force-stop VLC on the box — a clean exit that releases our stream. Exported
// for the panel's Stop button. Returns true once VLC has been torn down.
export async function stopAndroidTv() {
  const ip = _androidTvIp();
  closeTvIpDropdown();
  if (!ip) { _applyTvStatus('invalid-ip'); return false; }
  _setAndroidTvStatus('Stopping VLC on ' + ip + '…');
  try {
    const r = await api('/api/tv/stop', {
      method: 'POST', body: JSON.stringify({ ip }),
    });
    if (r && r.stopped) {
      _setAndroidTvStatus('Stopped VLC on the TV ✓');
      return true;
    }
    _applyTvStatus(r && r.status);
    return false;
  } catch (e) {
    _setAndroidTvStatus('Stop failed: ' + e.message, 'warn');
    return false;
  }
}

// "Play in" dropdown change. "Another device" is special: it isn't a
// saved player — it exposes the engine on the LAN (after a warning) and
// shows a QR/URL for a player on another device. Every other value is a
// normal saved target. Leaving the device target closes the exposure:
// device == the session, single playback.
export async function onPlaybackTargetChange() {
  const sel = $('playback-target');
  const value = sel.value;
  // "Another device" (QR) and "Android TV (VLC)" are both single-playback,
  // engine-LAN-exposed targets — the stream is fetched off-box. They share
  // the expose + stop-local-player setup and differ only in what they show
  // (a QR vs the ADB connect panel).
  if (value === 'device' || value === 'androidtv') {
    const isTv = value === 'androidtv';
    if (!lanExposed) {
      const ok = await showConfirm({
        title: isTv ? 'Play on Android TV' : 'Open on another device',
        message: 'This exposes the engine on your local network so a player '
               + 'on another device (VLC on a TV, phone or tablet) can reach '
               + 'it. While it is on, anything on your network can reach the '
               + 'engine — use only on a network you trust. It turns off when '
               + 'you pick another player.',
        confirmText: 'Expose engine',
      });
      if (!ok) { sel.value = lastNonDeviceTarget || 'browser'; return; }
      // Re-binding the engine to the LAN re-spawns the container, which
      // takes a few seconds — block with the shared overlay so the user
      // isn't left wondering.
      showBusy('Restarting engine to expose it on your network…');
      try {
        const s = await api('/api/engine/lan-expose', {
          method: 'POST', body: JSON.stringify({ enabled: true }),
        });
        renderEngineLanToggle(s);
      } catch (e) {
        showError(e.message);
        sel.value = lastNonDeviceTarget || 'browser';
        return;
      } finally {
        hideBusy();
      }
    }
    // The off-box target is the session — single playback. Stop any local
    // player so nothing keeps streaming here: the in-tab mpegts player
    // AND any host-side VLC/mpv.
    if (mpegtsPlayer) stopInBrowserPlayback();
    try { await api('/api/player/stop', { method: 'POST', body: '{}' }); }
    catch (_) { /* best-effort */ }
    livePlaybackTarget = '';
    deviceTargetSelected = !isTv;
    androidtvTargetSelected = isTv;
    if (isTv) {
      hideDeviceStream();
      renderAndroidTvPanel();
      // Load the remembered IPs (fills the field) BEFORE probing, so the
      // one-time on-TV approval can be dealt with against the saved box
      // rather than firing connect against a still-empty field.
      await refreshTvIps();
      connectAndroidTv();   // fire-and-forget; updates the panel status
    } else {
      renderAndroidTvPanel();   // hides the TV panel
      renderDeviceStream();
    }
    refreshPlaybackMoveButton();
    refreshPlayGate();
    return;
  }
  // Leaving a device/androidtv target → close exposure (transient) and hide
  // the QR / TV panel. Re-binding to loopback re-spawns the engine, so block
  // with the overlay the same way the expose path does.
  const wasOffBox = deviceTargetSelected || androidtvTargetSelected;
  if (wasOffBox) {
    deviceTargetSelected = false;
    androidtvTargetSelected = false;
    hideDeviceStream();
    renderAndroidTvPanel();   // hides the TV panel
    showBusy('Restarting engine to close network access…');
    try {
      const s = await api('/api/engine/lan-expose', {
        method: 'POST', body: JSON.stringify({ enabled: false }),
      });
      renderEngineLanToggle(s);
    } catch (_) {
      /* best-effort; the status poll reconciles the toggle state */
    } finally {
      hideBusy();
    }
  }
  lastNonDeviceTarget = value;
  refreshPlayGate();     // re-enable Play + restore buffer
  // Await so cfg reflects the new target before we (maybe) play below.
  await persistPlaybackTarget(value);
  // Coming off an off-box target with a stream selected → start it on the
  // newly chosen target (This tab, VLC/mpv, …). Off-box mode wasn't playing
  // here, so the user expects it to resume locally now. Plain target
  // switches keep the old behaviour: no auto-play.
  if (wasOffBox && current && current.cid) {
    $('cid-input').value = current.cid;
    refreshClearButton();
    showBusy('Starting…');
    try { await play({ name: current.name, sub: current.altName }); }
    finally { hideBusy(); }
  }
}

// Gates the Play button on the latest engine status. Separated from the
// poll so other code paths (e.g. just-started engine) can re-evaluate
// immediately without waiting for the next tick.
function refreshPlayGate() {
  const btn = $('play-btn');
  const hint = $('play-hint');
  const bufferField = $('buffer-field');
  // "Another device" target: nothing plays (or buffers) locally — the
  // device's own player opens the link/QR below. Disable Play with a
  // reason, and hide the local buffer control.
  if (deviceTargetSelected) {
    if (bufferField) bufferField.style.display = 'none';
    btn.disabled = true;
    hint.textContent =
      'Playing on another device — open the link or scan the QR below on '
      + 'that device. Or pick another player to play here.';
    hint.className = 'gate-hint';
    return;
  }
  // "Android TV (VLC)" target: no LOCAL playback or buffer (the box's VLC
  // buffers), but Play IS active — pressing it casts to the TV. Leave the
  // engine gate (describePlayButtonGate below) to disable Play when the
  // engine isn't ready; only override the hint/buffer here when it's fine.
  if (androidtvTargetSelected) {
    if (bufferField) bufferField.style.display = 'none';
    const view = describePlayButtonGate(engineState.last);
    btn.disabled = view.disabled;
    hint.textContent = view.disabled ? view.hint.text
      : 'Press Play to cast to the Android TV (VLC opens on the box).';
    hint.className = view.disabled ? view.hint.className : 'gate-hint';
    return;
  }
  if (bufferField) bufferField.style.display = '';
  const view = describePlayButtonGate(engineState.last);
  btn.disabled = view.disabled;
  hint.textContent = view.hint.text;
  hint.className = view.hint.className;
}

export async function toggleEngine() {
  const btn = $('engine-toggle');
  const action = btn.dataset.action || 'start';
  pendingEngineAction = true;
  btn.disabled = true;
  btn.textContent = action === 'start' ? 'Starting…' : 'Stopping…';
  showError('');
  try {
    await api('/api/engine/' + action, { method: 'POST' });
  } catch (e) {
    showError(e.message);
  } finally {
    pendingEngineAction = false;
    refreshEngineStatus();
  }
}

export async function saveAutostart() {
  const checked = $('autostart').checked;
  try {
    const next = await api('/api/config', {
      method: 'POST', body: JSON.stringify({ engine_autostart: checked }),
    });
    cfg = next;
  } catch (e) {
    showError(e.message);
    $('autostart').checked = !checked; // revert UI on failure
  }
}

