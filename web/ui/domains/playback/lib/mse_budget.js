// Pure helpers for the "max buffer" estimate shown in the stats line.
//
// The number of pre-roll seconds the browser can actually hold is bounded by
// its per-SourceBuffer BYTE budget, not by the slider: max_seconds ≈ budget ÷
// bitrate. That budget is implementation-defined and unreadable via any API,
// so we bootstrap from a conservative default and self-calibrate from real
// overflow points (bytes ≈ buffered-seconds × bitrate at the moment the fill
// froze). The DOM/localStorage/EMA glue lives in playback.js; the arithmetic
// lives here so it can be unit-tested.

// Conservative default budget — Chrome's video SourceBuffer is ~150 MB; we
// stay under it so a fresh install under-promises rather than overflows.
export const SAFE_MSE_BYTES = 140 * 1024 * 1024;
// Floor: reject a spurious tiny "cap" (e.g. an overflow at 2 s on a bitrate
// spike) that would otherwise poison the estimate downward.
export const MIN_MSE_BYTES = 40 * 1024 * 1024;

// Effective budget: a measured ceiling once we have one (ground truth —
// trusted whether higher or lower than the guess), else the conservative
// default. `learned` is bytes, or NaN/null/undefined when none is stored yet.
export function effectiveSafeBytes(learned, def = SAFE_MSE_BYTES, min = MIN_MSE_BYTES) {
  return (Number.isFinite(learned) && learned >= min) ? learned : def;
}

// Fold a newly observed overflow (in bytes) into the stored ceiling: keep the
// running MINIMUM (the tightest real cap seen), ignoring sub-floor noise.
// Returns the new value to store, or the previous one unchanged when the
// observation is rejected, or null when there's nothing to store. `prev` may
// be NaN/null/undefined when nothing is stored yet.
export function foldObservedCap(prev, observedBytes, min = MIN_MSE_BYTES) {
  if (!(observedBytes >= min)) return Number.isFinite(prev) ? prev : null;
  return Number.isFinite(prev) ? Math.min(prev, observedBytes) : observedBytes;
}

// Max whole seconds of buffer at the given byte rate, or null when the rate
// is unknown/zero. Floored so we never over-promise a fractional second.
export function maxBufferSecs(safeBytes, byteRate) {
  return byteRate > 0 ? Math.floor(safeBytes / byteRate) : null;
}
