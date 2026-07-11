// Tests for the pure page-size clamp used by the Library settings.
// Run with `node --test`.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampPageSize, DEFAULT_PAGE_SIZE,
  clampProbeAgents, DEFAULT_PROBE_AGENTS, MAX_PROBE_AGENTS,
  clampFreshnessMins, DEFAULT_FRESHNESS_MINS,
  normalizeProbeScope, DEFAULT_PROBE_SCOPE,
  normalizeFreshnessUnit, DEFAULT_FRESHNESS_UNIT,
  freshnessInUnit, freshnessUnitToMins,
  resetProbeDefaults,
  normalizeFavSort, DEFAULT_FAV_SORT,
  normalizeDefaultTab, DEFAULT_LIBRARY_TAB,
} from '../lib/library_settings.js';

test('valid integers pass through', () => {
  assert.equal(clampPageSize('10'), 10);
  assert.equal(clampPageSize(25), 25);
});

test('non-numeric / empty / null → default', () => {
  assert.equal(clampPageSize(null), DEFAULT_PAGE_SIZE);
  assert.equal(clampPageSize(''), DEFAULT_PAGE_SIZE);
  assert.equal(clampPageSize('abc'), DEFAULT_PAGE_SIZE);
  assert.equal(clampPageSize(undefined, 7), 7);
});

test('clamps into [3, 100]', () => {
  assert.equal(clampPageSize('0'), 3);
  assert.equal(clampPageSize('1'), 3);
  assert.equal(clampPageSize('9999'), 100);
});

test('parses leading integer from mixed input', () => {
  assert.equal(clampPageSize('12abc'), 12);
});

test('probe agents clamp into [1, MAX] with default fallback', () => {
  assert.equal(clampProbeAgents('2'), 2);
  assert.equal(clampProbeAgents('0'), 1);
  assert.equal(clampProbeAgents('999'), MAX_PROBE_AGENTS);
  assert.equal(clampProbeAgents(null), DEFAULT_PROBE_AGENTS);
  assert.equal(clampProbeAgents('abc'), DEFAULT_PROBE_AGENTS);
});

test('freshness minutes clamp into [0, week], 0 allowed (force)', () => {
  assert.equal(clampFreshnessMins('5'), 5);
  assert.equal(clampFreshnessMins('0'), 0);           // 0 = always re-probe
  assert.equal(clampFreshnessMins('-3'), 0);
  assert.equal(clampFreshnessMins('999999'), 10080);  // capped at 7 days
  assert.equal(clampFreshnessMins(null), DEFAULT_FRESHNESS_MINS);
});

test('default freshness is 12 hours', () => {
  assert.equal(DEFAULT_FRESHNESS_MINS, 720);
});

test('freshness unit normalises unknown → default (hours)', () => {
  assert.equal(normalizeFreshnessUnit('min'), 'min');
  assert.equal(normalizeFreshnessUnit('hours'), 'hours');
  assert.equal(DEFAULT_FRESHNESS_UNIT, 'hours');
  assert.equal(normalizeFreshnessUnit('days'), 'hours');
  assert.equal(normalizeFreshnessUnit(null), 'hours');
});

test('freshnessInUnit converts canonical minutes for display', () => {
  assert.equal(freshnessInUnit(720, 'hours'), 12);
  assert.equal(freshnessInUnit(720, 'min'), 720);
  assert.equal(freshnessInUnit(90, 'hours'), 2);      // rounded (1.5 → 2)
  assert.equal(freshnessInUnit(0, 'hours'), 0);
});

test('freshnessUnitToMins converts a unit value back to clamped minutes', () => {
  assert.equal(freshnessUnitToMins('12', 'hours'), 720);
  assert.equal(freshnessUnitToMins('30', 'min'), 30);
  assert.equal(freshnessUnitToMins('-4', 'hours'), 0);
  assert.equal(freshnessUnitToMins('abc', 'min'), 0);
  assert.equal(freshnessUnitToMins('99999', 'hours'), 10080); // clamped to 7 days
});

test('resetProbeDefaults clears only the probe keys, not Library settings', () => {
  const store = new Map([
    ['aceman.pageSize', '25'],
    ['aceman.removeFromHistoryOnSave', '0'],
    ['aceman.probeScope', 'everything'],
    ['aceman.probeAgents', '8'],
    ['aceman.probeFreshnessMins', '30'],
    ['aceman.probeFreshnessUnit', 'min'],
    ['aceman.probeKeepUpdated', '0'],
    ['aceman.deepProbe', '0'],
  ]);
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  try {
    resetProbeDefaults();
    // Probe keys gone → getters fall back to defaults.
    for (const k of ['aceman.probeScope', 'aceman.probeAgents',
      'aceman.probeFreshnessMins', 'aceman.probeFreshnessUnit',
      'aceman.probeKeepUpdated', 'aceman.deepProbe']) {
      assert.equal(store.has(k), false, `${k} should be cleared`);
    }
    // Library settings untouched.
    assert.equal(store.get('aceman.pageSize'), '25');
    assert.equal(store.get('aceman.removeFromHistoryOnSave'), '0');
  } finally {
    delete globalThis.localStorage;
  }
});

test('favourites sort normalises unknown → default (name)', () => {
  assert.equal(normalizeFavSort('name'), 'name');
  assert.equal(normalizeFavSort('recent'), 'recent');
  assert.equal(DEFAULT_FAV_SORT, 'name');
  assert.equal(normalizeFavSort('added'), 'name');     // no such option
  assert.equal(normalizeFavSort(null), 'name');
});

test('default library tab normalises unknown → default (last)', () => {
  for (const t of ['last', 'search', 'favourites', 'history']) {
    assert.equal(normalizeDefaultTab(t), t);
  }
  assert.equal(DEFAULT_LIBRARY_TAB, 'last');
  assert.equal(normalizeDefaultTab('probe'), 'last');
  assert.equal(normalizeDefaultTab(null), 'last');
});

test('probe scope normalises unknown → default', () => {
  assert.equal(normalizeProbeScope('favourites'), 'favourites');
  assert.equal(normalizeProbeScope('history'), 'history');
  assert.equal(normalizeProbeScope('everything'), 'everything');    // union scope
  assert.equal(normalizeProbeScope('continuous'), DEFAULT_PROBE_SCOPE); // a toggle, not a scope
  assert.equal(normalizeProbeScope('bogus'), DEFAULT_PROBE_SCOPE);
  assert.equal(normalizeProbeScope(null), DEFAULT_PROBE_SCOPE);
});
