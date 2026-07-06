// Pure helper for the library card's active-tab persistence.
//
// The last-open tab is stashed in localStorage; on load we must map an
// arbitrary stored string (possibly stale, empty, or tampered) back onto
// a real tab, defaulting to the first. Kept pure + unit-tested so the DOM
// wiring in library.js stays trivial.

export const LIBRARY_TABS = ['search', 'history', 'favourites'];

export function normalizeTab(stored, valid = LIBRARY_TABS) {
  return valid.includes(stored) ? stored : valid[0];
}
