// Tests for the mid-playback stall watchdog's dead-vs-slow decision.
//
// The DOM/timer plumbing (arm on `waiting`, re-check, report death) stays in
// playback.js; the single branch that matters — is the feed actually dead, or
// just a slow network still delivering bytes — is pulled into feedIsDead() so
// the false-alarm edge cases are checked without a real MediaSource or timers.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STALL_FEED_SILENT_MS, feedIsDead,
} from '../domains/playback/lib/playback_stall.js';

test('feed still trickling within the window is NOT dead (slow, not dead)', () => {
  // Underrun stall but bytes arrived 1 s ago → slow network, keep waiting.
  assert.equal(feedIsDead(100_000, 100_000 - 1_000), false);
  // Right at the flow floor recency — still alive.
  assert.equal(feedIsDead(100_000, 100_000 - (STALL_FEED_SILENT_MS - 1)), false);
});

test('feed silent for the full window is dead', () => {
  // Exactly silentMs of silence → escalate.
  assert.equal(feedIsDead(100_000, 100_000 - STALL_FEED_SILENT_MS), true);
  // Well past the window → dead.
  assert.equal(feedIsDead(100_000, 100_000 - 60_000), true);
});

test('a stream that never delivered a byte is treated as dead', () => {
  // lastByteFlowAt of 0 (reset per play, never updated) → silent from t0.
  assert.equal(feedIsDead(20_000, 0), true);
  assert.equal(feedIsDead(20_000, null), true);
  assert.equal(feedIsDead(20_000, undefined), true);
});

test('custom silence window is honoured', () => {
  assert.equal(feedIsDead(100_000, 100_000 - 4_000, 5_000), false);
  assert.equal(feedIsDead(100_000, 100_000 - 5_000, 5_000), true);
});
