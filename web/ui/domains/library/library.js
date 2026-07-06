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

import { $ } from '../../shared/dom.js';
import { ICONS } from '../../shared/icons.js';
import { KEYS } from '../../lib/storage_keys.js';
import { pageSize, setPageSize, removeFromHistoryOnSave, setRemoveFromHistoryOnSave } from '../../lib/library_settings.js';
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

// ---- ⚙ settings modal --------------------------------------------------
export function openLibrarySettings() {
  const cb = $('setting-remove-on-save');
  const ps = $('setting-page-size');
  if (cb) cb.checked = removeFromHistoryOnSave();
  if (ps) ps.value = String(pageSize());
  const modal = $('library-settings-modal');
  if (modal) modal.style.display = 'flex';
}

export function closeLibrarySettings() {
  const modal = $('library-settings-modal');
  if (modal) modal.style.display = 'none';
}

export function saveLibrarySettings() {
  const cb = $('setting-remove-on-save');
  const ps = $('setting-page-size');
  if (cb) setRemoveFromHistoryOnSave(cb.checked);
  if (ps) setPageSize(ps.value);
  closeLibrarySettings();
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
  const up = $('setting-page-size-up');
  const down = $('setting-page-size-down');
  if (up) up.onclick = () => stepPageSize(1);
  if (down) down.onclick = () => stepPageSize(-1);
  let stored = '';
  try { stored = localStorage.getItem(KEYS.LIBRARY_TAB) || ''; } catch (_) { /* private mode */ }
  showTab(normalizeTab(stored));
}
