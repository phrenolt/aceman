import test from 'node:test';
import assert from 'node:assert';
import { initLogs } from '../domains/logs/logs.js';

test('logs', () => {
  global.document = { 
    getElementById: () => ({ style: {}, addEventListener: () => {}, classList: { add: () => {}, remove: () => {} } }),
    querySelectorAll: () => [],
    addEventListener: () => {}
  };
  initLogs();
  assert.ok(true);
});
