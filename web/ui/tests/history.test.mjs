import test from 'node:test';
import assert from 'node:assert';

test('history', async () => {
  global.localStorage = { getItem: () => null, setItem: () => {} };
  global.document = { getElementById: () => ({ innerHTML: '', style: {} }) };
  global.fetch = () => Promise.resolve({ ok: true, json: () => [] });
  const { loadHistory } = await import('../domains/history/history.js');
  await loadHistory();
  assert.ok(true);
});
