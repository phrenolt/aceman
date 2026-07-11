// Tests for the pure favourites ordering. Run with `node --test`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { sortFavourites } from '../domains/favourites/lib/fav_sort.js';

const rows = () => [
  { name: 'Beta', cid: 'b', last_played: '2026-07-01 10:00:00' },
  { name: 'alpha', cid: 'a', last_played: '2026-07-05 12:00:00' },
  { name: 'Gamma', cid: 'g', last_played: '' },               // never played
  { name: 'delta', cid: 'd', last_played: '2026-07-05 09:00:00' },
];

test("name mode sorts A–Z, case-insensitive", () => {
  const out = sortFavourites(rows(), 'name').map(r => r.name);
  assert.deepEqual(out, ['alpha', 'Beta', 'delta', 'Gamma']);
});

test("default mode is name", () => {
  assert.deepEqual(sortFavourites(rows()).map(r => r.name),
    sortFavourites(rows(), 'name').map(r => r.name));
});

test("recent mode: newest played first, never-played last, ties by name", () => {
  const out = sortFavourites(rows(), 'recent').map(r => r.name);
  // alpha (07-05 12:00) > delta (07-05 09:00) > Beta (07-01) > Gamma (never)
  assert.deepEqual(out, ['alpha', 'delta', 'Beta', 'Gamma']);
});

test("recent mode with two never-played falls back to A–Z", () => {
  const out = sortFavourites([
    { name: 'Zed', last_played: '' },
    { name: 'ann', last_played: null },
  ], 'recent').map(r => r.name);
  assert.deepEqual(out, ['ann', 'Zed']);
});

test("does not mutate the input array", () => {
  const input = rows();
  const before = input.map(r => r.name);
  sortFavourites(input, 'recent');
  assert.deepEqual(input.map(r => r.name), before);
});

test("non-array input yields an empty array", () => {
  assert.deepEqual(sortFavourites(null, 'name'), []);
  assert.deepEqual(sortFavourites(undefined, 'recent'), []);
});
