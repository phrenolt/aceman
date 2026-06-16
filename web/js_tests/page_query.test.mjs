// Tests for the page-query helpers.
//
// extractPlayCid is a trust boundary: any other origin's redirect
// or the user's own bookmark can stuff arbitrary text into the
// `play` query parameter. We MUST never lift the raw value into
// play() — every test here pins down a class of bogus input that
// must collapse to null.

import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPlayCid } from '../js/lib/page_query.js';

const CID = 'a'.repeat(40);

test('extracts a valid 40-hex cid', () => {
  assert.equal(extractPlayCid(`?play=${CID}`), CID);
});

test('lowercases an uppercase cid', () => {
  assert.equal(extractPlayCid(`?play=${CID.toUpperCase()}`), CID);
});

test('returns null when the param is missing', () => {
  assert.equal(extractPlayCid('?foo=bar'), null);
  assert.equal(extractPlayCid('?play='), null);
  assert.equal(extractPlayCid(''), null);
});

test('rejects non-hex characters', () => {
  assert.equal(extractPlayCid(`?play=${'z'.repeat(40)}`), null);
  assert.equal(extractPlayCid(`?play=${CID.slice(0, 39)}g`), null);
});

test('rejects wrong-length tokens', () => {
  assert.equal(extractPlayCid(`?play=${'a'.repeat(39)}`), null);
  assert.equal(extractPlayCid(`?play=${'a'.repeat(41)}`), null);
});

test('rejects acestream:// scheme injection attempts', () => {
  // The cid parser strips `acestream://`, so a value like
  // `acestream://aa…aa/extra` would still be rejected on length —
  // pin that.
  assert.equal(extractPlayCid('?play=acestream://' + CID + '/extra'), null);
});

test('rejects javascript: and other URL-shaped values', () => {
  assert.equal(extractPlayCid('?play=javascript:alert(1)'), null);
  assert.equal(extractPlayCid('?play=http://evil/' + CID), null);
});

test('returns null for non-string input (no crash)', () => {
  assert.equal(extractPlayCid(null), null);
  assert.equal(extractPlayCid(undefined), null);
  assert.equal(extractPlayCid(42), null);
});

test('honors only the first `play=` when duplicated', () => {
  // URLSearchParams.get() returns the first value when a key
  // appears more than once. Confirm the policy: we don't accidentally
  // race the values or pick the more-permissive one.
  assert.equal(
    extractPlayCid(`?play=${CID}&play=${'b'.repeat(40)}`),
    CID);
});

test('tolerates extra unrelated params around the cid', () => {
  assert.equal(extractPlayCid(`?foo=1&play=${CID}&bar=2`), CID);
});
