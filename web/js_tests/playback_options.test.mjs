// Tests for the playback-target option-list builder.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlaybackOptions } from '../js/lib/playback_options.js';

const FF = { name: 'firefox', source: 'system' };
const FF_FLATPAK = { name: 'firefox', source: 'flatpak' };
const CHROME = { name: 'google-chrome', source: 'system' };
const VLC = { name: 'vlc', source: 'system' };
const MPV = { name: 'mpv', source: 'system' };

test('default state — only "This tab" with no browser sniff', () => {
  const v = buildPlaybackOptions({
    detectedPlayers: [], detectedBrowsers: [],
    currentBrowser: '', showAll: false, inBrowserSupported: true,
  });
  assert.equal(v.groups.length, 1);
  assert.equal(v.groups[0].label, null);
  assert.deepEqual(v.groups[0].options, [{
    value: 'browser',
    text: 'This browser tab',
    disabled: false,
  }]);
  assert.equal(v.hasAnyTarget, true);
});

test('current browser is sniffed → "This tab" gets specific label', () => {
  const v = buildPlaybackOptions({
    detectedPlayers: [], detectedBrowsers: [],
    currentBrowser: 'firefox', showAll: false, inBrowserSupported: true,
  });
  assert.equal(v.groups[0].options[0].text, 'This Firefox tab');
});

test('showAll forces the generic "This browser tab" label', () => {
  // With "show all" on, the bare option could correspond to any of
  // several installs of the same browser, so the generic is honest.
  const v = buildPlaybackOptions({
    detectedPlayers: [], detectedBrowsers: [],
    currentBrowser: 'firefox', showAll: true, inBrowserSupported: true,
  });
  assert.equal(v.groups[0].options[0].text, 'This browser tab');
});

test('"This tab" is disabled with a helpful suffix when MSE missing', () => {
  const v = buildPlaybackOptions({
    detectedPlayers: [], detectedBrowsers: [],
    currentBrowser: '', showAll: false, inBrowserSupported: false,
  });
  assert.equal(v.groups[0].options[0].disabled, true);
  assert.match(v.groups[0].options[0].text, /unsupported/);
});

test('Other-browsers group skips entries matching current browser', () => {
  const v = buildPlaybackOptions({
    detectedPlayers: [],
    detectedBrowsers: [FF, FF_FLATPAK, CHROME],
    currentBrowser: 'firefox',
    showAll: false,
    inBrowserSupported: true,
  });
  // Both firefox entries (system + flatpak) are hidden — UA can't
  // tell them apart, so we hide both not just one.
  const others = v.groups.find(g => g.label === 'Other browsers');
  assert.ok(others, 'an Other browsers group is present');
  assert.equal(others.options.length, 1);
  assert.equal(others.options[0].value, 'browser|google-chrome|system');
  assert.equal(others.options[0].text, 'Google Chrome (system)');
});

test('"Show all" reveals every detected browser install', () => {
  const v = buildPlaybackOptions({
    detectedPlayers: [],
    detectedBrowsers: [FF, FF_FLATPAK, CHROME],
    currentBrowser: 'firefox',
    showAll: true,
    inBrowserSupported: true,
  });
  const others = v.groups.find(g => g.label === 'Other browsers');
  assert.equal(others.options.length, 3);
  assert.deepEqual(
    others.options.map(o => o.value),
    ['browser|firefox|system', 'browser|firefox|flatpak',
     'browser|google-chrome|system']);
});

test('External players group uses external|name|source encoding', () => {
  const v = buildPlaybackOptions({
    detectedPlayers: [VLC, MPV],
    detectedBrowsers: [],
    currentBrowser: '',
    showAll: false,
    inBrowserSupported: true,
  });
  const ext = v.groups.find(g => g.label === 'External players');
  assert.deepEqual(ext.options, [
    { value: 'external|vlc|system', text: 'vlc (system)', disabled: false },
    { value: 'external|mpv|system', text: 'mpv (system)', disabled: false },
  ]);
});

test('Other-browsers / External-players groups omitted when empty', () => {
  const v = buildPlaybackOptions({
    detectedPlayers: [], detectedBrowsers: [],
    currentBrowser: '', showAll: false, inBrowserSupported: true,
  });
  assert.equal(v.groups.length, 1, 'only the "This tab" group');
});

test('No usable target anywhere → hasAnyTarget false + a guidance hint', () => {
  const v = buildPlaybackOptions({
    detectedPlayers: [], detectedBrowsers: [],
    currentBrowser: '', showAll: false, inBrowserSupported: false,
  });
  assert.equal(v.hasAnyTarget, false);
  assert.match(v.hintMessage, /No playback target available/);
});

test('hasAnyTarget true when an external player exists, even if no MSE', () => {
  const v = buildPlaybackOptions({
    detectedPlayers: [VLC], detectedBrowsers: [],
    currentBrowser: '', showAll: false, inBrowserSupported: false,
  });
  assert.equal(v.hasAnyTarget, true);
  assert.equal(v.hintMessage, '');
});

test('hasAnyTarget true when ONLY a non-current detected browser exists', () => {
  const v = buildPlaybackOptions({
    detectedPlayers: [], detectedBrowsers: [CHROME],
    currentBrowser: 'firefox', showAll: false, inBrowserSupported: false,
  });
  assert.equal(v.hasAnyTarget, true);
});

test('zero-arg call defaults to no targets — does not crash', () => {
  const v = buildPlaybackOptions();
  assert.equal(v.hasAnyTarget, false);
  // "This tab" is still there, disabled, with the unsupported tail.
  assert.equal(v.groups[0].options[0].disabled, true);
});
