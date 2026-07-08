import test from 'node:test';
import assert from 'node:assert';
import { noLocalDesktop, setNoLocalDesktop } from '../shared/runtime.js';

test('runtime', () => {
  assert.strictEqual(noLocalDesktop, false);
  setNoLocalDesktop(true);
  assert.strictEqual(noLocalDesktop, true);
});
