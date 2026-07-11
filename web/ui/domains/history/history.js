// Watch-history domain. Renders the /api/history list into the History
// tab of the library card — each entry playable (prepopulates the Watch
// input + auto-plays), favouritable (★), or deletable (🗑), with its own
// search box + pager (mirroring favourites) and a Clear-all. Backed by
// sqlite via the server.
//
// The UTC→local timestamp formatting is pure and unit-tested in
// lib/sqlite_time.js; this module is the DOM wiring.
//
// Cross-module deps are forward imports: allFavs + instaSave +
// findFavouriteByCid (favourites), play + refreshClearButton (playback).

import { $, showBusy, hideBusy, showConfirm } from '../../shared/dom.js';
import { api } from '../../shared/api.js';
import { paginate } from '../../lib/pagination.js';
import { formatSqliteUtcToLocal } from './lib/sqlite_time.js';
import { daysSinceLabel } from '../favourites/lib/last_watched_label.js';
import { setIcon } from '../../shared/icons.js';
import { findFavouriteByCid } from '../favourites/index.js';
import { allFavs, instaSave } from '../favourites/index.js';
import { play, refreshClearButton, notifyIfAlreadyPlaying } from '../playback/index.js';
import { buildSavedBadge } from '../library/index.js';
import { pageSize, relativeTimes, skipDeleteConfirm } from '../../lib/library_settings.js';

// Convert a SQLite 'YYYY-MM-DD HH:MM:SS' UTC stamp to a local
// 'YYYY-MM-DD HH:MM' string using the browser's OS timezone.
// Thin wrapper over the pure formatter in lib/sqlite_time.js (tested there).
const sqliteUtcToLocal = formatSqliteUtcToLocal;

// In-memory cached list + filter/page state, same shape as favourites.
let allHistory = [];
let histSearch = '';
let histPage = 0;

// Fetch the full history and render it into the panel. Called when the
// History tab is activated (see the library domain).
// {cid, name} for every history entry (not just the visible page) — the
// probing domain's "Probe all history" walks this so off-page channels get a
// persisted verdict too.
export function historyItems() {
  return allHistory.map(h => ({ cid: h.cid, name: h.name }));
}

export async function loadHistory() {
  if (!$('history-list')) return;
  try { allHistory = await api('/api/history'); } catch { allHistory = []; }
  if (!Array.isArray(allHistory)) allHistory = [];
  histPage = 0;
  renderHistory();
}

function filteredHistory() {
  const q = histSearch.trim().toLowerCase();
  return q ? allHistory.filter(h => (h.name || '').toLowerCase().includes(q)) : allHistory;
}

function renderHistory() {
  const list = $('history-list');
  if (!list) return;
  const filtered = filteredHistory();          // server already returns newest-first
  const p = paginate(filtered.length, histPage, pageSize());
  histPage = p.page;

  list.innerHTML = '';
  for (const h of p.slice(filtered)) list.appendChild(renderHistoryRow(h));

  $('history-empty').style.display = allHistory.length === 0 ? 'block' : 'none';
  // Pager + Clear-all show whenever there's any history, so their position
  // never shifts on a single page (buttons just disable).
  $('history-pager').style.display = allHistory.length === 0 ? 'none' : '';
  $('history-clear-row').style.display = allHistory.length === 0 ? 'none' : '';
  $('history-prev').disabled = !p.hasPrev;
  $('history-next').disabled = !p.hasNext;
  $('history-info').textContent = p.isEmpty
    ? (allHistory.length ? 'no matches' : '')
    : p.label();
}

// Init-facing handlers for the search box + pager — keep the histSearch /
// histPage state private to this module.
export function setHistorySearch(value) { histSearch = value; histPage = 0; renderHistory(); }
export function histPagePrev() { histPage--; renderHistory(); }
export function histPageNext() { histPage++; renderHistory(); }

// Confirm a history deletion unless "Skip delete confirmations" is on (the same
// Library setting that gates the favourites delete confirm).
async function confirmHistoryDelete({ title, message, confirmText }) {
  if (skipDeleteConfirm()) return true;
  return showConfirm({ title, message, confirmText, danger: true });
}

export async function clearAllHistory() {
  if (!(await confirmHistoryDelete({
    title: 'Clear watch history',
    message: 'Remove every entry from your watch history? This does not touch '
           + 'your favourites.',
    confirmText: 'Clear all',
  }))) return;
  await api('/api/history', { method: 'DELETE' }).catch(() => {});
  allHistory = [];
  histPage = 0;
  renderHistory();
}

function renderHistoryRow(h) {
  const row = document.createElement('div');
  row.className = 'fav';
  row.dataset.cid = h.cid;   // lets the probing domain health-check this row

  const wrap = document.createElement('div');
  wrap.className = 'fav-name-wrap';

  const name = document.createElement('span');
  name.className = 'fav-name';
  name.textContent = h.name;
  name.title = h.cid;

  const sub = document.createElement('span');
  sub.className = 'fav-last';
  sub.textContent = relativeTimes()
    ? daysSinceLabel(h.played_at)
    : sqliteUtcToLocal(h.played_at);

  wrap.appendChild(name);
  wrap.appendChild(sub);
  wrap.onclick = async () => {
    if (notifyIfAlreadyPlaying(h.cid)) return;   // re-click on the live row: no-op
    $('cid-input').value = h.cid;
    refreshClearButton();
    showBusy('Starting…');
    try { await play({ name: h.name }); } finally { hideBusy(); }
  };

  row.oncontextmenu = e => {
    e.preventDefault();
    navigator.clipboard.writeText(h.cid).then(() => {
      const prev = row.style.opacity;
      row.style.opacity = '0.5';
      setTimeout(() => { row.style.opacity = prev; }, 350);
    }).catch(() => {});
  };

  row.appendChild(wrap);
  // Already saved → "Saved as: …" badge (double-click opens it in
  // Favourites); otherwise a ★ button that saves it.
  const existing = findFavouriteByCid(allFavs, h.cid);
  if (existing) {
    row.appendChild(buildSavedBadge(existing.name));
  } else {
    const starBtn = document.createElement('button');
    starBtn.className = 'icon-btn';
    setIcon(starBtn, 'star');
    starBtn.title = 'Add to favourites';
    starBtn.setAttribute('aria-label', 'Add to favourites');
    starBtn.onclick = () => instaSave(
      { cid: h.cid, name: h.name, translated_name: h.name }, starBtn, h.name);
    row.appendChild(starBtn);
  }

  const delBtn = document.createElement('button');
  delBtn.className = 'icon-btn';
  setIcon(delBtn, 'trash');
  delBtn.title = 'Remove from history';
  delBtn.setAttribute('aria-label', 'Remove from history');
  delBtn.onclick = async () => {
    if (!(await confirmHistoryDelete({
      title: 'Remove from history',
      message: `Remove “${h.name}” from your watch history?`,
      confirmText: 'Remove',
    }))) return;
    await api('/api/history/' + encodeURIComponent(h.cid), { method: 'DELETE' })
      .catch(() => {});
    allHistory = allHistory.filter(x => x.cid !== h.cid);
    renderHistory();
  };
  row.appendChild(delBtn);

  return row;
}
