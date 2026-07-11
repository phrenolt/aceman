// Pure helpers for the probe freshness window + "last checked" tooltip.
//
// The server stamps each verdict with `probed_at`, a SQLite UTC string
// ("YYYY-MM-DD HH:MM:SS"). JS's Date parses a bare space-separated string as
// LOCAL time, so we normalise to ISO-UTC ("…THH:MM:SSZ") before parsing —
// otherwise the age would be off by the viewer's UTC offset.

// Seconds elapsed since `probedAtUtc` (a SQLite UTC stamp), or Infinity when
// it's missing/unparseable — so "unknown age" never counts as fresh.
export function ageSecs(probedAtUtc, nowMs = Date.now()) {
  if (typeof probedAtUtc !== 'string' || !probedAtUtc) return Infinity;
  const iso = probedAtUtc.trim().replace(' ', 'T') + 'Z';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return Infinity;
  return Math.max(0, (nowMs - t) / 1000);
}

// True when a verdict at `probedAtUtc` is within `maxAgeSecs`. maxAgeSecs <= 0
// disables the window (nothing is ever "fresh" → always re-probe).
export function isFresh(probedAtUtc, maxAgeSecs, nowMs = Date.now()) {
  if (!(maxAgeSecs > 0)) return false;
  return ageSecs(probedAtUtc, nowMs) <= maxAgeSecs;
}

// Compact "checked …" phrase for the marker tooltip.
export function checkedAgo(probedAtUtc, nowMs = Date.now()) {
  const s = ageSecs(probedAtUtc, nowMs);
  if (!Number.isFinite(s)) return '';
  if (s < 45) return 'checked just now';
  const m = Math.round(s / 60);
  if (m < 60) return `checked ${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `checked ${h}h ago`;
  return `checked ${Math.round(h / 24)}d ago`;
}
