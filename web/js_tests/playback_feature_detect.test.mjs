// Tests for the in-browser-playback feature detector.

import test from 'node:test';
import assert from 'node:assert/strict';
import { inBrowserSupported } from '../js/lib/playback/playback_feature_detect.js';

test('mpegts present + isSupported() truthy → true', () => {
  const fakeWindow = { mpegts: { isSupported: () => true } };
  assert.equal(inBrowserSupported(fakeWindow), true);
});

test('mpegts present but isSupported() returns false → false', () => {
  const fakeWindow = { mpegts: { isSupported: () => false } };
  assert.equal(inBrowserSupported(fakeWindow), false);
});

test('mpegts missing → false (script never loaded)', () => {
  assert.equal(inBrowserSupported({}), false);
});

test('mpegts is truthy but lacks isSupported method → false', () => {
  // A half-loaded vendor bundle should NOT promote in-browser
  // playback as available — that would crash later when createPlayer
  // is missing too.
  assert.equal(inBrowserSupported({ mpegts: {} }), false);
  assert.equal(inBrowserSupported({ mpegts: { isSupported: 'not-a-fn' } }),
               false);
});

test('null / undefined globalObj → false (no crash)', () => {
  assert.equal(inBrowserSupported(null), false);
  assert.equal(inBrowserSupported(undefined), false);
});

test('isSupported throwing is treated as unsupported', () => {
  // Some private-browsing modes block MSE in a way that surfaces
  // as a throw from mpegts.isSupported(). We want a clean false —
  // an uncaught throw during the dropdown render would brick the UI.
  const fakeWindow = {
    mpegts: { isSupported: () => { throw new Error('blocked'); } },
  };
  assert.equal(inBrowserSupported(fakeWindow), false);
});
