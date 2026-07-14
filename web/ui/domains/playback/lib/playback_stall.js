// Pure decision for the mid-playback stall watchdog: has the feed actually
// died, or is it just a slow network still trickling bytes in?
//
// The <video> element fires `waiting` whenever its buffer underruns. On a very
// slow link that happens routinely — the engine delivers below 1x realtime, the
// pre-roll cushion drains, playback stalls — yet the /api/stream/proxy
// connection is alive and bytes keep arriving. Declaring the stream dead there
// is a false alarm: given time it recovers. So the hard-stall timer only
// escalates to a real "proxy disconnected / stream ended" error once the feed
// has gone genuinely SILENT (no bytes above the flow floor) for `silentMs`.
//
// This mirrors the distinction the pre-roll path already makes (see
// _preRollBuffer in playback.js): bytes-still-arriving means slow, not dead.
// Kept pure so the branch is exercised by deterministic unit tests without a
// real MediaSource, timers, or DOM.

// Default window of total byte-silence before a stalled stream is declared
// dead rather than merely slow.
export const STALL_FEED_SILENT_MS = 10000;

// True when the feed has gone silent long enough to call the stream dead.
// `now` and `lastByteFlowAt` share a monotonic clock (performance.now()).
// A byte-flow timestamp within the window → still alive (slow), keep waiting.
// lastByteFlowAt of 0 / null / never-flowed → treat as silent from the start,
// so a stream that never delivered a single byte still escalates on schedule.
export function feedIsDead(now, lastByteFlowAt, silentMs = STALL_FEED_SILENT_MS) {
  if (!(lastByteFlowAt > 0)) return true;
  return (now - lastByteFlowAt) >= silentMs;
}
