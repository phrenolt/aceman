import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SAFE_MSE_BYTES, MIN_MSE_BYTES,
  effectiveSafeBytes, foldObservedCap, maxBufferSecs,
} from '../domains/playback/lib/mse_budget.js';

const MB = 1024 * 1024;

test('effectiveSafeBytes: default until a real ceiling is learned', () => {
  assert.equal(effectiveSafeBytes(NaN), SAFE_MSE_BYTES);
  assert.equal(effectiveSafeBytes(null), SAFE_MSE_BYTES);
  assert.equal(effectiveSafeBytes(undefined), SAFE_MSE_BYTES);
});

test('effectiveSafeBytes: trusts a learned ceiling, higher OR lower than default', () => {
  assert.equal(effectiveSafeBytes(100 * MB), 100 * MB);   // tighter device
  assert.equal(effectiveSafeBytes(170 * MB), 170 * MB);   // roomier device (real cap)
});

test('effectiveSafeBytes: rejects sub-floor noise', () => {
  // A spurious 10 MB "cap" must not poison the estimate.
  assert.equal(effectiveSafeBytes(10 * MB), SAFE_MSE_BYTES);
  assert.equal(effectiveSafeBytes(MIN_MSE_BYTES), MIN_MSE_BYTES); // exactly at floor is kept
});

test('foldObservedCap: first observation is stored', () => {
  assert.equal(foldObservedCap(NaN, 160 * MB), 160 * MB);
  assert.equal(foldObservedCap(null, 160 * MB), 160 * MB);
});

test('foldObservedCap: keeps the running minimum', () => {
  assert.equal(foldObservedCap(160 * MB, 140 * MB), 140 * MB); // tighter wins
  assert.equal(foldObservedCap(140 * MB, 160 * MB), 140 * MB); // looser ignored
});

test('foldObservedCap: sub-floor observation is rejected, prev preserved', () => {
  assert.equal(foldObservedCap(150 * MB, 5 * MB), 150 * MB);
  assert.equal(foldObservedCap(NaN, 5 * MB), null); // nothing stored, nothing to keep
});

test('maxBufferSecs: budget / bitrate, floored', () => {
  const rate = 62 * MB / 8;                 // 62 Mbps in bytes/s (~8.1 MB/s)
  assert.equal(maxBufferSecs(140 * MB, rate), 18);   // matches the 4K overflow case
  assert.equal(maxBufferSecs(140 * MB, 3 * MB / 8), 373); // SD holds minutes
});

test('maxBufferSecs: null until a rate is known', () => {
  assert.equal(maxBufferSecs(140 * MB, null), null);
  assert.equal(maxBufferSecs(140 * MB, 0), null);
});
