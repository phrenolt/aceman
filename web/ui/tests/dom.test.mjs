import test from 'node:test';
import assert from 'node:assert';
import { $, showError, showBusy, hideBusy } from '../shared/dom.js';

test('dom helpers', (t) => {
  global.document = {
    getElementById: (id) => ({ id, textContent: '', style: {} })
  };
  assert.strictEqual($('test-id').id, 'test-id');
  showError('test error');
  showBusy('busy');
  hideBusy();
});
