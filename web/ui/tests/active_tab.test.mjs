// Tests for the library active-tab normaliser. Pure, no DOM.
// Run with `node --test`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTab, LIBRARY_TABS } from '../domains/library/lib/active_tab.js';

test('valid stored tab is returned unchanged', () => {
  assert.equal(normalizeTab('history'), 'history');
  assert.equal(normalizeTab('favourites'), 'favourites');
  assert.equal(normalizeTab('search'), 'search');
});

test('unknown / empty / null stored value falls back to the first tab', () => {
  assert.equal(normalizeTab('nope'), 'search');
  assert.equal(normalizeTab(''), 'search');
  assert.equal(normalizeTab(null), 'search');
  assert.equal(normalizeTab(undefined), 'search');
});

test('the default is the first entry of the valid list', () => {
  assert.equal(normalizeTab('x', ['a', 'b']), 'a');
});

test('LIBRARY_TABS holds the three expected tabs in order', () => {
  assert.deepEqual(LIBRARY_TABS, ['search', 'history', 'favourites']);
});
