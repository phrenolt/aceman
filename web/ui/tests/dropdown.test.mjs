import test from 'node:test';
import assert from 'node:assert';
import { mountAcemanSelect } from '../shared/dropdown.js';

test('dropdown', () => {
  global.document = {
    createElement: () => ({ appendChild: () => {}, querySelectorAll: () => [], classList: { add: () => {}, remove: () => {} }, setAttribute: () => {}, addEventListener: () => {} })
  };
  global.MutationObserver = class { observe() {} };
  const native = { parentNode: { insertBefore: () => {} }, children: [], classList: { add: () => {} }, setAttribute: () => {}, options: [], selectedIndex: -1 };
  mountAcemanSelect(native);
  assert.ok(native._acemanMounted);
});
