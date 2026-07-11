// Probing domain — the ⚕ Probe panel on the Library card.
//
// The ⚕ button opens a panel (no Save — it's all actions/live toggles). Its
// mental model is two questions: WHAT to check and WHETHER to keep checking.
//   * Scope switch — Visible page · Favourites · Search results · History ·
//     Everything (the last = favourites + search + history together). The Probe
//     button runs the selected scope once.
//   * "Keep updated" — a single toggle that re-runs the selected scope whenever
//     its list changes (for a search, as you stop typing). This one toggle
//     replaced the old pair of continuous checkboxes: "search as you type" is
//     just Search + Keep updated; "probe everything, always" is Everything +
//     Keep updated.
// While a run is going the Probe button turns into a Stop button, so an
// on-demand run can be cancelled without waiting it out; when it finishes it
// leaves a one-line summary (including "everything was already fresh"). Runs
// never stack — a new one supersedes the last, and the freshness window keeps a
// big scope (Everything) from becoming a big probe.
//
// A run health-checks each channel and paints a marker (checking → healthy /
// slow / unplayable / dead / unreachable). Rules learnt the hard way against
// the real engine:
//   * distinct pid per probe (server-side), so probing is harmless to playback;
//   * NEVER probe the channel you're watching — a probe's teardown stalls that
//     shared engine download. We skip it (and only when something is genuinely
//     live: livePlaybackTarget, which covers external VLC/mpv too);
//   * bounded concurrency — a live ramp test crashed the gateway around 48
//     concurrent sessions, so the agent pool is small (1–8, default 2).
//
// Verdicts are cached per cid AND persisted server-side (one cid-keyed table for
// every tab), so markers survive a reload and a cid re-probed anywhere overrides
// its verdict everywhere. A recent verdict (freshness window, default 5 min) is
// reused without re-probing. The pure state→badge mapping lives in
// lib/probe_view.js; freshness/relative-time in lib/probe_freshness.js.

import { $, showConfirm, showError } from '../../shared/dom.js';
import { showNotice, dismissNotice } from '../../shared/notice.js';
import { api } from '../../shared/api.js';
import { current, livePlaybackTarget } from '../playback/index.js';
import { favouriteItems, loadFavs } from '../favourites/index.js';
import { historyItems, loadHistory } from '../history/index.js';
import { searchResultItems } from '../search/index.js';
import {
  deepProbe, setDeepProbe, probeAgents, setProbeAgents,
  probeFreshnessMins, setProbeFreshnessMins, probeScope, setProbeScope,
  keepUpdated, setKeepUpdated,
  freshnessUnit, setFreshnessUnit, freshnessInUnit, freshnessUnitToMins,
  FRESHNESS_UNIT_MAX, resetProbeDefaults,
} from '../../lib/library_settings.js';
import { probeView } from './lib/probe_view.js';
import { isFresh, checkedAgo } from './lib/probe_freshness.js';

// Active library tab → its list container, and the set we repaint markers into.
const CONTAINER_BY_TAB = {
  search: 'search-results',
  favourites: 'fav-list',
  history: 'history-list',
};

// cid → { state, detail, probedAt } for the last known verdict. Drives the
// repaint of re-rendered rows and the client-side freshness skip.
const results = new Map();

// Monotonic run token. Bumped to supersede an in-flight run (a newer scope /
// keep-updated retrigger); workers bail once their gen is stale.
let runGen = 0;
let _probing = false;
// Set when the user hits Stop, so the completion summary reads "Stopped" rather
// than "Done". Distinct from a supersede (which bumps runGen without stopping).
let _stopped = false;
// Items queued to run once the current run finishes — the supersede path
// (keep-updated retriggering while a run is mid-flight). Holds the LATEST.
let _pendingRun = null;
// Whether "Keep updated" is armed — auto re-probe the selected scope when its
// list changes.
let _keepArmed = false;

function activeListContainer() {
  const tab = document.querySelector('.library-tab.active');
  const id = tab && CONTAINER_BY_TAB[tab.dataset.tab];
  return id ? $(id) : null;
}

// A cid may show in more than one tab; find whichever row (if any) is rendered.
// cids are 40 hex, safe in an attribute selector.
function findRenderedRow(cid) {
  for (const id of Object.values(CONTAINER_BY_TAB)) {
    const el = $(id);
    const row = el && el.querySelector('.fav[data-cid="' + cid + '"]');
    if (row) return row;
  }
  return null;
}

