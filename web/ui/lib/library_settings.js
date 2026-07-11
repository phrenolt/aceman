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

// Default ON: saving a channel to favourites removes it from watch history
// (favourites supersede the transient history entry). Explicit '0' opts out.
export function removeFromHistoryOnSave() {
  try { return localStorage.getItem(KEYS.REMOVE_FROM_HISTORY_ON_SAVE) !== '0'; }
  catch { return true; }
}

export function setRemoveFromHistoryOnSave(on) {
  try { localStorage.setItem(KEYS.REMOVE_FROM_HISTORY_ON_SAVE, on ? '1' : '0'); }
  catch (_) { /* private mode */ }
}

// Deep probing: when on, the ⚕ Probe-page button also runs ffprobe to detect
// channels whose format won't play (marked orange) and logs every can't-play
// result server-side for export. Off by default — it's the heavier path.
export function deepProbe() {
  try { return localStorage.getItem(KEYS.DEEP_PROBE) !== '0'; }
  catch { return true; }
}

export function setDeepProbe(on) {
  try { localStorage.setItem(KEYS.DEEP_PROBE, on ? '1' : '0'); }
  catch (_) { /* private mode */ }
}

// ---- probe run settings (⚕ Probe panel) --------------------------------
// Concurrent probe agents (pool size). Ceiling is 8: a live ramp test crashed
// the engine gateway around 48 concurrent sessions and degraded around 32, so 8
// keeps a wide margin (and matches the server's hard semaphore).
export const DEFAULT_PROBE_AGENTS = 2;
export const MAX_PROBE_AGENTS = 8;

export function clampProbeAgents(raw, def = DEFAULT_PROBE_AGENTS) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(n, 1), MAX_PROBE_AGENTS);
}

export function probeAgents() {
  try { return clampProbeAgents(localStorage.getItem(KEYS.PROBE_AGENTS)); }
  catch { return DEFAULT_PROBE_AGENTS; }
}

export function setProbeAgents(n) {
  try { localStorage.setItem(KEYS.PROBE_AGENTS, String(clampProbeAgents(n))); }
  catch (_) { /* private mode */ }
}

// Freshness window, stored canonically in MINUTES: skip re-probing a channel
// whose last verdict is this recent. 0 disables the skip (always re-probe).
// Default 12 h — verdicts are stable enough that hammering the engine more often
// isn't worth it, and it rides out a channel's transient off-air dips. Capped at
// a week so the hours unit has useful range.
export const DEFAULT_FRESHNESS_MINS = 720;         // 12 hours
const MAX_FRESHNESS_MINS = 10080;                  // 7 days

export function clampFreshnessMins(raw, def = DEFAULT_FRESHNESS_MINS) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(n, 0), MAX_FRESHNESS_MINS);
}

export function probeFreshnessMins() {
  try { return clampFreshnessMins(localStorage.getItem(KEYS.PROBE_FRESHNESS_MINS)); }
  catch { return DEFAULT_FRESHNESS_MINS; }
}

export function setProbeFreshnessMins(n) {
  try { localStorage.setItem(KEYS.PROBE_FRESHNESS_MINS, String(clampFreshnessMins(n))); }
  catch (_) { /* private mode */ }
}

// Display unit for the freshness field. The value is always stored in minutes
// (above); this only controls how it's shown/stepped in the panel. Default
// 'hours' to match the 12 h default.
export const FRESHNESS_UNITS = ['min', 'hours'];
export const DEFAULT_FRESHNESS_UNIT = 'hours';
// Max the number field allows per unit (both = the 7-day canonical cap).
export const FRESHNESS_UNIT_MAX = { min: MAX_FRESHNESS_MINS, hours: MAX_FRESHNESS_MINS / 60 };

export function normalizeFreshnessUnit(raw) {
  return FRESHNESS_UNITS.includes(raw) ? raw : DEFAULT_FRESHNESS_UNIT;
}

export function freshnessUnit() {
  try { return normalizeFreshnessUnit(localStorage.getItem(KEYS.PROBE_FRESHNESS_UNIT)); }
  catch { return DEFAULT_FRESHNESS_UNIT; }
}

export function setFreshnessUnit(u) {
  try { localStorage.setItem(KEYS.PROBE_FRESHNESS_UNIT, normalizeFreshnessUnit(u)); }
  catch (_) { /* private mode */ }
}

// Canonical minutes → a whole number shown in the given unit (hours rounded).
export function freshnessInUnit(mins, unit) {
  const m = clampFreshnessMins(mins);
  return normalizeFreshnessUnit(unit) === 'hours' ? Math.round(m / 60) : m;
}

// A number entered in the given unit → canonical minutes, clamped. Junk → 0.
export function freshnessUnitToMins(value, unit) {
  const n = parseInt(value, 10);
  const v = Number.isFinite(n) ? Math.max(0, n) : 0;
  return clampFreshnessMins(normalizeFreshnessUnit(unit) === 'hours' ? v * 60 : v);
}

// Selected probe scope (the switch in the ⚕ panel) that the Probe button runs
// and that "Keep updated" auto-re-runs. Persisted so the panel reopens where you
// left it. 'everything' = favourites + search + history together.
export const PROBE_SCOPES = ['page', 'favourites', 'search', 'history', 'everything'];
export const DEFAULT_PROBE_SCOPE = 'page';

export function normalizeProbeScope(raw) {
  return PROBE_SCOPES.includes(raw) ? raw : DEFAULT_PROBE_SCOPE;
}

export function probeScope() {
  try { return normalizeProbeScope(localStorage.getItem(KEYS.PROBE_SCOPE)); }
  catch { return DEFAULT_PROBE_SCOPE; }
}

