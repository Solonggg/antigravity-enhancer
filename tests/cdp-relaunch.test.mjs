/**
 * tests/cdp-relaunch.test.mjs — Antigravity 2.33.0+ CDP Opt-In Detection, M2 Cold-Start Guards & BOM Safety Tests
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NON_HOST_CMD_RE,
  parsePosixEtimeSeconds,
  stripUtf8Bom
} from '../core/shared.mjs';
import { evaluateColdStartDecision } from '../core/daemon/cdp-relaunch.mjs';
import { resolveCdpStatus } from '../core/installer/env.mjs';

test('parsePosixEtimeSeconds parses SS, MM:SS, HH:MM:SS, and D-HH:MM:SS accurately', () => {
  assert.equal(parsePosixEtimeSeconds('09'), 9);
  assert.equal(parsePosixEtimeSeconds('01:25'), 85);
  assert.equal(parsePosixEtimeSeconds('02:03:04'), 7384);
  assert.equal(parsePosixEtimeSeconds('1-00:01:05'), 86465);
  assert.equal(parsePosixEtimeSeconds(''), Infinity);
  assert.equal(parsePosixEtimeSeconds('bad'), Infinity);
});

test('NON_HOST_CMD_RE excludes renderer, utility, crashpad, and sidecar_sdk companion processes', () => {
  assert.equal(
    NON_HOST_CMD_RE.test('/Applications/Antigravity.app/Contents/MacOS/Antigravity'),
    false
  );
  assert.equal(
    NON_HOST_CMD_RE.test('/Applications/Antigravity.app/Contents/MacOS/Antigravity --remote-debugging-port=0'),
    false
  );
  assert.equal(
    NON_HOST_CMD_RE.test(
      '/Applications/Antigravity.app/Contents/Frameworks/Antigravity Helper.app/Contents/MacOS/Antigravity Helper --import=file:///Users/demo/.gemini/antigravity/lib/node_modules/sidecar_sdk/register_loader.js main.mjs'
    ),
    true
  );
  assert.equal(
    NON_HOST_CMD_RE.test('Antigravity.exe --type=renderer --user-data-dir=C:\\Users\\demo'),
    true
  );
  assert.equal(
    NON_HOST_CMD_RE.test('Antigravity.exe --ms-enable-electron-run-as-node main.js'),
    true
  );
});

test('stripUtf8Bom removes leading UTF-8 BOM without altering normal JSON strings', () => {
  const withBom = '\uFEFF{"enabled":true,"preset":"codex-pure-white"}';
  const parsed = JSON.parse(stripUtf8Bom(withBom));
  assert.equal(parsed.enabled, true);
  assert.equal(parsed.preset, 'codex-pure-white');
  assert.equal(stripUtf8Bom('{"ok":1}'), '{"ok":1}');
});

test('evaluateColdStartDecision protects long-running sessions, active WAL writes, and cooldown windows', () => {
  const now = 1_700_000_100_000;

  assert.equal(
    evaluateColdStartDecision({
      proc: { pid: 100, elapsedSec: 3, hasCdpFlag: true, hasUpdatedFlag: false },
      nowMs: now
    }).action,
    'skip'
  );

  assert.equal(
    evaluateColdStartDecision({
      proc: { pid: 101, elapsedSec: 5, hasCdpFlag: false, hasUpdatedFlag: false },
      hasActivePort: true,
      nowMs: now
    }).action,
    'skip'
  );

  // Normal cold start <= 12s -> relaunch
  assert.deepEqual(
    evaluateColdStartDecision({
      proc: { pid: 102, elapsedSec: 6, hasCdpFlag: false, hasUpdatedFlag: false },
      guard: {},
      nowMs: now
    }),
    { action: 'relaunch', reason: 'cold-start-unflagged' }
  );

  // Already running > 12s -> exempt (never kill active user session)
  assert.equal(
    evaluateColdStartDecision({
      proc: { pid: 103, elapsedSec: 18, hasCdpFlag: false, hasUpdatedFlag: false },
      guard: {},
      nowMs: now
    }).action,
    'exempt'
  );

  // Post-update (--updated) allows up to 25s cold start window
  assert.deepEqual(
    evaluateColdStartDecision({
      proc: { pid: 104, elapsedSec: 18, hasCdpFlag: false, hasUpdatedFlag: true },
      guard: {},
      nowMs: now
    }),
    { action: 'relaunch', reason: 'cold-start-post-update' }
  );

  // Active WAL write within 15s -> exempt
  assert.equal(
    evaluateColdStartDecision({
      proc: { pid: 105, elapsedSec: 4, hasCdpFlag: false, hasUpdatedFlag: false },
      hasActiveWal: true,
      guard: {},
      nowMs: now
    }).reason,
    'active-wal-write'
  );

  // Guard cooldown (< 60s) -> exempt
  assert.equal(
    evaluateColdStartDecision({
      proc: { pid: 106, elapsedSec: 4, hasCdpFlag: false, hasUpdatedFlag: false },
      guard: { lastRelaunchAtMs: now - 15000, handledPids: [] },
      nowMs: now
    }).reason,
    'cooldown-active'
  );
});

test('resolveCdpStatus distinguishes ready, missing_opt_in_flag, stale_port_file, and app_not_running', () => {
  assert.equal(
    resolveCdpStatus({
      runningProcesses: [{ pid: 43177, channel: 'stable', hasCdpFlag: false }],
      channels: { stable: { portFileExists: false } },
      portFileExists: false
    }),
    'missing_opt_in_flag'
  );
  assert.equal(
    resolveCdpStatus({
      runningProcesses: [{ pid: 43177, channel: 'stable', hasCdpFlag: true }],
      channels: { stable: { portFileExists: false } },
      portFileExists: false
    }),
    'ready'
  );
  assert.equal(
    resolveCdpStatus({
      runningProcesses: [],
      channels: { stable: { portFileExists: true } },
      portFileExists: true
    }),
    'stale_port_file'
  );
  assert.equal(
    resolveCdpStatus({
      runningProcesses: [],
      channels: { stable: { portFileExists: false } },
      portFileExists: false
    }),
    'app_not_running'
  );
});
