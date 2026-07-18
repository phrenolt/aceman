// Tests for the in-browser player's volume helpers (clamp, step, format,
// glyph, persisted-value parse). Pure functions — no DOM. Run with `node --test`.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VOLUME_STEP, clampVolume, stepVolume, formatVolumePct, volumeGlyph,
  describeVolume, parseStoredVolume,
} from '../domains/playback/lib/volume_control.js';

test('clampVolume — bounds to [0,1], garbage → 0', () => {
  assert.equal(clampVolume(0.5), 0.5);
  assert.equal(clampVolume(-0.2), 0);
  assert.equal(clampVolume(1.5), 1);
  assert.equal(clampVolume(NaN), 0);
  assert.equal(clampVolume('x'), 0);
  assert.equal(clampVolume(undefined), 0);
});

test('stepVolume — clamps at both ends', () => {
  assert.equal(stepVolume(0.5, VOLUME_STEP), 0.55);
  assert.equal(stepVolume(0.98, VOLUME_STEP), 1);      // no overshoot past 1
  assert.equal(stepVolume(0.02, -VOLUME_STEP), 0);     // no undershoot past 0
  assert.equal(stepVolume(0, -VOLUME_STEP), 0);
});

test('formatVolumePct — rounded integer percent', () => {
  assert.equal(formatVolumePct(0), '0%');
  assert.equal(formatVolumePct(1), '100%');
  assert.equal(formatVolumePct(0.454), '45%');
  assert.equal(formatVolumePct(0.455), '46%');
});

test('volumeGlyph — muted/zero crossed-out; thirds otherwise', () => {
  assert.equal(volumeGlyph(0.8, true), '🔇');   // muted overrides level
  assert.equal(volumeGlyph(0, false), '🔇');    // zero reads as muted
  assert.equal(volumeGlyph(0.2, false), '🔈');
  assert.equal(volumeGlyph(0.5, false), '🔉');
  assert.equal(volumeGlyph(0.9, false), '🔊');
});

test('describeVolume — glyph + "Muted"/percent', () => {
  assert.deepEqual(describeVolume(0.5, false), { glyph: '🔉', text: '50%' });
  assert.deepEqual(describeVolume(0.5, true), { glyph: '🔇', text: 'Muted' });
});

test('parseStoredVolume — missing/garbage → default, else clamped', () => {
  assert.equal(parseStoredVolume(null), 1);          // unset → full
  assert.equal(parseStoredVolume(''), 1);
  assert.equal(parseStoredVolume('nope'), 1);
  assert.equal(parseStoredVolume(null, 0.3), 0.3);   // caller default honoured
  assert.equal(parseStoredVolume('0.42'), 0.42);
  assert.equal(parseStoredVolume('2'), 1);           // clamped
  assert.equal(parseStoredVolume('-1'), 0);
});