// Create/update the leading status badge on a `.fav` row, with the verdict's
// tooltip plus "checked N ago" when we know when it was probed.
function paintMarker(row, state, detail, probedAt) {
  let badge = row.querySelector(':scope > .probe-badge');
  if (!badge) {
    badge = document.createElement('span');
    row.prepend(badge);
  }
  const v = probeView(state, detail);
  badge.className = 'probe-badge ' + v.cls;
  badge.textContent = v.glyph;
  const ago = probedAt ? checkedAgo(probedAt) : '';
  badge.title = ago ? v.title + ' · ' + ago : v.title;
  badge.setAttribute('aria-label', 'Health: ' + v.label);
}

function recordResult(cid, state, detail, probedAt) {
  results.set(cid, { state, detail: detail || {}, probedAt: probedAt || null });
}

// Reapply cached markers to rows in `container` that don't have one yet.
function repaintFromCache(container) {
  container.querySelectorAll('.fav[data-cid]').forEach((row) => {
    if (row.querySelector(':scope > .probe-badge')) return;
    const cached = results.get(row.dataset.cid);
    if (cached) paintMarker(row, cached.state, cached.detail, cached.probedAt);
  });
}

function setStatus(msg) {
  const el = $('probe-status');
  if (el) el.textContent = msg;
}

// Reflect current state on the Probe button. While a run is in progress the
// button becomes a Stop control (so on-demand runs can be cancelled without
// waiting them out); otherwise it's the Probe control. Status text is owned by
// the run loop / completion summary, so this never clears it.
function updateProbeControls() {
  const btn = $('probe-run');
  if (!btn) return;
  btn.disabled = false;
  if (_probing) {
    btn.textContent = 'Stop';
    btn.classList.add('danger-outline');
    btn.classList.remove('primary');
    btn.onclick = stopRun;
    btn.title = 'Stop the current probe run';
  } else {
    btn.textContent = 'Probe';
    btn.classList.add('primary');
    btn.classList.remove('danger-outline');
    btn.onclick = runSelectedScope;
    btn.title = 'Run a health check over the selected scope';
  }
}

// Cancel the in-flight run: bump the generation so workers bail on their next
// turn, and drop any queued supersede. The finally in startRun then paints the
// "Stopped" summary. Any request already awaiting completes but its result is
// discarded by the gen check.
function stopRun() {
  if (!_probing) return;
  _stopped = true;
  _pendingRun = null;
  runGen++;
}

// Build the end-of-run status. The all-cached case is called out explicitly so
// a run that skipped everything still tells the user it looked at everything.
function runSummary(total, probed, skippedFresh, skippedPlaying) {
  if (_stopped) return `Stopped — probed ${probed} of ${total}.`;
  const skipped = skippedFresh + skippedPlaying;
  if (total && probed === 0 && skipped === total) {
    return skippedPlaying && !skippedFresh
      ? 'Nothing to probe — that channel is playing now.'
      : `All ${total} already checked recently — nothing to re-probe.`;
  }
  const bits = [];
  if (skippedFresh) bits.push(`${skippedFresh} still fresh`);
  if (skippedPlaying) bits.push(`${skippedPlaying} playing now`);
  const tail = bits.length ? ` (skipped ${bits.join(', ')})` : '';
  return `Done — probed ${probed} of ${total}${tail}.`;
}

function dedup(items) {
  const byCid = new Map();
  for (const it of items) {
    if (it && it.cid && !byCid.has(it.cid)) byCid.set(it.cid, it.name || '');
  }
  return byCid;
}

// Entry point for every run. If one's already going, supersede it (queue the
// latest) — this is how a continuous retrigger replaces an in-flight run.
function runProbe(items) {
  const byCid = dedup(items);
  if (_probing) {
    _pendingRun = byCid.size ? byCid : null;
    runGen++;                 // signal the current run's workers to stop
    return;
  }
  return startRun(byCid);
}

