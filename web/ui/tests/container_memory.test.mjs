import test from 'node:test';
import assert from 'node:assert';
import { initContainerMemory } from '../domains/container-memory/container_memory.js';

test('container_memory', () => {
  global.document = { getElementById: () => ({ style: {}, classList: { toggle: () => {} }, querySelector: () => ({ dataset: {} }) }) };
  global.setInterval = () => {};
  global.fetch = () => Promise.resolve({ json: () => ({ available: false }) });
  initContainerMemory();
  assert.ok(true);
});
