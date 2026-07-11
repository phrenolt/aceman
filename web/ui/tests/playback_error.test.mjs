// Tests for the pure playback-error classifier (fatal vs. transient).
// Run with `node --test`.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isFatalMpegtsError,
  isFatalVideoError,
  MPEGTS_MEDIA_ERROR,
} from '../domains/playback/lib/playback_error.js';

test('mpegts MediaError is fatal; network/other/unknown are not', () => {
  assert.equal(isFatalMpegtsError('MediaError'), true);
  assert.equal(isFatalMpegtsError(MPEGTS_MEDIA_ERROR), true);
  assert.equal(isFatalMpegtsError('NetworkError'), false);
  assert.equal(isFatalMpegtsError('OtherError'), false);
  assert.equal(isFatalMpegtsError(undefined), false);
});

test('video decode / src-unsupported codes are fatal; abort / network are not', () => {
  assert.equal(isFatalVideoError(3), true);   // MEDIA_ERR_DECODE
  assert.equal(isFatalVideoError(4), true);   // MEDIA_ERR_SRC_NOT_SUPPORTED
  assert.equal(isFatalVideoError(1), false);  // MEDIA_ERR_ABORTED
  assert.equal(isFatalVideoError(2), false);  // MEDIA_ERR_NETWORK
  assert.equal(isFatalVideoError(undefined), false);
});
