/**
 * tests/cdp-target-backoff.test.mjs — Bounded Backoff & Cold-Start Retry Tests for Skipped CDP Targets
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SKIPPED_TARGET_BACKOFF_MS,
  getNextSkippedTargetEntry,
  isSkippedTargetCoolingDown
} from '../core/daemon/cdp-bridge.mjs';

test('getNextSkippedTargetEntry backs off 4s -> 10s -> 25s and exhausts genuine non-host targets', () => {
  const origin = 'http://127.0.0.1:49152';
  let entry = null;
  let t = 1_000_000;

  for (let i = 0; i < SKIPPED_TARGET_BACKOFF_MS.length; i++) {
    entry = getNextSkippedTargetEntry(entry, { origin, nowMs: t, timedOut: false });
    assert.equal(entry.attempts, i + 1);
    assert.equal(entry.exhausted, false);
    assert.equal(entry.nextRetryAtMs, t + SKIPPED_TARGET_BACKOFF_MS[i]);
    assert.equal(isSkippedTargetCoolingDown(entry, origin, t + SKIPPED_TARGET_BACKOFF_MS[i] - 1), true);
    assert.equal(isSkippedTargetCoolingDown(entry, origin, t + SKIPPED_TARGET_BACKOFF_MS[i]), false);
    t = entry.nextRetryAtMs;
  }

  // 4th consecutive confirmed non-host probe stops infinite retries for the same origin
  entry = getNextSkippedTargetEntry(entry, { origin, nowMs: t, timedOut: false });
  assert.equal(entry.exhausted, true);
  assert.equal(isSkippedTargetCoolingDown(entry, origin, t + 60 * 60 * 1000), true);

  // Origin navigation immediately clears cooldown
  assert.equal(isSkippedTargetCoolingDown(entry, 'http://127.0.0.1:49999', t), false);
});

test('Transient Runtime.evaluate timeouts retry quickly without exhausting non-host retry budget', () => {
  const origin = 'http://127.0.0.1:49152';
  let entry = null;
  let t = 2_000_000;

  for (let i = 0; i < 4; i++) {
    entry = getNextSkippedTargetEntry(entry, { origin, nowMs: t, timedOut: true });
    assert.equal(entry.exhausted, false);
    assert.equal(entry.attempts, 0);
    assert.equal(entry.timeoutCount, i + 1);
    const expectedDelay = i < 3 ? 3000 : 12000;
    assert.equal(entry.nextRetryAtMs, t + expectedDelay);
    assert.equal(isSkippedTargetCoolingDown(entry, origin, t + expectedDelay - 1), true);
    assert.equal(isSkippedTargetCoolingDown(entry, origin, t + expectedDelay), false);
    t = entry.nextRetryAtMs;
  }
});
