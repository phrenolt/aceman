// Favourites domain. The saved-channel list with its own search box +
// pager, inline rename, delete, and the "save the playing stream" flow
// (the ★ Save button and the name-picker modal). Backed by sqlite via
// /api/favs.
//
// The pure bits (name de-duping, last-watched label, save-button view,
// lookup) live in lib/favourites/ and lib/ and are unit-tested; this
// module is the DOM wiring.
//
// markSearchRowSaved + refreshSearchResultsIfAny are forward imports from
// the search domain (favourites changes flip per-result-row state). Also
// imports current + play from playback.

import { $, showError, showBusy, hideBusy, showConfirm } from '../../shared/dom.js';
import { api } from '../../shared/api.js';
import { setIcon } from '../../shared/icons.js';
import { daysSinceLabel } from './lib/last_watched_label.js';
import { uniqueFavouriteName } from './lib/favourite_names.js';
import { describeSaveButton } from './lib/save_favourite_button.js';
import { findFavouriteByCid } from './lib/favourite_lookup.js';
import { extractExistingName } from './lib/api_errors.js';
import { paginate } from '../../lib/pagination.js';
import { runModal } from '../../lib/modal.js';
import { markSearchRowSaved, refreshSearchResultsIfAny } from '../search/index.js';
import { current, play } from '../playback/index.js';
import { loadHistory } from '../history/index.js';
import { buildSavedBadge } from '../library/index.js';
import { pageSize, removeFromHistoryOnSave } from '../../lib/library_settings.js';

// In-memory cached list + filter/page state. allFavs is the full set from
// the store; the renderer slices it by search and page.
export let allFavs = [];
let favSearch = '';
let favPage = 0;

export async function loadFavs() {
  allFavs = await api('/api/favs');
  renderFavs();
  // Favourites set might have changed (saved/renamed/deleted in another
  // tab), so re-evaluate the Save-as-favourite button vs. star indicator.
  updateSaveButton();
  // Re-render any visible search results so a delete/rename here flips
  // their per-row "★ Saved as …" state back to "★ Save" (or vice versa).
  refreshSearchResultsIfAny();
}

function filteredFavs() {
  const q = favSearch.trim().toLowerCase();
  return q ? allFavs.filter(f => f.name.toLowerCase().includes(q)) : allFavs;
}

function renderFavs() {
  const filtered = filteredFavs();
  const p = paginate(filtered.length, favPage, pageSize());
  favPage = p.page;

  const list = $('fav-list');
  list.innerHTML = '';
  for (const f of p.slice(filtered)) list.appendChild(renderFavRow(f));

  $('fav-empty').style.display = allFavs.length === 0 ? 'block' : 'none';
  // Pager lives at the top; show whenever there are any favourites so its
  // position never shifts, even on a single page (buttons are just disabled).
  $('fav-pager').style.display = allFavs.length === 0 ? 'none' : '';
  $('fav-prev').disabled = !p.hasPrev;
  $('fav-next').disabled = !p.hasNext;
  $('fav-info').textContent = p.isEmpty
    ? (allFavs.length ? 'no matches' : '')
    : p.label();
}

// Init-facing handlers for the fav-list search box + pager — keep the
// favSearch / favPage state private to this module.
export function setFavSearch(value) { favSearch = value; favPage = 0; renderFavs(); }
export function favPagePrev() { favPage--; renderFavs(); }
export function favPageNext() { favPage++; renderFavs(); }

