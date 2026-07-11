// Library domain — the tabbed browse card that combines Search, History,
// and Favourites into one switchable surface below the Watch card.
//
// The card-label reads "Library"; one segmented control of three icon
// toggles (🔍 search, ★ favourites, 📖 history) picks the active panel,
// the active toggle glowing mustard. The last-open tab is remembered
// across sessions via localStorage (KEYS.LIBRARY_TAB).
//
// This domain owns only the tab shell + persistence. Each panel's content
// is rendered by its own domain, refreshed lazily when its tab activates:
// search (focus its box), history (loadHistory), favourites (loadFavs).
//
// The pure tab normaliser lives in lib/active_tab.js and is unit-tested.

import { $, showConfirm } from '../../shared/dom.js';
import { api } from '../../shared/api.js';
import { ICONS } from '../../shared/icons.js';
import { KEYS } from '../../lib/storage_keys.js';
import {
  pageSize, setPageSize, removeFromHistoryOnSave, setRemoveFromHistoryOnSave,
  resetLibraryDefaults,
  favSort, setFavSort,
  libraryDefaultTab, setLibraryDefaultTab,
  relativeTimes, setRelativeTimes, skipDeleteConfirm, setSkipDeleteConfirm,
} from '../../lib/library_settings.js';
import { LIBRARY_TABS, normalizeTab } from './lib/active_tab.js';
import { loadFavs, setFavSearch } from '../favourites/index.js';
import { loadHistory } from '../history/index.js';
import { refreshSearchResultsIfAny } from '../search/index.js';

let activeTab = LIBRARY_TABS[0];

export function showTab(id) {
  activeTab = normalizeTab(id);
  for (const t of LIBRARY_TABS) {
    const panel = $('tab-' + t);
    if (panel) panel.style.display = (t === activeTab) ? '' : 'none';
  }
  document.querySelectorAll('.library-tab').forEach(btn => {
    const on = btn.dataset.tab === activeTab;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  try { localStorage.setItem(KEYS.LIBRARY_TAB, activeTab); } catch (_) { /* private mode */ }

  // Lazily (re)load the panel we just revealed.
  if (activeTab === 'favourites') loadFavs();
  else if (activeTab === 'history') loadHistory();
  else if (activeTab === 'search') { const el = $('search-input'); if (el) el.focus(); }
}

// Jump to the Favourites tab and filter it to `name`. Used by the
// "Saved as: …" badge on search / history rows (double-click).
export function openFavourite(name) {
  showTab('favourites');
  const box = $('fav-search');
  if (box) box.value = name || '';
  const clear = $('fav-search-clear');
  if (clear) clear.style.visibility = name ? 'visible' : 'hidden';
  setFavSearch(name || '');
}

// Indicator shown wherever a channel is already saved: the favourite's
// "<name> ★" in mustard (a plain glyph, not a button). The tooltip carries
// the full context; double-click opens it in the Favourites tab. Shared by
// the search + history rows and the Watch card's save control.
export function buildSavedBadge(favName) {
  const badge = document.createElement('div');
  badge.className = 'saved-badge';
  badge.title = 'Saved as: ' + favName + '\nDouble click to open in Favourites';

  const nameEl = document.createElement('span');
  nameEl.className = 'saved-badge-name';
  nameEl.textContent = favName;

  const star = document.createElement('span');
  star.className = 'saved-badge-star';
  star.innerHTML = ICONS.star;

  badge.appendChild(nameEl);
  badge.appendChild(star);
  badge.ondblclick = e => { e.stopPropagation(); openFavourite(favName); };
  return badge;
}

// Re-render whichever panel is currently showing (after a settings change
// such as page size).
function refreshActiveTab() {
  if (activeTab === 'favourites') loadFavs();
  else if (activeTab === 'history') loadHistory();
  else refreshSearchResultsIfAny();
}

// ---- ⚙ settings modal (immediate-apply, no Save) -----------------------
// Watch-history cap bounds — mirror the modal's min/max and the server's
// history_max_rows default (500).
const HISTORY_CAP_MIN = 50;
const HISTORY_CAP_MAX = 5000;
const HISTORY_CAP_DEFAULT = 500;

function clampHistoryCap(raw, def = HISTORY_CAP_DEFAULT) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(n, HISTORY_CAP_MIN), HISTORY_CAP_MAX);
}

// The two watch-history controls (#record + cap) are server-backed
// (config.json), unlike the localStorage-backed rest. Reflect the live values
// on open (async — fills in once /api/config resolves).
async function reflectHistoryConfig() {
  let cfg;
  try { cfg = await api('/api/config'); } catch (_) { return; }
  if (!cfg || typeof cfg !== 'object') return;
  const rec = $('setting-record-history');
  if (rec) rec.checked = cfg.history_recording !== false;   // default on
  const cap = $('setting-history-cap');
  if (cap) cap.value = String(clampHistoryCap(cfg.history_max_rows));
}

// Clamp the cap field, reflect it, and persist to the server config.
function commitHistoryCap() {
  const cap = $('setting-history-cap');
  if (!cap) return;
  const n = clampHistoryCap(cap.value);
  cap.value = String(n);
  api('/api/config', { method: 'POST', body: JSON.stringify({ history_max_rows: n }) }).catch(() => {});
}

