// Tests for the Android-TV IP combobox view helpers (filter + optimistic
// remove). The list is persisted server-side; these operate on the fetched
// cache. Pure-function unit tests — no DOM. Run with `node --test`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { filterIps, removeIp } from '../domains/playback/lib/tv_ip_history.js';

test('filterIps — case-insensitive substring; blank returns all', () => {
  const l = ['192.168.1.5', '192.168.1.50', '10.0.0.7'];
  assert.deepEqual(filterIps(l, ''), l);
  assert.deepEqual(filterIps(l, '   '), l);
  assert.deepEqual(filterIps(l, null), l);
  assert.deepEqual(filterIps(l, '1.5'), ['192.168.1.5', '192.168.1.50']);
  assert.deepEqual(filterIps(l, '10.'), ['10.0.0.7']);
  assert.deepEqual(filterIps(l, 'ZZ'), []);
  // returns a copy, not the same ref, when unfiltered
  assert.notEqual(filterIps(l, ''), l);
});

test('removeIp — drops the matching entry only', () => {
  assert.deepEqual(removeIp(['a', 'b', 'c'], 'b'), ['a', 'c']);
  assert.deepEqual(removeIp(['a', 'b'], 'zz'), ['a', 'b']);
  assert.deepEqual(removeIp([], 'x'), []);
});
