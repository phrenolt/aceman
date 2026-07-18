// Pure helpers for the in-browser player's keyboard volume control.
// Side-effect-free so the clamping, overlay text, and glyph choice are
// unit-testable without a DOM or a real MediaElement — playback.js supplies
// the <video> + localStorage.

export const VOLUME_STEP = 0.05;   // ±5% per Arrow press (YouTube's step)

export function clampVolume(v) {
  if (typeof v !== 'number' || Number.isNaN(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

export function stepVolume(current, delta) {
  return clampVolume(clampVolume(current) + delta);
}

export function formatVolumePct(v) {
  return Math.round(clampVolume(v) * 100) + '%';
}

// Speaker glyph by level (rough thirds, matching VLC/YouTube). A muted or
// zero level always shows the crossed-out speaker.
export function volumeGlyph(volume, muted) {
  const v = clampVolume(volume);
  if (muted || v === 0) return '🔇';
  if (v < 0.34) return '🔈';
  if (v < 0.67) return '🔉';
  return '🔊';
}

// Overlay contents: a glyph + a percentage (or "Muted").
export function describeVolume(volume, muted) {
  return {
    glyph: volumeGlyph(volume, muted),
    text: muted ? 'Muted' : formatVolumePct(volume),
  };
}

// Parse a persisted volume string back to a clamped number; falls back to
// `dflt` for missing/garbage values (localStorage returns null when unset).
export function parseStoredVolume(raw, dflt = 1) {
  if (raw === null || raw === undefined || raw === '') return clampVolume(dflt);
  const n = Number(raw);
  return Number.isNaN(n) ? clampVolume(dflt) : clampVolume(n);
}