// Themed ▲/▼ stepper for the cap field (native spinner is un-themable).
function stepHistoryCap(delta) {
  const cap = $('setting-history-cap');
  if (!cap) return;
  const step = Number(cap.step) || 1;
  cap.value = String((Number(cap.value) || 0) + delta * step);
  commitHistoryCap();       // clamps + persists
}

export function openLibrarySettings() {
  const cb = $('setting-remove-on-save');
  const ps = $('setting-page-size');
  if (cb) cb.checked = removeFromHistoryOnSave();
  if (ps) ps.value = String(pageSize());
  const fs = $('setting-fav-sort'); if (fs) fs.value = favSort();
  const dt = $('setting-default-tab'); if (dt) dt.value = libraryDefaultTab();
  const rt = $('setting-relative-times'); if (rt) rt.checked = relativeTimes();
  const sd = $('setting-skip-delete-confirm'); if (sd) sd.checked = skipDeleteConfirm();
  reflectHistoryConfig();
  const modal = $('library-settings-modal');
  if (modal) modal.style.display = 'flex';
}

export function closeLibrarySettings() {
  const modal = $('library-settings-modal');
  if (modal) modal.style.display = 'none';
}

// Persist the page-size field and re-render the active tab. Called on every
// edit (typing + ▲/▼ steppers) — there's nothing to "save".
function applyPageSize() {
  const ps = $('setting-page-size');
  if (ps) { setPageSize(ps.value); ps.value = String(pageSize()); }
  refreshActiveTab();
}

export async function resetLibrarySettings() {
  if (!(await showConfirm({
    title: 'Reset to defaults',
    message: 'Restore all Library and probe settings to their defaults? '
           + 'This does not touch your favourites, history, or the can’t-play log.',
    confirmText: 'Reset',
    danger: true,
  }))) return;
  resetLibraryDefaults();
  // The watch-history controls live server-side; reset them there too.
  await api('/api/config', {
    method: 'POST',
    body: JSON.stringify({ history_recording: true, history_max_rows: HISTORY_CAP_DEFAULT }),
  }).catch(() => {});
  openLibrarySettings();   // reflect the restored values (re-reads server config)
  refreshActiveTab();
}

// Step the themed number field by ±1, clamped to its min/max. Used by
// the custom ▲/▼ buttons that replace the native (un-themable) spinner.
function stepPageSize(delta) {
  const input = $('setting-page-size');
  if (!input) return;
  const min = Number(input.min) || 1;
  const max = Number(input.max) || Infinity;
  const cur = Number(input.value) || min;
  input.value = String(Math.min(max, Math.max(min, cur + delta)));
}

export function initLibrary() {
  document.querySelectorAll('.library-tab').forEach(btn => {
    btn.onclick = () => showTab(btn.dataset.tab);
  });
  // Settings apply immediately (no Save): steppers + typing persist page size,
  // the checkbox persists on toggle.
  const up = $('setting-page-size-up');
  const down = $('setting-page-size-down');
  if (up) up.onclick = () => { stepPageSize(1); applyPageSize(); };
  if (down) down.onclick = () => { stepPageSize(-1); applyPageSize(); };
  const ps = $('setting-page-size');
  if (ps) ps.onchange = applyPageSize;
  const rem = $('setting-remove-on-save');
  if (rem) rem.onchange = () => setRemoveFromHistoryOnSave(rem.checked);

  // Browse ordering / display — persist on change, then re-render the panel so
  // the new order/format shows immediately.
  const fs = $('setting-fav-sort');
  if (fs) fs.onchange = () => { setFavSort(fs.value); refreshActiveTab(); };
  const dt = $('setting-default-tab');
  if (dt) dt.onchange = () => setLibraryDefaultTab(dt.value);
  const rt = $('setting-relative-times');
  if (rt) rt.onchange = () => { setRelativeTimes(rt.checked); refreshActiveTab(); };
  const sd = $('setting-skip-delete-confirm');
  if (sd) sd.onchange = () => setSkipDeleteConfirm(sd.checked);

  // Watch-history controls are server-backed (config.json) — POST the patch.
  const rec = $('setting-record-history');
  if (rec) rec.onchange = () => {
    api('/api/config', { method: 'POST', body: JSON.stringify({ history_recording: rec.checked }) }).catch(() => {});
  };
  const cap = $('setting-history-cap');
  if (cap) cap.onchange = commitHistoryCap;
  const capUp = $('setting-history-cap-up');
  if (capUp) capUp.onclick = () => stepHistoryCap(1);
  const capDown = $('setting-history-cap-down');
  if (capDown) capDown.onclick = () => stepHistoryCap(-1);

  const reset = $('library-settings-reset');
  if (reset) reset.onclick = resetLibrarySettings;

  // Which tab to open on: 'last' honours the remembered tab; anything else pins.
  const def = libraryDefaultTab();
  let initial = def;
  if (def === 'last') {
    try { initial = localStorage.getItem(KEYS.LIBRARY_TAB) || ''; } catch (_) { /* private mode */ }
  }
  showTab(normalizeTab(initial));
}