export function setProbeScope(scope) {
  try { localStorage.setItem(KEYS.PROBE_SCOPE, normalizeProbeScope(scope)); }
  catch (_) { /* private mode */ }
}

// "Keep updated": when on (default), the selected scope is re-probed
// automatically whenever its list changes — for a search, that means as you
// stop typing; for favourites / history / everything, when the list updates.
// Freshness-skipped so it never re-probes a recent verdict. Explicit '0' opts
// out. This single toggle replaced the old pair of continuous checkboxes: the
// mode is now just "the selected scope, kept fresh".
export function keepUpdated() {
  try { return localStorage.getItem(KEYS.PROBE_KEEP_UPDATED) !== '0'; }
  catch { return true; }
}

export function setKeepUpdated(on) {
  try { localStorage.setItem(KEYS.PROBE_KEEP_UPDATED, on ? '1' : '0'); }
  catch (_) { /* private mode */ }
}

// Just the ⚕ Probe-panel settings (scope, keep-updated, deep, agents,
// freshness value + unit). Dropped by the probe panel's own "Reset to defaults"
// so the getters fall back to their defaults — without disturbing the Library
// settings (page size, history-on-save).
//
// Built inside a function, not a module-level const: in the flattened browser
// bundle top-level statements run in file order, and library_settings.js sorts
// before storage_keys.js — so reading KEYS at init time would hit its temporal
// dead zone (ReferenceError). Deferring the read to call time avoids that.
function probeSettingKeys() {
  return [
    KEYS.DEEP_PROBE, KEYS.PROBE_AGENTS, KEYS.PROBE_FRESHNESS_MINS,
    KEYS.PROBE_FRESHNESS_UNIT, KEYS.PROBE_SCOPE, KEYS.PROBE_KEEP_UPDATED,
  ];
}

export function resetProbeDefaults() {
  try { for (const k of probeSettingKeys()) localStorage.removeItem(k); }
  catch (_) { /* private mode */ }
}

// ---- browse ordering + display (Library settings) ----------------------
// Favourites sort order. 'name' (A–Z, case-insensitive — matches the server's
// default ORDER BY) or 'recent' (most-recently-played first). No "date added"
// option: the favorites table stores no insertion timestamp.
export const FAV_SORTS = ['name', 'recent'];
export const DEFAULT_FAV_SORT = 'name';

export function normalizeFavSort(raw) {
  return FAV_SORTS.includes(raw) ? raw : DEFAULT_FAV_SORT;
}
export function favSort() {
  try { return normalizeFavSort(localStorage.getItem(KEYS.FAV_SORT)); }
  catch { return DEFAULT_FAV_SORT; }
}
export function setFavSort(v) {
  try { localStorage.setItem(KEYS.FAV_SORT, normalizeFavSort(v)); }
  catch (_) { /* private mode */ }
}

// Which tab the Library opens on. 'last' honours the remembered last-open tab
// (KEYS.LIBRARY_TAB); any other value pins it.
export const LIBRARY_DEFAULT_TABS = ['last', 'search', 'favourites', 'history'];
export const DEFAULT_LIBRARY_TAB = 'last';

export function normalizeDefaultTab(raw) {
  return LIBRARY_DEFAULT_TABS.includes(raw) ? raw : DEFAULT_LIBRARY_TAB;
}
export function libraryDefaultTab() {
  try { return normalizeDefaultTab(localStorage.getItem(KEYS.LIBRARY_DEFAULT_TAB)); }
  catch { return DEFAULT_LIBRARY_TAB; }
}
export function setLibraryDefaultTab(v) {
  try { localStorage.setItem(KEYS.LIBRARY_DEFAULT_TAB, normalizeDefaultTab(v)); }
  catch (_) { /* private mode */ }
}

// Relative vs absolute timestamps in the browse lists. Default ON: favourites
// already read "3d ago", so ON makes history match; OFF shows an absolute
// local stamp everywhere. Explicit '0' opts out.
export function relativeTimes() {
  try { return localStorage.getItem(KEYS.RELATIVE_TIMES) !== '0'; }
  catch { return true; }
}
export function setRelativeTimes(on) {
  try { localStorage.setItem(KEYS.RELATIVE_TIMES, on ? '1' : '0'); }
  catch (_) { /* private mode */ }
}

// Skip the confirmation dialog on destructive actions (deleting a favourite).
// Default OFF — the confirm is the safety net; this is an explicit power-user
// opt-in. Explicit '1' turns it on.
export function skipDeleteConfirm() {
  try { return localStorage.getItem(KEYS.SKIP_DELETE_CONFIRM) === '1'; }
  catch { return false; }
}
export function setSkipDeleteConfirm(on) {
  try { localStorage.setItem(KEYS.SKIP_DELETE_CONFIRM, on ? '1' : '0'); }
  catch (_) { /* private mode */ }
}

// Reset-to-defaults: drop every Library/probe setting key so the getters fall
// back to their defaults. Used by the ⚙ modal's "Reset to defaults" button.
export function resetLibraryDefaults() {
  const keys = [
    KEYS.PAGE_SIZE, KEYS.REMOVE_FROM_HISTORY_ON_SAVE,
    KEYS.FAV_SORT, KEYS.LIBRARY_DEFAULT_TAB,
    KEYS.RELATIVE_TIMES, KEYS.SKIP_DELETE_CONFIRM,
    ...probeSettingKeys(),
  ];
  try { for (const k of keys) localStorage.removeItem(k); }
  catch (_) { /* private mode */ }
}