function renderFavRow(f) {
  const row = document.createElement('div');
  row.className = 'fav';

  const wrap = document.createElement('div');
  wrap.className = 'fav-name-wrap';

  const name = document.createElement('span');
  name.className = 'fav-name';
  name.textContent = f.name;
  name.title = f.cid;

  const last = document.createElement('span');
  last.className = 'fav-last';
  last.textContent = daysSinceLabel(f.last_played);

  wrap.appendChild(name);
  wrap.appendChild(last);

  const triggerPlay = async () => {
    row.classList.add('fav-playing');
    $('cid-input').value = f.cid;
    showBusy('Starting…');
    try { await play({ name: f.name }); } finally {
      hideBusy();
      setTimeout(() => row.classList.remove('fav-playing'), 1200);
    }
  };

  wrap.onclick = triggerPlay;

  row.oncontextmenu = e => {
    e.preventDefault();
    navigator.clipboard.writeText(f.cid).then(() => {
      const prev = row.style.opacity;
      row.style.opacity = '0.5';
      setTimeout(() => { row.style.opacity = prev; }, 350);
    }).catch(() => {});
  };

  // Direct row actions — rename (pencil) + delete (trash, shared with history).
  const renameBtn = document.createElement('button');
  renameBtn.className = 'icon-btn';
  setIcon(renameBtn, 'pencil');
  renameBtn.title = 'Rename';
  renameBtn.setAttribute('aria-label', 'Rename favourite');
  renameBtn.onclick = e => { e.stopPropagation(); startEditName(f, name); };

  const delBtn = document.createElement('button');
  delBtn.className = 'icon-btn';
  setIcon(delBtn, 'trash');
  delBtn.title = 'Delete';
  delBtn.setAttribute('aria-label', 'Delete favourite');
  delBtn.onclick = e => { e.stopPropagation(); deleteFav(f.name); };

  row.appendChild(wrap);
  row.appendChild(renameBtn);
  row.appendChild(delBtn);
  return row;
}

// Replace the name span with an <input>, commit on Enter/blur, cancel on Esc.
function startEditName(f, span) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'fav-edit-input';
  input.value = f.name;
  span.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  const restore = () => {
    if (done) return;
    done = true;
    if (input.parentNode) input.replaceWith(span);
  };
  const commit = async () => {
    if (done) return;
    const newName = input.value.trim();
    if (!newName || newName === f.name) { restore(); return; }
    done = true;
    try {
      await renameFav(f.name, newName);
    } catch (e) {
      done = false; showError(e.message); restore();
    }
  };
  input.onblur = commit;
  input.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); restore(); }
  };
}

async function renameFav(oldName, newName) {
  await api('/api/favs/' + encodeURIComponent(oldName), {
    method: 'PATCH', body: JSON.stringify({ name: newName }),
  });
  await loadFavs();
}

async function deleteFav(name) {
  if (!(await showConfirm({
    title: 'Delete favourite',
    message: `Delete favourite "${name}"?`,
    confirmText: 'Delete',
    danger: true,
  }))) return;
  await api('/api/favs/' + encodeURIComponent(name), { method: 'DELETE' });
  loadFavs();
}

// Names of every saved favourite — used by uniqueFavouriteName when seeding
// a candidate label so the suggestion doesn't collide.
const takenFavNames = () => allFavs.map(f => f.name);

export async function instaSave(r, btn, rowPrimary) {
  const originalText = btn.textContent;
  // Cheap client-side check first — covers the common case without a
  // roundtrip. The server still re-checks (race-safe + authoritative).
  // Normally the button would already be in its "saved" state in this
  // case (set by renderSearchRow), but the cache could be stale if
  // another tab raced us.
  const existing = findFavouriteByCid(allFavs, r.cid);
  if (existing) {
    markSearchRowSaved(btn, existing.name, rowPrimary);
    return;
  }
  const taken = takenFavNames();
  const english = uniqueFavouriteName(r.translated_name, taken);
  const originalLabel = uniqueFavouriteName(r.name, taken);
  const name = await showFavNameModal(english || '', originalLabel || '');
  if (!name) return;
  btn.disabled = true;
  try {
    await api('/api/favs', {
      method: 'POST', body: JSON.stringify({ name, cid: r.cid }),
    });
    await loadFavs();
    // Persistent "saved" state — no revert. Mirrors the same row state
    // the user gets if they re-search and see the result again later.
    markSearchRowSaved(btn, name, rowPrimary);
    maybeDropFromHistory(r.cid);
  } catch (e) {
    const existingName = extractExistingName(e);
    if (existingName) {
      // A race (another tab added it between our load and our POST) —
      // flip into the saved state instead of bouncing to the user.
      markSearchRowSaved(btn, existingName, rowPrimary);
    } else {
      showError(e.message);
      btn.textContent = originalText;
      btn.disabled = false;
    }
  }
}

// When the "remove from history on save" setting is on, drop the just-saved
// channel from watch history and refresh the (possibly visible) panel.
function maybeDropFromHistory(cid) {
  if (!removeFromHistoryOnSave()) return;
  api('/api/history/' + encodeURIComponent(cid), { method: 'DELETE' }).catch(() => {});
  loadHistory();
}

