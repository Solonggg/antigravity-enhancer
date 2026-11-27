/**
 * tests/auto-refresh.test.mjs — Unit tests for reliable auto-refresh across SQLite/WAL,
 * CDP bridge ACK/parsing, Official Quota SWR + Redux store subscription, and runtime triggers.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import {
  isSqliteBusyError,
  isSqliteDbReadyForRead,
  getDbSignature,
  createMetricsReader
} from '../core/daemon/sqlite-metrics.mjs';
import {
  parseCascadeIdList,
  parseMetricsRequestPayload,
  shouldAcceptMetricsDelivery
} from '../core/daemon/cdp-bridge.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

function encodeVarint(num) {
  const bytes = [];
  let n = BigInt(num);
  while (n >= 0x80n) {
    bytes.push(Number((n & 0x7fn) | 0x80n));
    n >>= 7n;
  }
  bytes.push(Number(n));
  return Buffer.from(bytes);
}

function fieldVarint(fn, val) {
  return Buffer.concat([encodeVarint((fn << 3) | 0), encodeVarint(val)]);
}

function fieldBytes(fn, bufOrStr) {
  const buf = Buffer.isBuffer(bufOrStr) ? bufOrStr : Buffer.from(String(bufOrStr), 'utf8');
  return Buffer.concat([encodeVarint((fn << 3) | 2), encodeVarint(buf.length), buf]);
}

function makeSampleGenData(inTok, outTok, cacheRead, stepIdx) {
  const usage = Buffer.concat([
    fieldVarint(2, inTok),
    fieldVarint(3, outTok),
    fieldVarint(5, cacheRead),
    fieldVarint(9, Math.floor(outTok / 3)),
    fieldVarint(10, outTok - Math.floor(outTok / 3))
  ]);
  const ctxMeta = fieldVarint(4, 512000);
  const chatStart = fieldBytes(10, ctxMeta);
  const ttft = Buffer.concat([fieldVarint(1, 1), fieldVarint(2, 0)]);
  const stream = Buffer.concat([fieldVarint(1, 2), fieldVarint(2, 0)]);
  const chat = Buffer.concat([
    fieldBytes(4, usage),
    fieldBytes(9, chatStart),
    fieldBytes(11, ttft),
    fieldBytes(12, stream),
    fieldBytes(21, 'Gemini 4 Neon')
  ]);
  return Buffer.concat([fieldBytes(1, chat), fieldVarint(2, stepIdx)]);
}

function makeFakeSqliteHeader({
  magic = 'SQLite format 3\0',
  writeVersion = 2,
  readVersion = 2,
  pageCount = 2,
  schemaCookie = 1,
  totalBytes = 4096
} = {}) {
  const buf = Buffer.alloc(totalBytes, 0);
  Buffer.from(magic, 'latin1').copy(buf, 0);
  buf[18] = writeVersion;
  buf[19] = readVersion;
  buf.writeUInt32BE(pageCount, 28);
  buf.writeUInt32BE(schemaCookie, 40);
  return buf;
}

// ============================================================================
// 1. SQLite / WAL readiness, 0-byte WAL signature stability & bypassCache
// ============================================================================

test('isSqliteDbReadyForRead validates header, journal lock, and WAL schema commit state', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-sqlite-ready-'));
  try {
    const smallDb = path.join(tmpDir, 'small.db');
    fs.writeFileSync(smallDb, makeFakeSqliteHeader({ totalBytes: 512 }));
    assert.equal(isSqliteDbReadyForRead(smallDb), false, '<4096B file must not be treated as ready');

    const badMagicDb = path.join(tmpDir, 'bad.db');
    fs.writeFileSync(badMagicDb, makeFakeSqliteHeader({ magic: 'NotSQLiteHeader!' }));
    assert.equal(isSqliteDbReadyForRead(badMagicDb), false, 'invalid SQLite magic must be rejected');

    const journalDb = path.join(tmpDir, 'journal.db');
    fs.writeFileSync(journalDb, makeFakeSqliteHeader({ pageCount: 3, schemaCookie: 2 }));
    fs.writeFileSync(`${journalDb}-journal`, Buffer.alloc(64, 1));
    assert.equal(isSqliteDbReadyForRead(journalDb), false, 'active rollback journal must defer read');
    fs.unlinkSync(`${journalDb}-journal`);
    assert.equal(isSqliteDbReadyForRead(journalDb), true, 'committed WAL DB becomes ready once journal clears');

    const uninitWalDb = path.join(tmpDir, 'uninit-wal.db');
    fs.writeFileSync(uninitWalDb, makeFakeSqliteHeader({ pageCount: 1, schemaCookie: 0 }));
    fs.writeFileSync(`${uninitWalDb}-wal`, Buffer.alloc(32, 0));
    assert.equal(isSqliteDbReadyForRead(uninitWalDb), false, 'WAL DB with empty WAL and schemaCookie=0 is not ready');
    fs.writeFileSync(`${uninitWalDb}-wal`, Buffer.alloc(128, 1));
    assert.equal(isSqliteDbReadyForRead(uninitWalDb), true, 'WAL DB with committed WAL frames (>32B) is ready');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('getDbSignature ignores mtime churn on 0-byte .db-wal files and detects real WAL growth', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-wal-sig-'));
  const cid = '11111111-2222-3333-4444-555555555555';
  const dbPath = path.join(tmpDir, `${cid}.db`);
  const walPath = `${dbPath}-wal`;
  try {
    fs.writeFileSync(dbPath, makeFakeSqliteHeader());
    fs.writeFileSync(walPath, Buffer.alloc(0));
    fs.utimesSync(walPath, new Date(1700000000000), new Date(1700000000000));
    const sig1 = getDbSignature(cid, tmpDir);

    // Simulate read-only SQLite open bumping mtime on an empty 0-byte WAL file
    fs.utimesSync(walPath, new Date(1700000060000), new Date(1700000060000));
    const sig2 = getDbSignature(cid, tmpDir);
    assert.equal(sig2, sig1, '0-byte WAL mtime bump must not invalidate signature');

    // Write actual WAL frame bytes -> signature must change
    fs.writeFileSync(walPath, Buffer.alloc(4128, 7));
    const sig3 = getDbSignature(cid, tmpDir);
    assert.notEqual(sig3, sig1, 'non-empty WAL growth must change signature');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('parseConversationMetrics bypassCache detects WAL/stat-frozen updates, short-circuits unchanged content, and retries SQLITE_BUSY', () => {
  const cid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const genRows = [{ idx: 0, data: makeSampleGenData(1000, 200, 9000, 2) }];
  const stepRows = [
    { idx: 1, step_type: 14, status: 3, metadata: null, step_payload: Buffer.from('hi'), error_details: null },
    { idx: 2, step_type: 15, status: 3, metadata: null, step_payload: Buffer.from('ok'), error_details: null }
  ];
  let openCount = 0;
  let fullGenQueryCount = 0;
  let failBusyOnce = false;

  const makeMockDb = () => {
    openCount++;
    if (failBusyOnce) {
      failBusyOnce = false;
      const err = new Error('database is locked');
      err.code = 'SQLITE_BUSY';
      throw err;
    }
    return {
      close() {},
      prepare(sql) {
        return {
          get(...params) {
            if (sql.includes('FROM gen_metadata') && sql.includes('COUNT(*)')) {
              return { cnt: genRows.length, maxIdx: genRows.length ? genRows[genRows.length - 1].idx : -1 };
            }
            if (sql.includes('SELECT size, length(data)')) {
              const target = genRows.find((r) => r.idx === params[0]);
              return target ? { size: target.data.length, dlen: target.data.length } : null;
            }
            if (sql.includes('SELECT metadata, length(step_payload)')) {
              const target = stepRows.find((r) => r.idx === params[0]);
              return target ? { metadata: target.metadata, plen: target.step_payload.length } : null;
            }
            if (sql.includes('FROM steps') && sql.includes('COUNT(*)') && !sql.includes('step_type = 15')) {
              return { cnt: stepRows.length, maxIdx: stepRows.length ? stepRows[stepRows.length - 1].idx : -1 };
            }
            if (sql.includes('step_type = 23')) return null;
            if (sql.includes('step_type IN (15, 17, 23)')) {
              const found = [...stepRows].reverse().find((r) => [15, 17, 23].includes(r.step_type));
              return found || null;
            }
            if (sql.includes('step_type != 14')) {
              const found = [...stepRows].reverse().find((r) => r.step_type !== 14);
              return found || null;
            }
            if (sql.includes('step_type = 15 AND idx >')) {
              return { cnt: stepRows.filter((r) => r.step_type === 15 && r.idx > params[0]).length };
            }
            return null;
          },
          all(...params) {
            if (sql.includes('step_type = 14')) {
              return stepRows.filter((r) => r.step_type === 14).map((r) => ({ idx: r.idx }));
            }
            if (sql.includes('status IN (1, 2, 8, 9, 11)')) {
              return stepRows.filter((r) => [1, 2, 8, 9, 11].includes(r.status));
            }
            if (sql.includes('FROM gen_metadata WHERE idx >=')) {
              fullGenQueryCount++;
              return genRows.filter((r) => r.idx >= params[0]);
            }
            if (sql.includes('SELECT idx, data FROM gen_metadata ORDER BY')) {
              fullGenQueryCount++;
              return genRows.slice();
            }
            return [];
          }
        };
      }
    };
  };

  const reader = createMetricsReader({
    getDatabaseSync: () => null,
    getConfig: () => ({ telemetryLayout: 'compact', telemetryCacheMode: 'session', modules: { usageStats: true, sessionStatus: true } })
  });

  const baseOpts = { cacheKey: `/mock/${cid}.db`, rawDbSig: '1000:4096|2000:4128', openDb: makeMockDb };
  const first = reader.parseConversationMetrics(cid, '/mock', baseOpts);
  assert.equal(first.hasData, true);
  assert.equal(first.status.totalGenerations, 1);
  assert.ok(first.dataSig);
  assert.equal(openCount, 1);
  assert.equal(fullGenQueryCount, 1);

  // bypassCache with unchanged content short-circuits before delta/full gen_metadata row decoding
  const unchanged = reader.parseConversationMetrics(cid, '/mock', { ...baseOpts, bypassCache: true });
  assert.equal(unchanged, first, 'unchanged content under bypassCache should return cached payload');
  assert.equal(openCount, 2);
  assert.equal(fullGenQueryCount, 1, 'unchanged content must skip gen_metadata row decode');

  // Append a new generation row WITHOUT changing rawDbSig (simulates WAL frame reuse / NTFS stale stat)
  genRows.push({ idx: 1, data: makeSampleGenData(1500, 400, 12000, 3) });
  stepRows.push({ idx: 3, step_type: 15, status: 3, metadata: null, step_payload: Buffer.from('ok2'), error_details: null });

  const staleHit = reader.parseConversationMetrics(cid, '/mock', baseOpts);
  assert.equal(staleHit.status.totalGenerations, 1, 'non-bypass call hits stat cache when rawDbSig unchanged');

  // Now simulate transient SQLITE_BUSY on first attempt during bypassCache refresh
  failBusyOnce = true;
  assert.equal(isSqliteBusyError(new Error('SQLITE_BUSY: database is locked')), true);
  const refreshed = reader.parseConversationMetrics(cid, '/mock', { ...baseOpts, bypassCache: true });
  assert.equal(refreshed.hasData, true);
  assert.equal(refreshed.status.totalGenerations, 2, 'bypassCache must detect new rows and recover from single SQLITE_BUSY');
  assert.notEqual(refreshed.dataSig, first.dataSig);
});

// ============================================================================
// 2. CDP Bridge request payload parsing & ACK verification
// ============================================================================

test('parseMetricsRequestPayload handles legacy CSV and structured JSON payloads', () => {
  const id1 = '11111111-1111-4111-8111-111111111111';
  const id2 = '22222222-2222-4222-8222-222222222222';

  assert.deepEqual(parseCascadeIdList(`${id1}, invalid, ${id2}, ${id1}`), [id1, id2]);

  const legacy = parseMetricsRequestPayload(`${id1},${id2}`);
  assert.deepEqual(legacy, { cids: [id1, id2], force: true, bypassCache: true, reason: 'route' });

  const jsonReq = parseMetricsRequestPayload(
    JSON.stringify({ cids: [id1], force: false, bypassCache: true, reason: 'step_progress' })
  );
  assert.deepEqual(jsonReq, { cids: [id1], force: false, bypassCache: true, reason: 'step_progress' });

  const jsonDefaultForce = parseMetricsRequestPayload(JSON.stringify({ cids: [id2], reason: 'turn_done' }));
  assert.deepEqual(jsonDefaultForce, { cids: [id2], force: true, bypassCache: true, reason: 'turn_done' });
});

test('shouldAcceptMetricsDelivery accepts only explicit applied:true ACK results', () => {
  assert.equal(shouldAcceptMetricsDelivery({ result: { result: { value: { applied: true, cid: 'x' } } } }), true);
  assert.equal(shouldAcceptMetricsDelivery({ result: { result: { value: { applied: false, reason: 'not_watched' } } } }), false);
  assert.equal(shouldAcceptMetricsDelivery({ result: { result: { value: null } } }), false);
  assert.equal(shouldAcceptMetricsDelivery({ result: { exceptionDetails: { text: 'Uncaught' } } }), false);
  assert.equal(shouldAcceptMetricsDelivery({ error: { message: 'timeout' } }), false);
  assert.equal(shouldAcceptMetricsDelivery(null), false);
});

// ============================================================================
// 3. Official Quota SWR auto-refresh, failure cooldown & Redux store listener
// ============================================================================

test('loadOfficialQuotaSummary supports SWR forceRefresh, dirty/reset triggers, 5s error cooldown, and Redux store subscription', async () => {
  const probeCode = fs.readFileSync(path.join(ROOT_DIR, 'core', 'runtime', '30-antigravity-probe.js'), 'utf8');
  let nowMs = Date.UTC(2026, 10, 27, 10, 0, 0);
  const rpcCalls = [];
  let nextRpcImpl = async () => ({
    groups: [
      {
        displayName: 'Gemini Models',
        buckets: [
          {
            bucketId: 'b5h',
            displayName: '5h',
            window: '5h',
            remaining: { case: 'remainingFraction', value: 0.9 },
            resetTime: { seconds: Math.floor((nowMs + 3600 * 1000) / 1000), nanos: 0 }
          }
        ]
      }
    ]
  });

  const listeners = new Set();
  let reduxState = {
    modelQuotaApi: { queries: { q1: { data: { groups: [] } } } },
    credits: { availableCredits: 100, useAICredits: false },
    userStatus: { userTier: { description: 'Pro' } }
  };
  const fakeStore = {
    getState: () => reduxState,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }
  };
  const fakeCloudCodeService = {
    retrieveUserQuotaSummary: (force) => {
      rpcCalls.push(Boolean(force));
      return nextRpcImpl(force);
    }
  };

  const fakeScopeEl = {
    __reactFiber$test: {
      memoizedProps: { value: { core: { cloudCodeService: fakeCloudCodeService }, store: fakeStore } },
      return: null
    }
  };

  const FakeDate = class extends Date {
    static now() {
      return nowMs;
    }
  };
  const fakeWindow = {};
  const fakeDocument = {
    getElementById: () => fakeScopeEl,
    querySelector: () => fakeScopeEl,
    body: { firstElementChild: fakeScopeEl }
  };
  const sandbox = {
    window: fakeWindow,
    document: fakeDocument,
    Date: FakeDate,
    SELECTORS: { inputBoxId: 'antigravity.agentSidePanelInputBox' }
  };
  vm.runInNewContext(
    `${probeCode}\nglobalThis.__exports = { loadOfficialQuotaSummary, markOfficialQuotaDirty, getOfficialQuotaState, subscribeOfficialQuotaStore, hasExpiredQuotaResetWindow };`,
    sandbox
  );
  const {
    loadOfficialQuotaSummary,
    markOfficialQuotaDirty,
    getOfficialQuotaState,
    subscribeOfficialQuotaStore
  } = sandbox.__exports;

  // 1) Initial load forces upstream fetch since cache has never been force-fetched
  const r1 = await loadOfficialQuotaSummary({ scopeEl: fakeScopeEl, isZh: true });
  assert.equal(r1.ok, true);
  assert.equal(r1.groups[0].buckets[0].remainingPct, 90);
  assert.deepEqual(rpcCalls, [true]);

  // 2) Within 30s TTL and not dirty -> returns cache with 0 RPC calls
  nowMs += 10_000;
  const r2 = await loadOfficialQuotaSummary({ scopeEl: fakeScopeEl, isZh: true });
  assert.equal(r2.cached, true);
  assert.deepEqual(rpcCalls, [true]);

  // 3) After markOfficialQuotaDirty -> triggers upstream forceRefresh=true
  nextRpcImpl = async () => ({
    groups: [
      {
        displayName: 'Gemini Models',
        buckets: [
          {
            bucketId: 'b5h',
            displayName: '5h',
            window: '5h',
            remaining: { case: 'remainingFraction', value: 0.84 },
            resetTime: { seconds: Math.floor((nowMs + 20_000) / 1000), nanos: 0 }
          }
        ]
      }
    ]
  });
  markOfficialQuotaDirty();
  const r3 = await loadOfficialQuotaSummary({ scopeEl: fakeScopeEl, isZh: true });
  assert.equal(r3.groups[0].buckets[0].remainingPct, 84);
  assert.equal(getOfficialQuotaState().dirty, false);
  assert.deepEqual(rpcCalls, [true, true]);

  // 4) Reset window expires (20s later, still < 30s TTL) -> triggers upstream forceRefresh=true
  nowMs += 21_000;
  nextRpcImpl = async () => {
    throw new Error('RPC unavailable');
  };
  const r4 = await loadOfficialQuotaSummary({ scopeEl: fakeScopeEl, isZh: true });
  assert.equal(r4.ok, true, 'failure must preserve last valid cached quota groups');
  assert.equal(r4.isStale, true);
  assert.equal(r4.refreshFailed, true);
  assert.equal(r4.groups[0].buckets[0].remainingPct, 84);
  assert.deepEqual(rpcCalls, [true, true, true]);

  // 5) Within 5s cooldown after failure -> skips RPC and keeps returning stale cache
  nowMs += 2_000;
  const r5 = await loadOfficialQuotaSummary({ scopeEl: fakeScopeEl, isZh: true });
  assert.equal(r5.isStale, true);
  assert.equal(r5.refreshFailed, true);
  assert.deepEqual(rpcCalls, [true, true, true]);

  // 6) Manual forceRefresh=true bypasses 5s failure cooldown
  nextRpcImpl = async () => ({
    groups: [
      {
        displayName: 'Gemini Models',
        buckets: [
          {
            bucketId: 'b5h',
            displayName: '5h',
            window: '5h',
            remaining: { case: 'remainingFraction', value: 1.0 },
            resetTime: { seconds: Math.floor((nowMs + 5 * 3600 * 1000) / 1000), nanos: 0 }
          }
        ]
      }
    ]
  });
  const r6 = await loadOfficialQuotaSummary({ forceRefresh: true, scopeEl: fakeScopeEl, isZh: true });
  assert.equal(r6.isStale, false);
  assert.equal(r6.groups[0].buckets[0].remainingPct, 100);
  assert.deepEqual(rpcCalls, [true, true, true, true]);

  // 7) Redux store subscription pushes zero-API updates immediately when modelQuotaApi.queries changes
  const storeUpdates = [];
  const unsub = subscribeOfficialQuotaStore((entry) => storeUpdates.push(entry), fakeScopeEl);
  assert.equal(typeof unsub, 'function');

  // Unrelated Redux dispatch must be ignored
  for (const fn of listeners) fn();
  assert.equal(storeUpdates.length, 0);

  // Quota query update triggers callback immediately
  reduxState = {
    ...reduxState,
    modelQuotaApi: {
      queries: {
        q2: {
          data: {
            groups: [
              {
                displayName: 'Gemini Models',
                buckets: [
                  {
                    bucketId: 'b5h',
                    displayName: '5h',
                    window: '5h',
                    remaining: { case: 'remainingFraction', value: 0.77 },
                    resetTime: { seconds: Math.floor((nowMs + 4 * 3600 * 1000) / 1000), nanos: 0 }
                  }
                ]
              }
            ]
          }
        }
      }
    }
  };
  for (const fn of listeners) fn();
  assert.equal(storeUpdates.length, 1);
  assert.equal(storeUpdates[0].rawGroups[0].buckets[0].remaining.value, 0.77);
  unsub();
});

// ============================================================================
// 4. Runtime auto-refresh triggers, multi-view resolution, ACK & partial tooltip update
// ============================================================================

class MiniClassList {
  constructor(el) {
    this.el = el;
  }
  _list() {
    return String(this.el.className || '').trim().split(/\s+/).filter(Boolean);
  }
  contains(c) {
    return this._list().includes(c);
  }
  add(...names) {
    const s = new Set(this._list());
    for (const n of names) if (n) s.add(n);
    this.el.className = Array.from(s).join(' ');
  }
  remove(...names) {
    const rm = new Set(names);
    this.el.className = this._list().filter((c) => !rm.has(c)).join(' ');
  }
}

class MiniElement {
  constructor(tag, opts = {}) {
    this.nodeType = 1;
    this.tagName = String(tag || 'DIV').toUpperCase();
    this.id = opts.id || '';
    this.className = opts.className || '';
    this.attrs = new Map(Object.entries(opts.attrs || {}));
    if (this.id) this.attrs.set('id', this.id);
    this.children = [];
    this.parentElement = null;
    this.parentNode = null;
    this.style = { display: '' };
    this._computedStyle = Object.assign({ display: 'block', flexDirection: 'row' }, opts.computedStyle || {});
    this._width = typeof opts.width === 'number' ? opts.width : 760;
    this._height = typeof opts.height === 'number' ? opts.height : 28;
    this._innerHTML = '';
    this.scrollTop = 0;
    this.scrollWidth = opts.scrollWidth || 0;
    this.textContent = opts.textContent || '';
    this.classList = new MiniClassList(this);
  }
  get isConnected() {
    let cur = this;
    while (cur) {
      if (cur._isRoot) return true;
      cur = cur.parentElement;
    }
    return false;
  }
  get firstElementChild() { return this.children[0] || null; }
  get nextElementSibling() {
    if (!this.parentElement) return null;
    const i = this.parentElement.children.indexOf(this);
    return i >= 0 ? this.parentElement.children[i + 1] || null : null;
  }
  get nextSibling() { return this.nextElementSibling; }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(html) {
    this._innerHTML = String(html || '');
    if (this.id === 'ag-live-metrics-pill' || this.classList.contains('ag-live-metrics-pill')) {
      if (!this.children.some((c) => c.classList.contains('ag-live-metrics-text')) && this._innerHTML.includes('ag-live-metrics-text')) {
        this.appendChild(new MiniElement('SPAN', { id: 'ag-live-metrics-text', className: 'ag-live-metrics-text', scrollWidth: 180 }));
      }
    }
    // Lightweight structure parser for two-column usage/quota tooltip tests
    if (this._innerHTML.includes('ag-tt-col-usage') && this._innerHTML.includes('ag-tt-col-quota')) {
      this.children = [];
      const mUsage = this._innerHTML.match(/<div class="ag-tt-col-usage">([\s\S]*?)<\/div>/);
      const usageEl = new MiniElement('DIV', { className: 'ag-tt-col-usage' });
      usageEl._innerHTML = mUsage ? mUsage[1] : '';
      const quotaEl = new MiniElement('DIV', { className: 'ag-tt-col-quota', attrs: { 'data-ag-quota-slot': '1' } });
      this.appendChild(usageEl);
      this.appendChild(quotaEl);
    }
  }
  appendChild(ch) {
    if (ch.parentElement) ch.parentElement.removeChild(ch);
    ch.parentElement = this;
    ch.parentNode = this;
    this.children.push(ch);
    return ch;
  }
  insertBefore(ch, ref) {
    if (ch.parentElement) ch.parentElement.removeChild(ch);
    ch.parentElement = this;
    ch.parentNode = this;
    const idx = ref ? this.children.indexOf(ref) : -1;
    if (idx === -1) this.children.push(ch);
    else this.children.splice(idx, 0, ch);
    return ch;
  }
  removeChild(ch) {
    const idx = this.children.indexOf(ch);
    if (idx !== -1) this.children.splice(idx, 1);
    ch.parentElement = null;
    ch.parentNode = null;
    return ch;
  }
  remove() { if (this.parentElement) this.parentElement.removeChild(this); }
  contains(target) {
    let cur = target;
    while (cur) {
      if (cur === this) return true;
      cur = cur.parentElement;
    }
    return false;
  }
  setAttribute(k, v) {
    const val = String(v);
    this.attrs.set(k, val);
    if (k === 'id') this.id = val;
    if (k === 'class') this.className = val;
  }
  getAttribute(k) {
    if (k === 'id') return this.id || null;
    if (k === 'class') return this.className || null;
    return this.attrs.has(k) ? this.attrs.get(k) : null;
  }
  hasAttribute(k) { return this.getAttribute(k) !== null; }
  removeAttribute(k) { this.attrs.delete(k); }
  addEventListener() {}
  removeEventListener() {}
  getBoundingClientRect() {
    return { width: this._width, height: this._height, top: 400, bottom: 400 + this._height, left: 0, right: this._width };
  }
  matches(selector) {
    for (const raw of String(selector || '').split(',')) {
      const sel = raw.trim();
      if (!sel) continue;
      // Support compound [attr1="v1"][attr2] selectors
      if (sel.startsWith('[')) {
        const attrRe = /\[([^\]=]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/g;
        let ok = true;
        let matchedAny = false;
        let m;
        while ((m = attrRe.exec(sel))) {
          matchedAny = true;
          const k = m[1].trim();
          const expected = m[2] ?? m[3] ?? m[4];
          if (expected === undefined) {
            if (!this.hasAttribute(k)) { ok = false; break; }
          } else if (this.getAttribute(k) !== expected) {
            ok = false; break;
          }
        }
        if (matchedAny && ok) return true;
      } else if (sel.startsWith('.')) {
        if (this.classList.contains(sel.slice(1))) return true;
      } else if (sel.startsWith('#')) {
        if (this.id === sel.slice(1)) return true;
      }
    }
    return false;
  }
  closest(sel) {
    let cur = this;
    while (cur) {
      if (cur.matches(sel)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }
  querySelectorAll(sel) {
    const out = [];
    const visit = (n) => {
      for (const ch of n.children) {
        if (ch.matches(sel)) out.push(ch);
        visit(ch);
      }
    };
    visit(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}

function makeConversationView(cid, { hidden = false, width = 760, height = 500 } = {}) {
  const attrs = { 'data-testid': 'conversation-view', 'data-cascade-id': cid };
  if (hidden) attrs.hidden = '';
  const view = new MiniElement('DIV', { attrs, width, height });
  const box = new MiniElement('DIV', {
    id: 'antigravity.agentSidePanelInputBox',
    computedStyle: { display: 'flex', flexDirection: 'column' },
    width: hidden ? 0 : width,
    height: hidden ? 0 : 80
  });
  const card = new MiniElement('DIV', {
    computedStyle: { display: 'flex', flexDirection: 'column' },
    width: hidden ? 0 : width - 4,
    height: hidden ? 0 : 76
  });
  const footer = new MiniElement('DIV', {
    className: 'agy-composer-footer',
    attrs: { 'data-agent-composer-root': '' },
    computedStyle: { display: 'flex', flexDirection: 'row' },
    width: hidden ? 0 : width - 14,
    height: hidden ? 0 : 32
  });
  const leftGroup = new MiniElement('DIV', { computedStyle: { display: 'flex', flexDirection: 'row' }, width: 400 });
  const modelBtn = new MiniElement('BUTTON', { attrs: { 'data-testid': 'model-selector-trigger' }, width: 160 });
  leftGroup.appendChild(modelBtn);
  const rightGroup = new MiniElement('DIV', { computedStyle: { display: 'flex', flexDirection: 'row' }, width: 180 });
  footer.appendChild(leftGroup);
  footer.appendChild(rightGroup);
  card.appendChild(footer);
  box.appendChild(card);
  view.appendChild(box);
  return { view, box, card, footer, leftGroup, rightGroup, modelBtn };
}

function mountRuntimeWithTimers(body, { pathname = '/', bootOverrides = {} } = {}) {
  const runtimeDir = path.join(ROOT_DIR, 'core', 'runtime');
  const parts = ['00-head.js', '30-antigravity-probe.js', '40-status-machine.js', '50-telemetry-ui.js', '90-tail.js'];
  const head = new MiniElement('HEAD');
  head._isRoot = true;

  const timers = [];
  const intervals = [];
  let nextTimerId = 1;
  let nowMs = 1_700_000_000_000;

  const fakeDoc = {
    head,
    body,
    hidden: false,
    activeElement: null,
    documentElement: new MiniElement('HTML'),
    getElementById(id) {
      return head.querySelector('#' + id) || body.querySelector('#' + id);
    },
    createElement(tag) { return new MiniElement(tag); },
    querySelector(sel) { return body.querySelector(sel); },
    querySelectorAll(sel) { return body.querySelectorAll(sel); },
    addEventListener() {},
    removeEventListener() {}
  };

  const bootPayload = Object.assign(
    {
      version: 'test',
      modules: { i18n: true, metrics: true, sessionStatus: true, usageStats: true, promptSuggestions: false, deadlockHealer: false, zoomShortcuts: false },
      telemetryLayout: 'compact',
      css: '',
      i18n: { exact: {}, prefix: [], substring: [] }
    },
    bootOverrides
  );

  const fakeWin = {
    document: fakeDoc,
    location: { pathname },
    navigator: { onLine: true },
    innerWidth: 1280,
    innerHeight: 800,
    history: { pushState() {}, replaceState() {} },
    getComputedStyle: (el) => (el && el._computedStyle) || { display: 'block', flexDirection: 'row' },
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame: (fn) => { fn(); return 1; },
    cancelAnimationFrame: () => {},
    ResizeObserver: class { observe() {} disconnect() {} },
    __ag_boot: bootPayload
  };
  fakeWin.top = fakeWin;

  const FakeDate = class extends Date {
    static now() { return nowMs; }
  };

  const sandbox = {
    __AG_BOOT_PAYLOAD__: bootPayload,
    window: fakeWin,
    document: fakeDoc,
    location: fakeWin.location,
    navigator: fakeWin.navigator,
    history: fakeWin.history,
    Date: FakeDate,
    getComputedStyle: fakeWin.getComputedStyle,
    requestAnimationFrame: fakeWin.requestAnimationFrame,
    cancelAnimationFrame: fakeWin.cancelAnimationFrame,
    ResizeObserver: fakeWin.ResizeObserver,
    MutationObserver: class { observe() {} disconnect() {} },
    setTimeout: (fn, delay = 0) => {
      const id = nextTimerId++;
      timers.push({ id, fn, runAt: nowMs + delay, cleared: false });
      return id;
    },
    clearTimeout: (id) => {
      const t = timers.find((x) => x.id === id);
      if (t) t.cleared = true;
    },
    setInterval: (fn, delay = 1000) => {
      const id = nextTimerId++;
      intervals.push({ id, fn, delay, cleared: false });
      return id;
    },
    clearInterval: (id) => {
      const t = intervals.find((x) => x.id === id);
      if (t) t.cleared = true;
    },
    console
  };

  const code = parts.map((p) => fs.readFileSync(path.join(runtimeDir, p), 'utf8')).join('\n');
  vm.runInNewContext(code, sandbox);

  const advanceMs = (delta) => {
    nowMs += delta;
    for (const t of timers.slice()) {
      if (!t.cleared && t.runAt <= nowMs) {
        t.cleared = true;
        t.fn();
      }
    }
  };

  return { win: fakeWin, doc: fakeDoc, intervals, advanceMs, setNow: (v) => { nowMs = v; } };
}

test('Multi-view extractCascadeId skips hidden views, avoids poisoning __ag_last_watched_sig before binding, and returns render ACK', () => {
  const hiddenCid = 'aaaaaaaa-0000-4000-8000-000000000001';
  const activeCid = 'bbbbbbbb-0000-4000-8000-000000000002';
  const body = new MiniElement('BODY');
  body._isRoot = true;

  const hiddenView = makeConversationView(hiddenCid, { hidden: true, width: 0, height: 0 });
  const activeView = makeConversationView(activeCid, { hidden: false, width: 760, height: 500 });
  body.appendChild(hiddenView.view);
  body.appendChild(activeView.view);

  const env = mountRuntimeWithTimers(body, { pathname: '/' });

  // 1) Multi-view resolution skips hidden view and selects active visible view
  assert.deepEqual(Array.from(env.win.__ag_get_watched_cascade_ids()), [activeCid]);

  // 2) Before __agRequestMetrics is bound, __ag_last_watched_sig MUST stay empty so first bind fires request
  env.win.__ag_on_route_change();
  assert.equal(env.win.__ag_last_watched_sig, '');
  const pill = env.doc.getElementById('ag-live-metrics-pill');
  assert.ok(pill, 'pill should mount in active visible conversation view');
  assert.equal(activeView.box.contains(pill), true, 'pill must mount inside active visible inputBox, not hidden view');
  assert.equal(hiddenView.box.contains(pill), false);

  const requests = [];
  env.win.__agRequestMetrics = (payload) => requests.push(payload);
  env.win.__ag_on_route_change();
  assert.equal(requests.length, 1, 'request must fire immediately once __agRequestMetrics is bound');
  assert.equal(env.win.__ag_last_watched_sig, activeCid);

  // 3) __ag_render_metrics returns explicit ACK objects for watched vs unwatched cids
  const rejected = env.win.__ag_render_metrics({
    cid: hiddenCid,
    hasData: true,
    inlineHtml: '<span>old</span>',
    tooltipHtml: '<div>old</div>'
  });
  assert.equal(rejected.applied, false);
  assert.equal(rejected.reason, 'not_watched');

  const accepted = env.win.__ag_render_metrics({
    cid: activeCid,
    hasData: true,
    dataSig: 'sig-1',
    inlineHtml: '<span>120 tok/s</span>',
    tooltipHtml: '<div class="ag-tt-dash"><div class="ag-tt-col-usage"><span>Usage V1</span></div><div class="ag-tt-col-quota" data-ag-quota-slot="1"></div></div>'
  });
  assert.equal(accepted.applied, true);
  assert.equal(accepted.cid, activeCid);
  assert.equal(accepted.sig, 'sig-1');

  // 4) Subsequent render patches .ag-tt-col-usage in-place while preserving exact .ag-tt-col-quota node & scrollTop
  const tt = env.doc.getElementById('ag-live-metrics-tooltip');
  const quotaColBefore = tt.querySelector('.ag-tt-col-quota');
  const usageColBefore = tt.querySelector('.ag-tt-col-usage');
  usageColBefore.scrollTop = 42;
  quotaColBefore._marker = 'keep-me';

  const accepted2 = env.win.__ag_render_metrics({
    cid: activeCid,
    hasData: true,
    dataSig: 'sig-2',
    inlineHtml: '<span>145 tok/s</span>',
    tooltipHtml: '<div class="ag-tt-dash"><div class="ag-tt-col-usage"><span>Usage V2</span></div><div class="ag-tt-col-quota" data-ag-quota-slot="1"></div></div>'
  });
  assert.equal(accepted2.applied, true);
  assert.equal(tt.querySelector('.ag-tt-col-quota'), quotaColBefore, 'right quota column DOM node must be preserved');
  assert.equal(tt.querySelector('.ag-tt-col-quota')._marker, 'keep-me');
  assert.ok(tt.querySelector('.ag-tt-col-usage').innerHTML.includes('Usage V2'));
  assert.equal(tt.querySelector('.ag-tt-col-usage').scrollTop, 42);
});

test('Post-turn executing -> idle edge marks quota dirty and triggers 300ms + 1200ms metrics pulls', () => {
  const cid = 'cccccccc-0000-4000-8000-000000000003';
  const body = new MiniElement('BODY');
  body._isRoot = true;
  const view = makeConversationView(cid);
  body.appendChild(view.view);

  const env = mountRuntimeWithTimers(body, { pathname: '/c/' + cid });
  const requests = [];
  env.win.__agRequestMetrics = (payload) => requests.push(JSON.parse(payload));
  env.win.__ag_on_route_change();
  requests.length = 0;

  // Step 1: Enter executing state via metrics payload
  env.win.__ag_render_metrics({
    cid,
    hasData: true,
    dataSig: 'exec-1',
    inlineHtml: '<span>running</span>',
    tooltipHtml: '<div>running</div>',
    status: { pendingKind: 'generating', totalSteps: 3, totalGenerations: 1 }
  });
  assert.equal(env.win.__ag_pane_states.main.wasExecuting, true);

  // Step 2: Transition executing -> idle
  env.win.__ag_render_metrics({
    cid,
    hasData: true,
    dataSig: 'idle-1',
    inlineHtml: '<span>done</span>',
    tooltipHtml: '<div>done</div>',
    status: { pendingKind: 'idle', totalSteps: 4, totalGenerations: 2 }
  });
  assert.equal(env.win.__ag_pane_states.main.wasExecuting, false);
  assert.equal(env.win.__ag_official_quota_state.dirty, true, 'turn completion must mark official quota dirty');

  // Advance 350ms -> first post-turn metrics pull fires
  env.advanceMs(350);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].reason, 'turn_done');
  assert.equal(requests[0].bypassCache, true);

  // Advance another 950ms (total 1300ms) -> follow-up metrics pull fires
  env.advanceMs(950);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].reason, 'turn_done_followup');
  assert.equal(requests[1].bypassCache, true);
});

test('Official quota tooltip renders horizontal used-% bars without plan/credits chips', async () => {
  const cid = 'dddddddd-0000-4000-8000-000000000004';
  const body = new MiniElement('BODY');
  body._isRoot = true;
  const view = makeConversationView(cid);
  const nowSec = Math.floor(Date.now() / 1000);
  view.box.__reactFiber$test = {
    memoizedProps: {
      value: {
        core: {
          cloudCodeService: {
            retrieveUserQuotaSummary: async () => ({
              groups: [
                {
                  displayName: 'Gemini Models',
                  buckets: [
                    {
                      bucketId: 'g5h',
                      displayName: '5h',
                      window: '5h',
                      remaining: { case: 'remainingFraction', value: 0.85 },
                      resetTime: { seconds: nowSec + 7200, nanos: 0 }
                    }
                  ]
                }
              ]
            })
          }
        },
        store: {
          getState: () => ({
            credits: { availableCredits: 1200, useAICredits: false },
            userStatus: { userTier: { description: 'Google AI Pro' } }
          }),
          subscribe: () => () => {}
        }
      }
    },
    return: null
  };
  body.appendChild(view.view);

  const env = mountRuntimeWithTimers(body, { pathname: '/c/' + cid });
  env.win.__ag_on_route_change();
  env.win.__ag_render_metrics({
    cid,
    hasData: true,
    dataSig: 'q-1',
    inlineHtml: '<span>120 tok/s</span>',
    tooltipHtml:
      '<div class="ag-tt-wrap ag-tt-dash"><div class="ag-tt-col-usage"><span>Usage</span></div><div class="ag-tt-col-quota" data-ag-quota-slot="1"></div></div>'
  });

  await new Promise((r) => setTimeout(r, 20));
  const tt = env.doc.getElementById('ag-live-metrics-tooltip');
  const slot = tt.querySelector('[data-ag-quota-slot="1"]');
  assert.ok(slot.innerHTML.includes('ag-tt-qbar-list'), 'should render horizontal bar list');
  assert.ok(slot.innerHTML.includes('>用量<'), 'should title quota card as 用量 in zh-CN');
  assert.ok(slot.innerHTML.includes('5h · Gemini'), 'should shorten Gemini Models to Gemini');
  assert.ok(slot.innerHTML.includes('已用 15%'), 'should display used-% (100 - 85 = 15%)');
  assert.ok(slot.innerHTML.includes('width:15%'), 'bar fill width should reflect used-%');
  assert.ok(!slot.innerHTML.includes('点数'), 'must omit credits label');
  assert.ok(!slot.innerHTML.includes('Google AI Pro'), 'must omit plan label');
  assert.ok(!slot.innerHTML.includes('已用比例'), 'must omit redundant mode label');

  // Verify pure English mode (i18n: false) renders Usage & "15% used" with zero Chinese text
  const enBody = new MiniElement('BODY');
  enBody._isRoot = true;
  const enView = makeConversationView(cid);
  enView.box.__reactFiber$test = view.box.__reactFiber$test;
  enBody.appendChild(enView.view);
  const enEnv = mountRuntimeWithTimers(enBody, {
    pathname: '/c/' + cid,
    bootOverrides: { modules: { i18n: false, metrics: true, sessionStatus: true, usageStats: true } }
  });
  enEnv.win.__ag_on_route_change();
  enEnv.win.__ag_render_metrics({
    cid,
    hasData: true,
    dataSig: 'q-en-1',
    inlineHtml: '<span>120 tok/s</span>',
    tooltipHtml:
      '<div class="ag-tt-wrap ag-tt-dash"><div class="ag-tt-col-usage"><span>Usage</span></div><div class="ag-tt-col-quota" data-ag-quota-slot="1"></div></div>'
  });
  await new Promise((r) => setTimeout(r, 20));
  const enSlot = enEnv.doc.getElementById('ag-live-metrics-tooltip').querySelector('[data-ag-quota-slot="1"]');
  assert.ok(enSlot.innerHTML.includes('>Usage<'), 'should title quota card as Usage in English');
  assert.ok(enSlot.innerHTML.includes('15% used'), 'should display English used-% format');
  assert.ok(!/[\u4e00-\u9fff]/.test(enSlot.innerHTML), 'English usage card must contain zero Chinese characters');
});