async function startRun(byCid) {
  if (!byCid || !byCid.size) return;
  _probing = true;
  _stopped = false;
  const gen = ++runGen;
  updateProbeControls();

  const deep = deepProbe();
  const agents = probeAgents();
  const freshSecs = probeFreshnessMins() * 60;
  // Skip the genuinely-playing channel (see header). livePlaybackTarget is the
  // real-liveness flag; current.cid alone is stale (survives reload / a stream
  // that never delivered a byte).
  const playingCid = (livePlaybackTarget && current && current.cid) ? current.cid : '';

  const queue = Array.from(byCid.entries());   // [cid, name]
  const total = queue.length;
  let done = 0;
  // Outcome tallies for the completion summary (see runSummary).
  let probed = 0, skippedFresh = 0, skippedPlaying = 0;
  setStatus(`Probing 0 of ${total}…`);

  const worker = async () => {
    for (;;) {
      if (gen !== runGen) return;
      const next = queue.shift();
      if (!next) return;
      const [cid, itemName] = next;
      done += 1;
      setStatus(`Probing ${done} of ${total}…`);

      if (cid === playingCid) {
        skippedPlaying += 1;
        const r = findRenderedRow(cid);
        if (r) paintMarker(r, 'playing');
        continue;
      }
      // Client-side freshness skip: a recent cached verdict is left as-is, no
      // request. (The server also enforces max_age_secs as a backstop for cids
      // the client cache doesn't know yet.)
      const cached = results.get(cid);
      if (freshSecs > 0 && cached && isFresh(cached.probedAt, freshSecs)) {
        skippedFresh += 1;
        const r = findRenderedRow(cid);
        if (r) paintMarker(r, cached.state, cached.detail, cached.probedAt);
        continue;
      }
      probed += 1;
      const row = findRenderedRow(cid);
      if (row) paintMarker(row, 'checking');
      const name = itemName
        || (row && (row.querySelector('.fav-name')?.textContent || '').trim())
        || '';
      let res;
      try {
        res = await api('/api/stream/probe', {
          method: 'POST',
          body: JSON.stringify({ cid, deep, name, max_age_secs: freshSecs }),
        });
      } catch (_) {
        res = { state: 'unreachable', detail: {} };   // 503 / network
      }
      if (gen !== runGen) return;
      recordResult(cid, res.state, res.detail, res.probed_at);
      const liveRow = findRenderedRow(cid);
      if (liveRow) paintMarker(liveRow, res.state, res.detail, res.probed_at);
    }
  };

  try {
    await Promise.all(
      Array.from({ length: Math.min(agents, total) }, () => worker()));
  } finally {
    _probing = false;
    const next = _pendingRun;
    _pendingRun = null;
    if (next && next.size) {
      startRun(next);            // run the queued supersede
    } else {
      updateProbeControls();
      setStatus(runSummary(total, probed, skippedFresh, skippedPlaying));
    }
  }
}

// ---- scopes -------------------------------------------------------------
const SCOPE_LABELS = {
  page: 'visible page', favourites: 'favourites', search: 'search results',
  history: 'history', everything: 'everything',
};

// The channels the active tab currently shows (the "visible page" scope).
function visiblePageItems() {
  const container = activeListContainer();
  if (!container) return [];
  return Array.from(container.querySelectorAll('.fav[data-cid]')).map(row => ({
    cid: row.dataset.cid,
    name: (row.querySelector('.fav-name')?.textContent || '').trim(),
  }));
}

// The item set for a scope, read from what's already in memory (loading is the
// caller's job via ensureScopeData). 'everything' is the deduped union — dedup
// happens in runProbe, and freshness-skip keeps a big scope cheap.
function scopeItems(scope) {
  switch (scope) {
    case 'favourites': return favouriteItems();
    case 'search':     return searchResultItems();
    case 'history':    return historyItems();
    case 'everything': return [...favouriteItems(), ...historyItems(), ...searchResultItems()];
    default:           return visiblePageItems();
  }
}

// Favourites / history are lazy-loaded per tab; make sure the scope's data is in
// memory before we read it, so "Favourites"/"Everything" cover pages the user
// hasn't opened this session.
async function ensureScopeData(scope) {
  if ((scope === 'favourites' || scope === 'everything') && !favouriteItems().length) await loadFavs();
  if ((scope === 'history' || scope === 'everything') && !historyItems().length) await loadHistory();
}

// The Probe button: run the selected scope once.
async function runSelectedScope() {
  const scope = probeScope();
  await ensureScopeData(scope);
  runProbe(scopeItems(scope));
}

// ---- keep updated (one toggle, applies to the selected scope) ----------
// A dismissible top notice appears while it's armed, with a one-click Stop — so
// it can be turned off WITHOUT opening the panel (the UX gap otherwise).
function showKeepNotice() {
  const scope = probeScope();
  showNotice({
    id: 'probe-keep',
    message: '⚕ Keeping ' + (SCOPE_LABELS[scope] || scope) + ' up to date.',
    actionLabel: 'Stop',
    onAction: () => { setKeepUpdated(false); armKeepUpdated(false); syncKeepCheckbox(); },
  });
}

function syncKeepCheckbox() {
  const cb = $('probe-keep-updated');
  if (cb) cb.checked = keepUpdated();
}

async function armKeepUpdated(on) {
  _keepArmed = on;
  if (on) {
    await ensureScopeData(probeScope());
    if (!_keepArmed) return;        // toggled back off while awaiting
    const items = scopeItems(probeScope());
    if (items.length) { runProbe(items); showKeepNotice(); }
  } else {
    dismissNotice('probe-keep');
    if (!_probing) setStatus('');
  }
}

