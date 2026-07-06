// Tests for the pure page-size clamp used by the Library settings.
// Run with `node --test`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { clampPageSize, DEFAULT_PAGE_SIZE } from '../lib/library_settings.js';

test('valid integers pass through', () => {
  assert.equal(clampPageSize('10'), 10);
  assert.equal(clampPageSize(25), 25);
});

test('non-numeric / empty / null → default', () => {
  assert.equal(clampPageSize(null), DEFAULT_PAGE_SIZE);
  assert.equal(clampPageSize(''), DEFAULT_PAGE_SIZE);
  assert.equal(clampPageSize('abc'), DEFAULT_PAGE_SIZE);
  assert.equal(clampPageSize(undefined, 7), 7);
});

test('clamps into [3, 100]', () => {
  assert.equal(clampPageSize('0'), 3);
  assert.equal(clampPageSize('1'), 3);
  assert.equal(clampPageSize('9999'), 100);
});

test('parses leading integer from mixed input', () => {
  assert.equal(clampPageSize('12abc'), 12);
});
