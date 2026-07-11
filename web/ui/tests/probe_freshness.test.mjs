// Tests for the pure probe freshness / "last checked" helpers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ageSecs, isFresh, checkedAgo } from '../domains/probing/lib/probe_freshness.js';

// A fixed "now" and a UTC stamp 120s earlier.
const NOW = Date.parse('2026-07-09T21:02:00Z');
const STAMP = '2026-07-09 21:00:00';   // SQLite UTC form, 120s before NOW

test('ageSecs parses SQLite UTC as UTC (no local-offset drift)', () => {
  assert.equal(ageSecs(STAMP, NOW), 120);
});

test('ageSecs → Infinity for missing/garbage', () => {
  assert.equal(ageSecs('', NOW), Infinity);
  assert.equal(ageSecs(null, NOW), Infinity);
  assert.equal(ageSecs('not a date', NOW), Infinity);
});

test('isFresh honours the window; 0 disables it', () => {
  assert.equal(isFresh(STAMP, 300, NOW), true);    // 120s < 300s
  assert.equal(isFresh(STAMP, 60, NOW), false);    // 120s > 60s
  assert.equal(isFresh(STAMP, 0, NOW), false);     // window off → never fresh
  assert.equal(isFresh('', 300, NOW), false);      // unknown age → not fresh
});

test('checkedAgo phrases the elapsed time', () => {
  assert.equal(checkedAgo('2026-07-09 21:01:40', NOW), 'checked just now'); // 20s
  assert.match(checkedAgo(STAMP, NOW), /2m ago/);
  assert.match(checkedAgo('2026-07-09 19:02:00', NOW), /2h ago/);
  assert.match(checkedAgo('2026-07-07 21:02:00', NOW), /2d ago/);
  assert.equal(checkedAgo('', NOW), '');
});
