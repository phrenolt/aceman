import test from 'node:test';
import assert from 'node:assert';
import { initDiagnostics } from '../domains/diagnostics/diagnostics.js';

test('diagnostics', () => {
  global.document = { addEventListener: () => {} };
  initDiagnostics();
  assert.ok(true);
});
