// Pure helpers for the Android-TV IP combobox. The list itself is now
// persisted server-side (SQLite, /api/tv/ips) and fetched into an in-memory
// cache; these two DOM-free helpers drive the client-side view of that cache:
// the live-search filter the input applies as you type, and an optimistic
// local removal used before the DELETE round-trips. Unit-tested against plain
// arrays/strings (see tests/tv_ip_history.test.mjs).

// Live search: case-insensitive substring match. An empty/blank query
// returns the whole list (dropdown shows everything).
export function filterIps(list, query) {
  const q = String(query == null ? '' : query).trim().toLowerCase();
  if (!q) return list.slice();
  return list.filter(x => x.toLowerCase().includes(q));
}

// Drop one entry (optimistic cache update before the server DELETE lands).
export function removeIp(list, ip) {
  return list.filter(x => x !== ip);
}
