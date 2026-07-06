// Tests for the storage-key registry.

import test from 'node:test';
import assert from 'node:assert/strict';
import { KEYS } from '../lib/storage_keys.js';

test('KEYS is frozen — name typos at call sites surface in tests', () => {
  assert.throws(() => { KEYS.LAST_PLAY = 'pwned'; });
});

test('KEYS includes every namespace we currently use', () => {
  for (const k of [
    'LAST_PLAY', 'GLOW',
    'SHOW_ALL_BROWSERS', 'RESTARTED_AT', 'LIBRARY_TAB',
  ]) {
    assert.ok(KEYS[k], `missing KEYS.${k}`);
    assert.ok(KEYS[k].startsWith('aceman.'),
      `KEYS.${k} should be under the aceman namespace`);
  }
});
