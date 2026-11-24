/**
 * tests/ssh-remote.test.mjs — Unit Tests for HIDS-Clean In-Memory SSH Remote Telemetry Reader
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import {
  MAX_SYNTH_CHECKPOINT_BYTES,
  REMOTE_PY_EXTRACTOR,
  REMOTE_PY_REV,
  REMOTE_SCRIPT_PATH,
  REMOTE_SERVE_CMD,
  REMOTE_DEPLOY_CMD,
  validateSshHost,
  normalizeSshHosts,
  synthesizeCheckpointPayload,
  mergeRemoteSnapshot,
  createVirtualRemoteDb,
  createSshRemoteController
} from '../core/daemon/ssh-remote.mjs';
import { parseCheckpointStepInfo } from '../core/daemon/protobuf.mjs';
import { createMetricsReader } from '../core/daemon/sqlite-metrics.mjs';

function encodeVarint(v) {
  const out = [];
  let n = Math.max(0, Number(v) || 0);
  while (n >= 0x80) {
    out.push((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return Buffer.from(out);
}

function pbVarintField(fn, val) {
  return Buffer.concat([encodeVarint((fn << 3) | 0), encodeVarint(val)]);
}

function pbBytesField(fn, buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf), 'utf8');
  return Buffer.concat([encodeVarint((fn << 3) | 2), encodeVarint(b.length), b]);
}

function buildTestGenRowProto({ inTok = 1000, outTok = 200, cacheRead = 8000, maxCtx = 256000, maxStepIdx = 5, model = 'Gemini 4 Hydrogen' } = {}) {
  const usage = Buffer.concat([
    pbVarintField(2, inTok),
    pbVarintField(3, outTok),
    pbVarintField(5, cacheRead),
    pbVarintField(9, 50),
    pbVarintField(10, 150)
  ]);
  const chatStart = pbBytesField(10, pbVarintField(4, maxCtx));
  const ttft = pbVarintField(1, 1);
  const stream = pbVarintField(1, 1);
  const chat = Buffer.concat([
    pbBytesField(4, usage),
    pbBytesField(9, chatStart),
    pbBytesField(11, ttft),
    pbBytesField(12, stream),
    pbBytesField(21, model)
  ]);
  return Buffer.concat([pbBytesField(1, chat), pbVarintField(2, maxStepIdx)]);
}

function createFakeSshChild(onStdinWrite, onStdinEnd) {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.signals = [];
  child.stdinData = '';
  child.stdin = {
    destroyed: false,
    write(chunk) {
      const s = String(chunk);
      child.stdinData += s;
      if (onStdinWrite) onStdinWrite(child, s);
      return true;
    },
    end(chunk = '') {
      if (chunk) child.stdinData += String(chunk);
      if (onStdinEnd) onStdinEnd(child, child.stdinData);
    },
    destroy() {
      this.destroyed = true;
    }
  };
  child.stdout = new EventEmitter();
  child.stdout.resume = () => {};
  child.stdout.destroy = () => {};
  child.stderr = new EventEmitter();
  child.stderr.resume = () => {};
  child.stderr.destroy = () => {};
  child.kill = (sig = 'SIGTERM') => {
    child.signals.push(sig);
    if (child.exitCode === null) {
      child.exitCode = 0;
      child.signalCode = sig;
      queueMicrotask(() => {
        child.emit('exit', 0, sig);
        child.emit('close', 0, sig);
      });
    }
    return true;
  };
  child.sendStdoutLine = (obj) => {
    const text = typeof obj === 'string' ? obj : JSON.stringify(obj) + '\n';
    child.stdout.emit('data', Buffer.from(text, 'utf8'));
  };
  return child;
}

test('validateSshHost and normalizeSshHosts block leading dashes and metacharacters', () => {
  assert.equal(validateSshHost('node032'), true);
  assert.equal(validateSshHost('dev_user@10.0.0.12'), true);
  assert.equal(validateSshHost('gpu-cluster.internal.example.com'), true);

  assert.equal(validateSshHost('-oProxyCommand=sh'), false);
  assert.equal(validateSshHost('-v'), false);
  assert.equal(validateSshHost('host*'), false);
  assert.equal(validateSshHost('host;rm -rf /'), false);
  assert.equal(validateSshHost('host name'), false);
  assert.equal(validateSshHost(''), false);

  assert.deepEqual(
    normalizeSshHosts([' node032 ', '-oProxyCommand=evil', 'node032', 'user@host-2', 'bad*host']),
    ['node032', 'user@host-2']
  );
  assert.deepEqual(normalizeSshHosts([]), []);
  assert.deepEqual(normalizeSshHosts(null), []);
});

test('remote helper script and SSH commands contain zero HIDS-triggering base64/exec/-c patterns', () => {
  for (const s of [REMOTE_PY_EXTRACTOR, REMOTE_SERVE_CMD, REMOTE_DEPLOY_CMD]) {
    assert.ok(!/base64/i.test(s), 'must not contain base64 keyword');
    assert.ok(!/\bexec\s*\(/i.test(s), 'must not contain exec()');
    assert.ok(!/\beval\s*\(/i.test(s), 'must not contain eval()');
    assert.ok(!/python3?\s+-c\b/i.test(s), 'must not invoke python -c');
    assert.ok(!/\bscp\b/i.test(s), 'must never invoke scp');
  }
  assert.ok(REMOTE_SERVE_CMD.includes(REMOTE_SCRIPT_PATH));
  assert.ok(REMOTE_PY_EXTRACTOR.includes(REMOTE_PY_REV));
});

test('synthesizeCheckpointPayload preserves checkpoint summary byte length without summary text', () => {
  const payload = synthesizeCheckpointPayload(4096);
  const parsed = parseCheckpointStepInfo({
    idx: 12,
    status: 3,
    metadata: null,
    step_payload: payload
  });
  assert.equal(parsed.idx, 12);
  assert.equal(parsed.summaryBytes, 4096);

  assert.equal(synthesizeCheckpointPayload(0), null);
  assert.equal(synthesizeCheckpointPayload(-10), null);
  assert.equal(synthesizeCheckpointPayload(NaN), null);

  const clamped = synthesizeCheckpointPayload(MAX_SYNTH_CHECKPOINT_BYTES * 8);
  const parsedClamped = parseCheckpointStepInfo({
    idx: 13,
    status: 3,
    metadata: null,
    step_payload: clamped
  });
  assert.equal(parsedClamped.summaryBytes, MAX_SYNTH_CHECKPOINT_BYTES);
});

test('mergeRemoteSnapshot and createVirtualRemoteDb integrate with sqlite-metrics in memory (hex & legacy base64)', () => {
  const cid = '5459f7c3-37ab-4473-bf4c-a9977834e627';
  const row0Hex = buildTestGenRowProto({ inTok: 2000, outTok: 300, cacheRead: 18000, maxStepIdx: 3 }).toString('hex');
  const row1Hex = buildTestGenRowProto({ inTok: 1000, outTok: 400, cacheRead: 19000, maxStepIdx: 6 }).toString('hex');

  const snap1 = mergeRemoteSnapshot(null, {
    found: true,
    encoding: 'hex',
    sig: '1700000001:4096|0:0',
    metaStat: { cnt: 1, maxIdx: 0 },
    userStepIdxs: [1],
    lastUserMetaRow: { metadata: null, plen: 42 },
    stepStat: { cnt: 4, maxIdx: 3 },
    lastCpRow: null,
    activeStepRows: [],
    lastModelStepRow: { idx: 3, step_type: 15, status: 3, error_details: null, step_payload: null, metadata: null },
    latestNonUserStep: { idx: 3, step_type: 15, status: 3, error_details: null, step_payload: null, metadata: null },
    lastGenMetaRow: { size: 64, dlen: 64 },
    turnStat: { cnt: 1 },
    startIdx: 0,
    genRows: [{ idx: 0, data: row0Hex }]
  });

  // Incremental delta merge from startIdx = 1
  const snap2 = mergeRemoteSnapshot(snap1, {
    found: true,
    encoding: 'hex',
    sig: '1700000002:8192|0:0',
    metaStat: { cnt: 2, maxIdx: 1 },
    userStepIdxs: [1, 4],
    lastUserMetaRow: { metadata: null, plen: 64 },
    stepStat: { cnt: 7, maxIdx: 6 },
    lastCpRow: null,
    activeStepRows: [],
    lastModelStepRow: { idx: 6, step_type: 15, status: 3, error_details: null, step_payload: null, metadata: null },
    latestNonUserStep: { idx: 6, step_type: 15, status: 3, error_details: null, step_payload: null, metadata: null },
    lastGenMetaRow: { size: 64, dlen: 64 },
    turnStat: { cnt: 1 },
    startIdx: 1,
    genRows: [{ idx: 1, data: row1Hex }]
  });

  assert.equal(snap2.allGenRows.length, 2);

  const reader = createMetricsReader({
    getDatabaseSync: () => null,
    getConfig: () => ({
      manualContextLimit: 0,
      fallbackContextLimit: 256000,
      telemetryLayout: 'compact',
      telemetryCacheMode: 'session'
    })
  });

  const metrics = reader.parseConversationMetrics(cid, '/nonexistent', {
    cacheKey: `ssh://node032/${cid}`,
    rawDbSig: snap2.sig,
    openDb: () => createVirtualRemoteDb(snap2)
  });

  assert.equal(metrics.hasData, true);
  assert.equal(metrics.stats.genIdx, 2);
  assert.equal(metrics.stats.ctx, 20000);
  assert.equal(metrics.stats.outTok, 400);
  assert.equal(metrics.turns.length, 2);
});

test('createSshRemoteController deploys plain-text script once, reuses single persistent SSH worker, and cleans up on disable/stop', async () => {
  const spawnCalls = [];
  const cid = '5459f7c3-37ab-4473-bf4c-a9977834e627';
  const row0Hex = buildTestGenRowProto().toString('hex');
  let deployedContent = '';
  let queryCount = 0;

  const spawnImpl = (cmd, args) => {
    spawnCalls.push({ cmd, args });
    assert.equal(cmd, 'ssh', 'Only ssh should be invoked (never scp)');
    assert.ok(args.includes('--'), 'ssh args must include -- option terminator');
    const remoteCmd = args[args.length - 1];
    assert.ok(!/base64|exec\(|python3?\s+-c/i.test(remoteCmd), 'SSH command must never use base64/exec/-c');

    // 1st call: script not yet deployed -> exits non-zero
    if (spawnCalls.length === 1) {
      assert.equal(remoteCmd, REMOTE_SERVE_CMD);
      const c = createFakeSshChild();
      queueMicrotask(() => {
        c.exitCode = 2;
        c.emit('exit', 2, null);
        c.emit('close', 2, null);
      });
      return c;
    }

    // 2nd call: 1-time plain-text deploy via stdin
    if (spawnCalls.length === 2) {
      assert.equal(remoteCmd, REMOTE_DEPLOY_CMD);
      return createFakeSshChild(null, (c, fullInput) => {
        deployedContent = fullInput;
        queueMicrotask(() => {
          c.exitCode = 0;
          c.emit('exit', 0, null);
          c.emit('close', 0, null);
        });
      });
    }

    // 3rd call: persistent --serve worker handles all subsequent polls
    assert.equal(remoteCmd, REMOTE_SERVE_CMD);
    const workerChild = createFakeSshChild((c, chunk) => {
      const req = JSON.parse(chunk.trim());
      queryCount += 1;
      if (queryCount === 1) {
        c.sendStdoutLine({
          id: req.id,
          found: true,
          encoding: 'hex',
          sig: '1700000001:4096|1700000002:512',
          metaStat: { cnt: 1, maxIdx: 0 },
          userStepIdxs: [1],
          lastUserMetaRow: { metadata: null, plen: 20 },
          stepStat: { cnt: 3, maxIdx: 2 },
          lastCpRow: null,
          activeStepRows: [],
          lastModelStepRow: null,
          latestNonUserStep: null,
          lastGenMetaRow: { size: 48, dlen: 48 },
          turnStat: { cnt: 1 },
          startIdx: 0,
          genRows: [{ idx: 0, data: row0Hex }]
        });
      } else {
        c.sendStdoutLine({
          id: req.id,
          found: true,
          unchanged: true,
          sig: '1700000001:4096|1700000002:512'
        });
      }
    });
    queueMicrotask(() => {
      // Also confirm non-JSON MOTD banner lines are ignored safely before ready handshake
      workerChild.sendStdoutLine('Welcome to corp-dev-host\n');
      workerChild.sendStdoutLine({ ready: true, rev: REMOTE_PY_REV });
    });
    return workerChild;
  };

  const ctrl = createSshRemoteController({ spawnImpl, idleWorkerMs: 60000 });

  // Empty or invalid sshHosts -> zero SSH calls
  assert.equal(ctrl.getRemoteMetricsSource(cid, { sshHosts: [] }), null);
  assert.equal(ctrl.getRemoteMetricsSource(cid, { sshHosts: ['-oProxyCommand=evil'] }), null);
  assert.equal(spawnCalls.length, 0);

  // First poll -> triggers missing check + 1-time plain-text deploy + persistent worker startup
  const first = ctrl.getRemoteMetricsSource(cid, { sshHosts: ['node032'], force: true });
  assert.ok(first?.syncPromise);
  await first.syncPromise;
  assert.equal(spawnCalls.length, 3);
  assert.equal(deployedContent, REMOTE_PY_EXTRACTOR);
  assert.equal(ctrl.getActiveWorkerCount(), 1);

  // Second poll -> reuses the EXISTING persistent SSH worker (zero new SSH process spawned!)
  const second = ctrl.getRemoteMetricsSource(cid, { sshHosts: ['node032'], force: true });
  assert.equal(second?.host, 'node032');
  assert.equal(second?.sig, '1700000001:4096|1700000002:512');
  assert.equal(typeof second?.openDb, 'function');
  if (second?.syncPromise) await second.syncPromise;
  assert.equal(spawnCalls.length, 3, 'subsequent poll must reuse the single persistent SSH worker');
  assert.equal(queryCount, 2);

  // Removing host or disabling sshRemote cleanly closes the persistent worker
  ctrl.syncState({ enabled: true, sshHosts: ['other-host'] });
  assert.equal(ctrl.getActiveWorkerCount(), 0);
  ctrl.stop();
});

test('REMOTE_PY_EXTRACTOR runs cleanly under real python3 --serve, strips prompt text, and feeds sqlite-metrics', async (t) => {
  const pyCheck = spawnSync('python3', ['--version'], { encoding: 'utf8', timeout: 3000 });
  if (pyCheck.status !== 0) {
    t.skip('python3 not installed on test host');
    return;
  }

  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-ssh-py-test-'));
  try {
    const cid = '5459f7c3-37ab-4473-bf4c-a9977834e627';
    const convDir = path.join(tmpHome, '.gemini', 'antigravity', 'conversations');
    const scriptPath = path.join(tmpHome, 'metrics_reader.py');
    fs.mkdirSync(convDir, { recursive: true });
    fs.writeFileSync(scriptPath, REMOTE_PY_EXTRACTOR, 'utf8');

    // Build a real SQLite DB via python3 sqlite3 with a secret prompt string inside unkept field 99
    const dbPath = path.join(convDir, `${cid}.db`);
    const genRowWithSecret = Buffer.concat([
      buildTestGenRowProto({ inTok: 1500, outTok: 250, cacheRead: 12000, maxCtx: 512000, maxStepIdx: 3, model: 'Gemini 4 Neon' }),
      pbBytesField(99, 'TOP_SECRET_USER_PROMPT_MUST_BE_STRIPPED')
    ]).toString('hex');

    const initPy = `
import sqlite3
con = sqlite3.connect(${JSON.stringify(dbPath)})
cur = con.cursor()
cur.execute("CREATE TABLE steps (idx INTEGER PRIMARY KEY, step_type INTEGER, status INTEGER, error_details BLOB, step_payload BLOB, metadata BLOB)")
cur.execute("CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY, size INTEGER, data BLOB)")
cur.execute("INSERT INTO steps VALUES (1, 14, 3, NULL, ?, NULL)", (b"TOP_SECRET_USER_MESSAGE",))
cur.execute("INSERT INTO steps VALUES (3, 15, 3, NULL, ?, NULL)", (b"TOP_SECRET_ASSISTANT_REPLY",))
raw = bytes.fromhex(${JSON.stringify(genRowWithSecret)})
cur.execute("INSERT INTO gen_metadata VALUES (0, ?, ?)", (len(raw), raw))
con.commit()
con.close()
`;
    const seedRes = spawnSync('python3', ['-c', initPy], { encoding: 'utf8', timeout: 5000 });
    assert.equal(seedRes.status, 0, seedRes.stderr);

    const child = spawn('python3', ['-u', scriptPath, '--serve'], {
      env: { ...process.env, HOME: tmpHome },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const lines = [];
    let waiters = [];
    let buf = '';
    child.stdout.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      const parts = buf.split('\n');
      buf = parts.pop() || '';
      for (const p of parts) {
        if (!p.trim()) continue;
        const parsed = JSON.parse(p);
        if (waiters.length > 0) {
          waiters.shift()(parsed);
        } else {
          lines.push(parsed);
        }
      }
    });
    const nextLine = () =>
      lines.length > 0
        ? Promise.resolve(lines.shift())
        : new Promise((resolve) => waiters.push(resolve));

    const readyMsg = await nextLine();
    assert.deepEqual(readyMsg, { ready: true, rev: REMOTE_PY_REV });

    child.stdin.write(JSON.stringify({ id: 1, cid, prev_sig: '', start_idx: 0 }) + '\n');
    const snapJson = await nextLine();
    assert.equal(snapJson.id, 1);
    assert.equal(snapJson.found, true);
    assert.equal(snapJson.encoding, 'hex');
    const serialized = JSON.stringify(snapJson);
    assert.ok(!serialized.includes('TOP_SECRET_USER_PROMPT_MUST_BE_STRIPPED'), 'unkept protobuf text must be stripped');
    assert.ok(!serialized.includes(Buffer.from('TOP_SECRET_USER_PROMPT_MUST_BE_STRIPPED').toString('hex')), 'unkept hex text must be stripped');
    assert.ok(!serialized.includes('TOP_SECRET_USER_MESSAGE'), 'step_payload text must be stripped');

    // Second query with unchanged sig returns fast unchanged response
    child.stdin.write(JSON.stringify({ id: 2, cid, prev_sig: snapJson.sig, start_idx: 0 }) + '\n');
    const unchangedMsg = await nextLine();
    assert.equal(unchangedMsg.id, 2);
    assert.equal(unchangedMsg.unchanged, true);

    // Feed real python3 output into mergeRemoteSnapshot + sqlite-metrics
    const merged = mergeRemoteSnapshot(null, snapJson);
    const reader = createMetricsReader({
      getDatabaseSync: () => null,
      getConfig: () => ({
        manualContextLimit: 0,
        fallbackContextLimit: 256000,
        telemetryLayout: 'compact',
        telemetryCacheMode: 'session'
      })
    });
    const metrics = reader.parseConversationMetrics(cid, '/nonexistent', {
      cacheKey: `ssh://test-host/${cid}`,
      rawDbSig: merged.sig,
      openDb: () => createVirtualRemoteDb(merged)
    });
    assert.equal(metrics.hasData, true);
    assert.equal(metrics.stats.ctx, 13500);
    assert.equal(metrics.stats.outTok, 250);

    // Clean EOF shutdown
    const exitCode = await new Promise((resolve) => {
      child.once('exit', (code) => resolve(code));
      child.stdin.end();
    });
    assert.equal(exitCode, 0);
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});
