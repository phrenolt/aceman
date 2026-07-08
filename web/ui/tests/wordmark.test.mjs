import test from 'node:test';
import assert from 'node:assert';
import { initWordmark } from '../domains/wordmark/wordmark.js';

test('wordmark', () => {
  const classList = {
    contains: () => false,
    toggle: (c, v) => { classList[c] = v; }
  };
  const el = { classList, onkeydown: null, onclick: null };
  global.document = { getElementById: () => el };
  global.localStorage = { getItem: () => '1', setItem: () => {} };
  initWordmark();
  assert.ok(classList.glow);
});
