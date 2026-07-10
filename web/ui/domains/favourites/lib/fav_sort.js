// Pure ordering for the favourites list. The server hands rows back A–Z; this
// re-sorts a copy according to the Library "Sort favourites by" setting.
//
//   'name'   — case-insensitive A–Z (the default; matches the server).
//   'recent' — most-recently-played first. Rows never played (no last_played)
//              sink to the bottom, then fall back to name order.
//
// last_played is a SQLite UTC stamp ("YYYY-MM-DD HH:MM:SS"); lexicographic
// comparison on that fixed-width shape is already chronological, so no Date
// parsing is needed. Non-mutating — returns a new array.

function byName(a, b) {
  return String(a.name || '').localeCompare(String(b.name || ''),
    undefined, { sensitivity: 'base' });
}

export function sortFavourites(list, mode = 'name') {
  const out = Array.isArray(list) ? list.slice() : [];
  if (mode !== 'recent') return out.sort(byName);
  return out.sort((a, b) => {
    const ap = a.last_played || '';
    const bp = b.last_played || '';
    if (ap && bp) return ap < bp ? 1 : ap > bp ? -1 : byName(a, b);  // newest first
    if (ap) return -1;                 // a played, b never → a first
    if (bp) return 1;                  // b played, a never → b first
    return byName(a, b);               // both never → A–Z
  });
}