// Fired by any list-container MutationObserver. When armed, re-probe the
// selected scope; if the scope is now empty (e.g. the search box was cleared),
// cancel the run and drop the notice.
function onListMutated() {
  if (!_keepArmed) return;
  const items = scopeItems(probeScope());
  if (items.length) { runProbe(items); showKeepNotice(); }
  else { runGen++; dismissNotice('probe-keep'); if (!_probing) setStatus(''); }
}

// ---- can't-play log (moved here — it's a probe artifact) ---------------
async function refreshUnplayableCount() {
  const el = $('unplayable-count');
  if (!el) return;
  el.textContent = '';
  try {
    const rows = await api('/api/unplayable');
    const n = Array.isArray(rows) ? rows.length : 0;
    el.textContent = n ? `${n} channel${n === 1 ? '' : 's'} logged` : 'none logged yet';
  } catch (_) { /* leave blank */ }
}

function exportUnplayable() {
  const a = document.createElement('a');
  a.href = '/api/unplayable/export';
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function clearUnplayable() {
  if (!(await showConfirm({
    title: 'Clear can’t-play list',
    message: 'Remove all logged unplayable channels? This only clears the '
           + 'diagnostic log — it does not change your favourites or history.',
    confirmText: 'Clear',
    danger: true,
  }))) return;
  try {
    await api('/api/unplayable', { method: 'DELETE' });
  } catch (e) {
    showError('Could not clear the list: ' + e.message);
  }
  refreshUnplayableCount();
}

// Reset every stored verdict — the whole probe cache. Wipes the server table and
// the in-memory map, and strips the painted markers off every rendered row.
async function clearProbeCache() {
  if (!(await showConfirm({
    title: 'Clear probe cache',
    message: 'This resets the health status of EVERY channel — all green / '
           + 'amber / red markers are removed everywhere, and the next probe '
           + 're-checks from scratch. Your favourites, history and the can’t-play '
           + 'log are not touched.',
    confirmText: 'Clear cache',
    danger: true,
  }))) return;
  try {
    await api('/api/probe-status', { method: 'DELETE' });
  } catch (e) {
    showError('Could not clear the probe cache: ' + e.message);
    return;
  }
  results.clear();
  for (const id of Object.values(CONTAINER_BY_TAB)) {
    const el = $(id);
    if (el) el.querySelectorAll('.fav > .probe-badge').forEach(b => b.remove());
  }
  runGen++;               // supersede any in-flight run painting stale markers
  setStatus('Probe cache cleared.');
}

// ---- panel open/close --------------------------------------------------
// Reflect every persisted probe setting into its control. Shared by panel-open
// and Reset-to-defaults (which resets the keys, then re-reads them here).
function reflectProbeSettings() {
  const scope = probeScope();
  const radio = document.querySelector('input[name="probe-scope"][value="' + scope + '"]');
  if (radio) radio.checked = true;
  syncKeepCheckbox();
  const deep = $('probe-deep'); if (deep) deep.checked = deepProbe();
  const ag = $('probe-agents'); if (ag) ag.value = String(probeAgents());
  syncFreshnessField();
  updateProbeControls();
}

export function openProbePanel() {
  reflectProbeSettings();
  refreshUnplayableCount();
  const modal = $('probe-modal');
  if (modal) modal.style.display = 'flex';
}

// Restore the panel's settings (scope, keep-updated, deep, agents, freshness) to
// their defaults. Leaves the probe cache / verdicts alone — that's "Clear probe
// cache". Re-arms keep-updated for the (now default) scope so live state matches.
async function resetProbeSettings() {
  if (!(await showConfirm({
    title: 'Reset probe settings',
    message: 'Restore the probe panel’s settings — scope, keep-updated, deep '
           + 'check, agents and freshness — to their defaults? This does not '
           + 'clear the probe cache or touch your favourites, history or the '
           + 'can’t-play log.',
    confirmText: 'Reset',
    danger: true,
  }))) return;
  resetProbeDefaults();
  reflectProbeSettings();
  armKeepUpdated(keepUpdated());   // scope + keep-updated may have changed
  setStatus('Probe settings reset to defaults.');
}

// Reflect the freshness value + unit into the field: the number shows the
// canonical minutes converted into the chosen unit, and the input's max tracks
// the unit so the stepper clamps sensibly.
function syncFreshnessField() {
  const unit = freshnessUnit();
  const sel = $('probe-freshness-unit');
  if (sel) sel.value = unit;
  const input = $('probe-freshness');
  if (input) {
    input.max = String(FRESHNESS_UNIT_MAX[unit]);
    input.value = String(freshnessInUnit(probeFreshnessMins(), unit));
  }
}

// Persist the freshness field: read the number in the current unit, store as
// canonical minutes, then re-render (clamped) in the same unit.
function commitFreshness() {
  const input = $('probe-freshness');
  if (!input) return;
  const unit = freshnessUnit();
  setProbeFreshnessMins(freshnessUnitToMins(input.value, unit));
  input.value = String(freshnessInUnit(probeFreshnessMins(), unit));
}

export function closeProbePanel() {
  const modal = $('probe-modal');
  if (modal) modal.style.display = 'none';
}

function onScopeChange(value) {
  setProbeScope(value);
  updateProbeControls();
  // If "Keep updated" is on, re-point it at the newly-selected scope (updates
  // the notice text and probes the new scope right away).
  if (_keepArmed) armKeepUpdated(true);
}

// Themed ▲/▼ stepper wiring shared by the Agents + freshness number fields
// (mirrors the page-size stepper). Clamps to the input's min/max and persists.
function wireStepper(inputId, upId, downId, commit) {
  const input = $(inputId);
  const step = (delta) => {
    if (!input) return;
    const min = Number(input.min);
    const max = Number(input.max);
    let v = (Number(input.value) || min || 0) + delta;
    if (Number.isFinite(min)) v = Math.max(min, v);
    if (Number.isFinite(max)) v = Math.min(max, v);
    input.value = String(v);
    commit(input.value);
  };
  const up = $(upId); if (up) up.onclick = () => step(1);
  const down = $(downId); if (down) down.onclick = () => step(-1);
  if (input) input.onchange = () => commit(input.value);
}

// Seed the cache from the server's persisted verdicts so markers survive a
// reload and appear wherever a cid shows up. One cid-keyed table for every tab.
async function seedFromServer() {
  let rows;
  try { rows = await api('/api/probe-status'); } catch (_) { return; }
  if (!Array.isArray(rows)) return;
  for (const r of rows) {
    if (r && r.cid && r.state) recordResult(r.cid, r.state, r.detail, r.probed_at);
  }
  for (const id of Object.values(CONTAINER_BY_TAB)) {
    const el = $(id);
    if (el) repaintFromCache(el);
  }
}

export function initProbing() {
  const open = $('library-probe');
  if (open) open.onclick = openProbePanel;

  updateProbeControls();   // sets the Probe/Stop button's label + handler
  const closeBtn = $('probe-close');
  if (closeBtn) closeBtn.onclick = closeProbePanel;
  const modal = $('probe-modal');
  if (modal) modal.onclick = e => { if (e.target === modal) closeProbePanel(); };

  document.querySelectorAll('input[name="probe-scope"]').forEach(r => {
    r.onchange = () => onScopeChange(r.value);
  });
  const keep = $('probe-keep-updated');
  if (keep) keep.onchange = () => { setKeepUpdated(keep.checked); armKeepUpdated(keep.checked); };
  const deep = $('probe-deep');
  if (deep) deep.onchange = () => setDeepProbe(deep.checked);
  wireStepper('probe-agents', 'probe-agents-up', 'probe-agents-down',
    () => { const a = $('probe-agents'); setProbeAgents(a.value); a.value = String(probeAgents()); });
  wireStepper('probe-freshness', 'probe-freshness-up', 'probe-freshness-down',
    () => commitFreshness());
  const unitSel = $('probe-freshness-unit');
  if (unitSel) unitSel.onchange = () => { setFreshnessUnit(unitSel.value); syncFreshnessField(); };
  const reset = $('probe-reset');
  if (reset) reset.onclick = resetProbeSettings;
  const cacheClr = $('probe-cache-clear');
  if (cacheClr) cacheClr.onclick = clearProbeCache;
  const exp = $('unplayable-export');
  if (exp) exp.onclick = exportUnplayable;
  const clr = $('unplayable-clear');
  if (clr) clr.onclick = clearUnplayable;

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && $('probe-modal') && $('probe-modal').style.display === 'flex') {
      closeProbePanel();
    }
  });

  for (const id of Object.values(CONTAINER_BY_TAB)) {
    const el = $(id);
    if (!el) continue;
    new MutationObserver(() => {
      repaintFromCache(el);
      onListMutated();
    }).observe(el, { childList: true });
  }

  // "Keep updated" is on by default — arm it so the visible page (default scope)
  // stays fresh, which on the Search tab means results are probed as you type.
  armKeepUpdated(keepUpdated());
  seedFromServer();
}
