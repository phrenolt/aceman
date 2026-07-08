import test from 'node:test';
import assert from 'node:assert';
import { initSysUsage } from '../domains/sys-usage/sys_usage.js';

test('sys_usage', () => {
  global.document = { getElementById: () => ({}) };
  global.localStorage = { getItem: () => '0' };
  initSysUsage();
  assert.ok(true);
});
