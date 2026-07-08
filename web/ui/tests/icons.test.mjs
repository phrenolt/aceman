import test from 'node:test';
import assert from 'node:assert';
import { ICONS, setIcon } from '../shared/icons.js';

test('icons', () => {
  assert.ok(ICONS.close);
  const btn = {};
  setIcon(btn, 'close');
  assert.strictEqual(btn.innerHTML, ICONS.close);
});
