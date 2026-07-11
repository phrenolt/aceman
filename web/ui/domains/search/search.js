// Search domain. A dedicated search box (#search-input) queries
// /api/search (search-ace.stream), renders paginated results, and lets
// each result be played (prepopulates the Watch input + auto-plays) or
// saved as a favourite. It lives in the Search tab of the library card.
//
// The pure query logic (shouldSearch / normaliseQuery / buildSearchUrl)
// and pagination live in lib/ and are unit-tested; this module is the
// DOM wiring around them.
//
// Cross-module deps are forward imports: allFavs / instaSave /
// updateSaveButton + findFavouriteByCid (favourites), play + refreshClearButton
// (playback).

import { $, showError, showBusy, hideBusy } from '../../shared/dom.js';
import { api } from '../../shared/api.js';
import { debounce } from './lib/debounce.js';
import { paginate } from '../../lib/pagination.js';
import { shouldSearch, normaliseQuery, buildSearchUrl } from './lib/search_query.js';
import { findFavouriteByCid } from '../favourites/index.js';
import { allFavs, instaSave, updateSaveButton } from '../favourites/index.js';
import { play, refreshClearButton, notifyIfAlreadyPlaying } from '../playback/index.js';
import { buildSavedBadge } from '../library/index.js';
import { setIcon } from '../../shared/icons.js';
import { pageSize } from '../../lib/library_settings.js';

let lastSearchQuery = '';
// Pagination of search results. Page size is the shared Library setting.
let allSearchResults = [];
let searchPage = 0;

// 600ms trailing-edge debounce — long enough that mid-word keystrokes don't
// fire a request, short enough to feel responsive after a pause.
export const onSearchInput = debounce(() => runSearch(), 600);

export async function runSearch() {
  const q = normaliseQuery($('search-input').value || '');
  lastSearchQuery = q;
  $('search-results').innerHTML = '';
  $('search-status').textContent = '';
  showError('');
  console.debug('[search] query', { len: q.length, query: q });
  if (!shouldSearch(q)) {
    console.debug('[search] skipped (too short)');
    return;
  }
  $('search-status').textContent = 'searching…';
  const t0 = performance.now();
  try {
    const data = await api(buildSearchUrl(q));
    if (q !== lastSearchQuery) {
      console.debug('[search] stale response, dropped', q);
      return;
    }
    const results = data.results || [];
    console.debug('[search] got', results.length, 'results in',
      Math.round(performance.now() - t0), 'ms');
    allSearchResults = results;
    searchPage = 0;
    renderSearchResults();
    $('search-status').textContent = results.length
      ? `${results.length} result${results.length === 1 ? '' : 's'}`
      : 'no matches';
  } catch (e) {
    if (q !== lastSearchQuery) return;
    console.warn('[search] failed:', e.message);
    $('search-status').textContent = '';
    showError('search failed: ' + e.message);
  }
}

// Re-render the visible results in place (e.g. after a favourites change
// flips a row's ★ saved-state). No-op when no search is active — keeps the
// allSearchResults buffer private to this module.
export function refreshSearchResultsIfAny() {
  if (allSearchResults.length) renderSearchResults();
}

// {cid, name} for the whole current result set (not just the visible page) —
// the probing domain's "Probe all search results" walks this. Bounded by what
// the current query returned; it does not re-run the search.
export function searchResultItems() {
  return allSearchResults.map(r => ({
    cid: r.cid, name: (r.name || r.translated_name || '').trim(),
  }));
}

// Init-facing pager handlers — keep searchPage private to this module.
export function searchPagePrev() { searchPage--; renderSearchResults(); }
export function searchPageNext() { searchPage++; renderSearchResults(); }

export function renderSearchResults() {
  const list = $('search-results');
  list.innerHTML = '';
  const size = pageSize();
  const p = paginate(allSearchResults.length, searchPage, size);
  searchPage = p.page;
  for (const r of p.slice(allSearchResults)) list.appendChild(renderSearchRow(r));
  const pager = $('search-pager');
  if (pager) {
    pager.style.display = allSearchResults.length > size ? '' : 'none';
    $('search-prev').disabled = !p.hasPrev;
    $('search-next').disabled = !p.hasNext;
    $('search-info').textContent = p.label();
  }
}

export function renderSearchRow(r) {
  const row = document.createElement('div');
  row.className = 'fav';
  row.dataset.cid = r.cid;   // lets the probing domain health-check this row

  const wrap = document.createElement('div');
  wrap.className = 'fav-name-wrap';

  // Original-language name is primary white text; English translation is the
  // muted sub-label. If the names are identical (English-only channel) the
  // sub-label is omitted and the cid preview is shown instead.
  const primary = (r.name || r.translated_name || '').trim();
  const alt = (r.translated_name && r.translated_name !== r.name)
    ? r.translated_name.trim() : '';

  const name = document.createElement('span');
  name.className = 'fav-name';
  name.textContent = primary;
  name.title = r.cid;

  const sub = document.createElement('span');
  sub.className = 'fav-last';
  sub.textContent = alt || (r.cid.slice(0, 8) + '…');

  wrap.appendChild(name);
  wrap.appendChild(sub);

  wrap.onclick = async () => {
    if (notifyIfAlreadyPlaying(r.cid)) return;   // re-click on the live row: no-op
    $('cid-input').value = r.cid;
    refreshClearButton();
    showBusy('Starting…');
    try { await play({ name: primary, altName: alt }); } finally { hideBusy(); }
  };

  row.oncontextmenu = e => {
    e.preventDefault();
    navigator.clipboard.writeText(r.cid).then(() => {
      const prev = row.style.opacity;
      row.style.opacity = '0.5';
      setTimeout(() => { row.style.opacity = prev; }, 350);
    }).catch(() => {});
  };

  row.appendChild(wrap);
  // Already saved → show the "Saved as: …" badge (double-click opens it in
  // Favourites). Otherwise a ★ button that saves it.
  const existing = findFavouriteByCid(allFavs, r.cid);
  if (existing) {
    row.appendChild(buildSavedBadge(existing.name));
  } else {
    const saveBtn = document.createElement('button');
    saveBtn.classList.add('icon-btn');
    setIcon(saveBtn, 'star');
    saveBtn.title = 'Add to favourites (pick a name: English, Original, or custom)';
    saveBtn.setAttribute('aria-label', 'Add to favourites');
    saveBtn.onclick = () => instaSave(r, saveBtn, primary);
    row.appendChild(saveBtn);
  }
  return row;
}

// Flip a just-clicked ★ save button into the "Saved as: …" badge in place
// (called by instaSave after a successful save). Replaces the button node.
export function markSearchRowSaved(btn, favName) {
  btn.replaceWith(buildSavedBadge(favName));
}
