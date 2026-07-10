// Classify an in-browser playback failure as *fatal* (retrying can't help) vs.
// *transient* (a blip mpegts.js recovers from on its own).
//
// The motivating case: a channel whose container/codec MSE can't decode fails
// with NS_ERROR_FAILURE ("could not be decoded"). Retrying just re-appends the
// same undecodable bytes, so mpegts.js loops forever throwing "SourceBuffer …
// no longer usable". A fatal verdict tells playback.js to tear the player down
// (which also clears the liveness flag) instead of letting that loop run.
//
// Pure + unit-tested; all DOM/teardown wiring lives in playback.js.

// mpegts.js ErrorTypes.MEDIA_ERROR — a decode/format/codec failure. The other
// types (NetworkError, OtherError) are treated as recoverable.
export const MPEGTS_MEDIA_ERROR = 'MediaError';

export function isFatalMpegtsError(type) {
  return type === MPEGTS_MEDIA_ERROR;
}

// HTMLMediaElement.error.code: 3 = MEDIA_ERR_DECODE, 4 = MEDIA_ERR_SRC_NOT_SUPPORTED
// — the bytes can't be decoded/played. 1 (ABORTED) and 2 (NETWORK) don't imply
// the channel is unplayable, so they're not fatal here.
export function isFatalVideoError(code) {
  return code === 3 || code === 4;
}
