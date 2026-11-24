/**
 * tests/cdp-relaunch.test.mjs — Antigravity 2.33.0+ CDP Opt-In Detection, M2 Cold-Start Guards & BOM Safety Tests
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  NON_HOST_CMD_RE,
  parsePosixEtimeSeconds,
  stripUtf8Bom
} from '../core/shared.mjs';
import { evaluateColdStartDecision, isActiveWalForProcess } from '../core/daemon/cdp-relaunch.mjs';
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

  // Guard cooldown (< 60s when previous relaunch never attached CDP) -> exempt
  assert.equal(
    evaluateColdStartDecision({
      proc: { pid: 106, elapsedSec: 4, hasCdpFlag: false, hasUpdatedFlag: false },
      guard: { lastRelaunchAtMs: now - 15000, handledPids: [] },
      nowMs: now
    }).reason,
    'cooldown-active'
  );

  // Consecutive user restart after previous relaunch succeeded (lastAttachedAtMs >= lastRelaunchAtMs) -> relaunch immediately after 3s debounce!
  assert.deepEqual(
    evaluateColdStartDecision({
      proc: { pid: 107, elapsedSec: 2, hasCdpFlag: false, hasUpdatedFlag: false },
      guard: { lastRelaunchAtMs: now - 15000, lastAttachedAtMs: now - 12000, handledPids: [106] },
      nowMs: now
    }),
    { action: 'relaunch', reason: 'cold-start-unflagged' }
  );

  // Tiny 3s debounce still guards against duplicate trigger on the same launch
  assert.equal(
    evaluateColdStartDecision({
      proc: { pid: 108, elapsedSec: 1, hasCdpFlag: false, hasUpdatedFlag: false },
      guard: { lastRelaunchAtMs: now - 1500, lastAttachedAtMs: now - 500, handledPids: [] },
      nowMs: now
    }).reason,
    'cooldown-active'
  );
});

test('isActiveWalForProcess ignores stale WAL flushed by previous closed session while protecting active generation', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-wal-guard-'));
  try {
    const walFile = path.join(tmpDir, '58b8db37-d172-4d42-b1dd-19915dba962e.db-wal');
    fs.writeFileSync(walFile, Buffer.alloc(8192, 1));
    const nowMs = Date.now();

    // Case 1: WAL was flushed 3s ago by previous Antigravity on Cmd+Q; new Antigravity started 2s ago -> NOT active!
    const prevQuitTime = new Date(nowMs - 3000);
    fs.utimesSync(walFile, prevQuitTime, prevQuitTime);
    assert.equal(
      isActiveWalForProcess(tmpDir, { windowSec: 15, procElapsedSec: 2, nowMs }),
      false
    );

    // Case 2: New Antigravity started 6s ago; WAL was flushed 8s ago (before boot) -> NOT active!
    const beforeBootTime = new Date(nowMs - 8000);
    fs.utimesSync(walFile, beforeBootTime, beforeBootTime);
    assert.equal(
      isActiveWalForProcess(tmpDir, { windowSec: 15, procElapsedSec: 6, nowMs }),
      false
    );

    // Case 3: Antigravity started 10s ago and WAL was actively written 1s ago (after boot + 2.5s) -> ACTIVE!
    const activeGenTime = new Date(nowMs - 1000);
    fs.utimesSync(walFile, activeGenTime, activeGenTime);
    assert.equal(
      isActiveWalForProcess(tmpDir, { windowSec: 15, procElapsedSec: 10, nowMs }),
      true
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
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
