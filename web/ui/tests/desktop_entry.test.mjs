import test from 'node:test';
import assert from 'node:assert';
import { refreshDesktopEntry } from '../domains/desktop/desktop_entry.js';

test('desktop_entry', async () => {
  global.document = { getElementById: () => ({ style: {}, classList: { toggle: () => {} }, dataset: {} }) };
  await refreshDesktopEntry();
  assert.ok(true);
});
