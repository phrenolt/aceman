// Tests for the favourite-name helpers.

import test from 'node:test';
import assert from 'node:assert/strict';
import { uniqueFavouriteName, pickFavouriteName } from '../js/lib/favourites/favourite_names.js';

test('uniqueFavouriteName — passes through a clean unused label', () => {
  assert.equal(uniqueFavouriteName('My channel', []), 'My channel');
});

test('uniqueFavouriteName — collapses inner whitespace + trims', () => {
  assert.equal(uniqueFavouriteName('  My   channel \n', []), 'My channel');
});

test('uniqueFavouriteName — empty / whitespace → null', () => {
  assert.equal(uniqueFavouriteName('', []), null);
  assert.equal(uniqueFavouriteName('   ', []), null);
  assert.equal(uniqueFavouriteName(null, []), null);
});

test('uniqueFavouriteName — appends (2) when the base is taken', () => {
  assert.equal(uniqueFavouriteName('Sport', ['Sport']), 'Sport (2)');
});

test('uniqueFavouriteName — walks up to the first free suffix', () => {
  const taken = ['Sport', 'Sport (2)', 'Sport (3)'];
  assert.equal(uniqueFavouriteName('Sport', taken), 'Sport (4)');
});

test('uniqueFavouriteName — caps base length to leave room for suffix', () => {
  const long = 'x'.repeat(200);
  const name = uniqueFavouriteName(long, []);
  assert.ok(name.length <= 124,
    `expected length <= 124, got ${name.length}`);
});

test('pickFavouriteName — prefers translated_name', () => {
  const r = { translated_name: 'English', name: 'Оригинал', cid: 'abc' };
  assert.equal(pickFavouriteName(r, []), 'English');
});

test('pickFavouriteName — falls back to name', () => {
  const r = { name: 'Оригинал', cid: 'abcdef0123456789' };
  assert.equal(pickFavouriteName(r, []), 'Оригинал');
});

test('pickFavouriteName — fabricates ace <cid8> when both labels missing', () => {
  const r = { cid: 'abcdef0123456789cafe' };
  assert.equal(pickFavouriteName(r, []), 'ace abcdef01');
});