export function updateSaveButton() {
  const btn = $('save-btn');
  if (!btn) return;
  const ind = $('save-indicator');
  // Already a favourite → show the "<name> ★" mustard glyph (double-click
  // opens it in Favourites), not a Save button.
  const existing = current ? findFavouriteByCid(allFavs, current.cid) : null;
  if (current && existing) {
    btn.style.display = 'none';
    if (ind) {
      ind.innerHTML = '';
      ind.appendChild(buildSavedBadge(existing.name));
      ind.style.display = '';
    }
    return;
  }
  if (ind) { ind.style.display = 'none'; ind.innerHTML = ''; }
  const view = describeSaveButton(current, allFavs);
  btn.style.display = view.visible ? '' : 'none';
  btn.textContent = view.text;
  btn.disabled = view.disabled;
  btn.title = view.title;
}

// Three-way picker for favourite name: English label, original label,
// or a custom string the user types. Returns the chosen non-empty
// string, or null if cancelled. Selection is staged via radios — the
// favourite is only saved when the user clicks Save.
function showFavNameModal(english, original) {
  const overlay = $('favname-modal');
  const engOpt = $('favname-english-opt');
  const origOpt = $('favname-original-opt');
  const engText = $('favname-english-text');
  const origText = $('favname-original-text');
  const input = $('favname-custom-input');
  const bSave = $('favname-save');
  const bCancel = $('favname-cancel');

  const hasEng = !!english;
  const hasOrig = !!original && original !== english;
  engText.textContent = english || '';
  origText.textContent = original || '';
  engOpt.style.display = hasEng ? '' : 'none';
  origOpt.style.display = hasOrig ? '' : 'none';
  input.value = english || original || '';

  const radios = () => Array.from(
    overlay.querySelectorAll('input[name="favname-choice"]'));
  // Prefer original-language name; fall back to English if no distinct
  // original exists. If neither is available the custom input is implicit.
  const defaultRadio =
    radios().find(r => r.value === 'original' && hasOrig) ||
    radios().find(r => r.value === 'english'  && hasEng)  ||
    null;
  radios().forEach(r => { r.checked = (r === defaultRadio); });

  return runModal({ overlay }, done => {
    const commit = () => {
      const picked = radios().find(r => r.checked);
      let v = '';
      if (picked && picked.value === 'english') v = english;
      else if (picked && picked.value === 'original') v = original;
      else v = (input.value || '').trim(); // implicit custom
      if (!v) { input.focus(); return; }
      done(v);
    };
    const selectCustom = () => {
      // Custom is the absence of a radio selection.
      radios().forEach(r => { r.checked = false; });
    };
    bSave.onclick = commit;
    bCancel.onclick = () => done(null);
    input.onfocus = selectCustom;
    input.oninput = selectCustom;
    input.onkeydown = e => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
    };
    bSave.focus();
    return () => {
      bSave.onclick = bCancel.onclick = null;
      input.onkeydown = input.oninput = input.onfocus = null;
    };
  });
}

export async function saveFav() {
  if (!current) return;
  // Skip the name prompt if this cid is already saved — the user is much
  // more likely re-clicking the button by accident than wanting a second
  // entry under a new name.
  const existing = findFavouriteByCid(allFavs, current.cid);
  if (existing) {
    alert(`This stream is already in your favourites as “${existing.name}”.`);
    return;
  }
  // When the stream came from a search result, the row carries TWO
  // candidate labels — the translated/English one (current.name) and
  // the original (often Cyrillic) sub-label (current.altName). Offer
  // both as one-click buttons plus a custom text option.
  const english = (current.name || '').trim();
  const original = (current.altName || '').trim();
  const name = await showFavNameModal(english, original);
  if (!name) return;
  try {
    await api('/api/favs', {
      method: 'POST', body: JSON.stringify({ name, cid: current.cid }),
    });
  } catch (e) {
    // Server / store had a stale-cache duplicate the pre-check missed
    // (e.g. another tab added it between loads).
    const existingName = extractExistingName(e);
    if (existingName) {
      alert(`This stream is already in your favourites as “${existingName}”.`);
    } else {
      showError(e.message);
    }
    return;
  }
  loadFavs();
  maybeDropFromHistory(current.cid);
}
