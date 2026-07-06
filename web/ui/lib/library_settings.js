// App-wide Library settings, backed by localStorage — read by the
// search / favourites / history panels and edited via the ⚙ modal on the
// Library card.
//
//   * pageSize()               — rows per page across all three panels
//   * removeFromHistoryOnSave()— drop a channel from watch history when it's
//                                saved to favourites
//
// clampPageSize is pure and unit-tested; the getters/setters are thin
// localStorage wrappers around it.

import { KEYS } from './storage_keys.js';

export const DEFAULT_PAGE_SIZE = 10;
const MIN_PAGE_SIZE = 3;
const MAX_PAGE_SIZE = 100;

export function clampPageSize(raw, def = DEFAULT_PAGE_SIZE) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(n, MIN_PAGE_SIZE), MAX_PAGE_SIZE);
}

export function pageSize() {
  try { return clampPageSize(localStorage.getItem(KEYS.PAGE_SIZE)); }
  catch { return DEFAULT_PAGE_SIZE; }
}

export function setPageSize(n) {
  try { localStorage.setItem(KEYS.PAGE_SIZE, String(clampPageSize(n))); }
  catch (_) { /* private mode */ }
}

export function removeFromHistoryOnSave() {
  try { return localStorage.getItem(KEYS.REMOVE_FROM_HISTORY_ON_SAVE) === '1'; }
  catch { return false; }
}

export function setRemoveFromHistoryOnSave(on) {
  try { localStorage.setItem(KEYS.REMOVE_FROM_HISTORY_ON_SAVE, on ? '1' : '0'); }
  catch (_) { /* private mode */ }
}
