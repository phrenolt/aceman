// Tests for the pure probe-marker view-model (state → glyph/class/label/title).
// Run with `node --test`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { probeView, probeTitle, PROBE_STATES } from '../domains/probing/lib/probe_view.js';

test('every state maps to a distinct glyph/class', () => {
  const seen = new Set();
  for (const s of PROBE_STATES) {
    const v = probeView(s);
    assert.equal(v.state, s);
    assert.ok(v.glyph, `state ${s} has a glyph`);
    assert.ok(v.cls.startsWith('probe-'), `state ${s} has a probe- class`);
    seen.add(v.cls);
  }
  assert.equal(seen.size, PROBE_STATES.length, 'classes are distinct');
});

test('healthy vs slow share the dot but differ in class', () => {
  assert.equal(probeView('healthy').glyph, probeView('slow').glyph);
  assert.notEqual(probeView('healthy').cls, probeView('slow').cls);
});

test('unrecognised state normalises to unknown', () => {
  const v = probeView('bogus');
  assert.equal(v.state, 'unknown');
  assert.equal(v.cls, 'probe-unknown');
});

test('healthy title includes the first-byte time, trimmed', () => {
  assert.match(probeView('healthy', { first_byte_secs: 0.06 }).title, /0\.06s/);
  // trailing zeros trimmed: 6.00 → 6s, 0.50 → 0.5s
  assert.match(probeTitle('slow', { first_byte_secs: 6 }), /6s/);
  assert.match(probeTitle('healthy', { first_byte_secs: 0.5 }), /0\.5s/);
});

test('healthy title omits timing when detail is absent', () => {
  const t = probeView('healthy').title;
  assert.match(t, /Healthy/);
  assert.doesNotMatch(t, /first data/);
});

test('dead title explains the "may be offline" caveat', () => {
  assert.match(probeView('dead').title, /offline|unseeded|off-air/i);
});

test('unreachable title points at the engine, not the channel', () => {
  assert.match(probeView('unreachable').title, /engine/i);
});

test('unplayable carries the ffprobe reason and its own orange class', () => {
  const v = probeView('unplayable', { reason: 'no audio or video stream found' });
  assert.equal(v.cls, 'probe-unplayable');
  assert.match(v.title, /no audio or video stream/);
  assert.match(v.title, /not playable/i);
});

test('playing state explains it was skipped', () => {
  const v = probeView('playing');
  assert.equal(v.cls, 'probe-playing');
  assert.match(v.title, /watching|skipped/i);
});
