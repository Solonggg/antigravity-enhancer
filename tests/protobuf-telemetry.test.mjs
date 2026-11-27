/**
 * tests/protobuf-telemetry.test.mjs — Unit tests for Protobuf wire decoding, retry log parsing & telemetry layout formatting
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.AG_DAEMON_LIBRARY = '1';

const {
  parseProto,
  parseGenMetadataRow,
  extractMaxStepIdx,
  extractProtoLeafStrings,
  extractStep17Message,
  isCancelText,
  readRecentLsRetryInfo
} = await import('../core/daemon.mjs');

const {
  fmtTok,
  computeSegPcts,
  buildInlineTelemetryHtml,
  buildMetricsTooltipHtml,
  buildTurnSummaries
} = await import('../core/daemon/telemetry-renderer.mjs');

const {
  parseContextBreakdown,
  extractContextBreakdownFromGenData
} = await import('../core/daemon/protobuf.mjs');

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

test('parseGenMetadataRow decodes token usage, TTFT, streaming duration, model name, and step indices', () => {
  const usage = Buffer.concat([
    fieldVarint(2, 2400),
    fieldVarint(3, 600),
    fieldVarint(4, 150),
    fieldVarint(5, 18000),
    fieldVarint(9, 250),
    fieldVarint(10, 350)
  ]);
  const ctxMeta = fieldVarint(4, 512000);
  const chatStart = fieldBytes(10, ctxMeta);
  const ttft = Buffer.concat([fieldVarint(1, 1), fieldVarint(2, 250000000)]);
  const stream = Buffer.concat([fieldVarint(1, 2), fieldVarint(2, 500000000)]);
  const meta17 = Buffer.concat([fieldVarint(5, 1), fieldBytes(3, 'Model unavailable')]);
  const chat = Buffer.concat([
    fieldBytes(4, usage),
    fieldBytes(9, chatStart),
    fieldBytes(11, ttft),
    fieldBytes(12, stream),
    fieldBytes(21, 'Gemini 4 Hydrogen (XHigh)'),
    fieldBytes(17, meta17)
  ]);
  const packedSteps = Buffer.concat([encodeVarint(14), encodeVarint(16), encodeVarint(15)]);
  const top = Buffer.concat([fieldBytes(1, chat), fieldBytes(2, packedSteps)]);

  const parsed = parseGenMetadataRow({ idx: 7, data: top });
  assert.equal(parsed.idx, 7);
  assert.equal(parsed.inTok, 2400);
  assert.equal(parsed.outTok, 600);
  assert.equal(parsed.cacheWrite, 150);
  assert.equal(parsed.cacheRead, 18000);
  assert.equal(parsed.ctx, 20550);
  assert.equal(parsed.maxCtx, 512000);
  assert.equal(parsed.maxStepIdx, 16);
  assert.equal(parsed.modelName, 'Gemini 4 Hydrogen (Extra High)');
  assert.equal(parsed.thinkTok, 250);
  assert.equal(parsed.respTok, 350);
  assert.equal(parsed.ttft, 1.25);
  assert.equal(parsed.stream, 2.5);
  assert.equal(parsed.totDur, 3.75);
  assert.equal(parsed.errCode, 1);
  assert.equal(parsed.errMsg, 'Model unavailable');
});

test('extractMaxStepIdx handles both single varint and packed varint buffer', () => {
  assert.equal(extractMaxStepIdx(42), 42);
  assert.equal(extractMaxStepIdx(Buffer.concat([encodeVarint(3), encodeVarint(99), encodeVarint(18)])), 99);
  assert.equal(extractMaxStepIdx(Buffer.alloc(0)), -1);
});

test('extractStep17Message extracts clean error leaf string and strips trailing UUID artifacts', () => {
  const uuid = 'a1a51091-fd1b-437d-a034-e4dbc428c4ca-17';
  const innerErr = Buffer.concat([
    fieldBytes(1, 'API error: TLS handshake timeout'),
    fieldBytes(2, uuid)
  ]);
  const payload = fieldBytes(1, innerErr);
  const leaves = extractProtoLeafStrings(payload);
  assert.ok(leaves.includes('API error: TLS handshake timeout'));
  assert.ok(!leaves.some((s) => s.includes(uuid)));

  const msg = extractStep17Message({ step_payload: payload });
  assert.equal(msg, 'API error: TLS handshake timeout');
});

test('isCancelText distinguishes user cancellations from real service errors', () => {
  assert.equal(isCancelText('context canceled'), true);
  assert.equal(isCancelText('rpc error: code = Canceled desc = context canceled'), true);
  assert.equal(isCancelText('Cancelled by user'), true);
  assert.equal(isCancelText('API request failed (503 Service Unavailable)'), false);
});

test('readRecentLsRetryInfo parses unanchored google.Init prefix lines and ignores telemetry noise', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-codex-log-'));
  const logFile = path.join(tmpDir, 'language_server.log');
  try {
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    const lines = [
      `ERROR: logging before google.Init: I${mm}${dd} ${hh}:${mi}:${ss}.123456 999 executor.go:42] Run: attempt 6 failed (Model unavailable), retrying in 13s`,
      `I${mm}${dd} ${hh}:${mi}:${ss}.999999 999 llm_monitor.go:10] play.googleapis.com/log CallWithRetry: attempt 1 failed (noise), retrying in 1s`
    ];
    fs.writeFileSync(logFile, lines.join('\n') + '\n', 'utf8');

    const info = readRecentLsRetryInfo(logFile, now.getTime() - 10000, now);
    assert.ok(info);
    assert.equal(info.attempt, 6);
    assert.equal(info.reason, 'Model unavailable');
    assert.equal(info.delay, '13s');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('buildInlineTelemetryHtml renders Codex compact layout by default and detailed layout on demand', () => {
  const dot = '<span class="ag-ctx-pending-dot ag-dot-idle"></span>';
  const compactHtml = buildInlineTelemetryHtml({
    telemetryLayout: 'compact',
    telemetryCacheMode: 'session',
    statusDotHtml: dot,
    displayTps: 220,
    ttft: 1.4,
    lastCtx: 230949,
    limitKStr: '512k',
    ctxClass: 'ag-ctx-warn',
    ctxPct: 45,
    compactedPending: false,
    outTok: 1540,
    lastCacheRate: '98.9',
    sessionCacheRate: '90.7'
  });
  assert.ok(compactHtml.includes('220 tok/s'));
  assert.ok(compactHtml.includes('Ctx <span class="ag-ctx-warn">45%</span>'));
  assert.ok(compactHtml.includes('Cache 90.7%'));
  assert.ok(!compactHtml.includes('TTFT'));

  const detailedHtml = buildInlineTelemetryHtml({
    telemetryLayout: 'detailed',
    telemetryCacheMode: 'step',
    statusDotHtml: dot,
    displayTps: 220,
    ttft: 1.4,
    lastCtx: 230949,
    limitKStr: '512k',
    ctxClass: 'ag-ctx-warn',
    ctxPct: 45,
    compactedPending: true,
    outTok: 1540,
    lastCacheRate: '98.9',
    sessionCacheRate: '90.7'
  });
  assert.ok(detailedHtml.includes('TTFT 1.4s'));
  assert.ok(detailedHtml.includes('Ctx 已压缩'));
  assert.ok(detailedHtml.includes('Out 1.5k'));
});

test('computeSegPcts & buildTurnSummaries compute balanced bar percentages and turn rollups', () => {
  const pcts = computeSegPcts([10, 990], 100, 2);
  assert.ok(pcts[0] >= 2);
  assert.ok(Math.abs(pcts[0] + pcts[1] - 100) < 0.3);

  const turns = buildTurnSummaries(
    [
      {
        idx: 0,
        inTok: 1000,
        outTok: 200,
        cacheWrite: 0,
        cacheRead: 9000,
        ctx: 10000,
        maxCtx: 512000,
        maxStepIdx: 3,
        modelName: 'Gemini 4 Hydrogen (XHigh)',
        thinkTok: 50,
        respTok: 150,
        ttft: 0.8,
        stream: 1.0,
        totDur: 1.8
      }
    ],
    [1],
    0,
    256000
  );
  assert.equal(turns.length, 1);
  assert.equal(turns[0].turnIndex, 1);
  assert.equal(turns[0].tps, 200);
  assert.equal(turns[0].cacheRate, '90.0%');
  assert.equal(fmtTok(1500), '1.5k');
  assert.equal(fmtTok(1500000), '1.50M');
});

test('telemetry renderer splits sessionStatus and usageStats independently and embeds official quota slot', () => {
  const dot = '<span class="ag-ctx-pending-dot ag-dot-idle"></span>';
  const baseInline = {
    telemetryLayout: 'compact',
    telemetryCacheMode: 'session',
    statusDotHtml: dot,
    displayTps: 180,
    ttft: 1.1,
    lastCtx: 50000,
    limitKStr: '256k',
    ctxClass: 'ag-ctx-ok',
    ctxPct: 20,
    compactedPending: false,
    outTok: 900,
    lastCacheRate: '80.0',
    sessionCacheRate: '85.0'
  };

  const statusOnlyInline = buildInlineTelemetryHtml({ ...baseInline, showSessionStatus: true, showUsageStats: false });
  assert.equal(statusOnlyInline, dot);
  assert.ok(!statusOnlyInline.includes('tok/s'));

  const usageOnlyInline = buildInlineTelemetryHtml({ ...baseInline, showSessionStatus: false, showUsageStats: true });
  assert.ok(!usageOnlyInline.includes('ag-ctx-pending-dot'), 'usage-only pill must omit status dot');
  assert.ok(usageOnlyInline.includes('180 tok/s'));
  assert.ok(usageOnlyInline.includes('Cache 85.0%'));

  const baseTooltip = {
    genIdx: 3,
    streamTps: 180,
    e2eTps: 120,
    streamTpsValid: true,
    last: { ctx: 50000, inTok: 10000, cacheWrite: 0, cacheRead: 40000, outTok: 900, thinkTok: 300, respTok: 600, ttft: 1.1, stream: 5.0, totDur: 6.1 },
    lastCacheRate: '80.0',
    ctxPct: 20,
    contextLimitTokens: 256000,
    limitKStr: '256k',
    remainCtx: 206000,
    compactedPending: false,
    compactSummaryKb: 0,
    compactingNow: false,
    generatingPending: false,
    pendingRetrying: false,
    lastErrorMsg: '',
    turnSteps: 1,
    turnOut: 900,
    turnThink: 300,
    turnResp: 600,
    turnDur: 6.1,
    userStepsCount: 2,
    validCount: 3,
    totalIn: 20000,
    totalCacheWrite: 0,
    totalCache: 110000,
    totalPrompt: 130000,
    sessionCacheRate: '84.6',
    totalOut: 2400,
    totalThink: 800,
    totalResp: 1600
  };

  const statusOnlyTt = buildMetricsTooltipHtml({ ...baseTooltip, showSessionStatus: true, showUsageStats: false });
  assert.ok(statusOnlyTt.includes('实时会话状态'));
  assert.ok(!statusOnlyTt.includes('ag-tt-bento'));
  assert.ok(!statusOnlyTt.includes('data-ag-quota-slot'));

  const usageOnlyTt = buildMetricsTooltipHtml({ ...baseTooltip, showSessionStatus: false, showUsageStats: true });
  assert.ok(usageOnlyTt.includes('ag-tt-dash'));
  assert.ok(usageOnlyTt.includes('ag-tt-col-usage'));
  assert.ok(usageOnlyTt.includes('ag-tt-col-quota'));
  assert.ok(usageOnlyTt.includes('ag-tt-bento'));
  assert.ok(usageOnlyTt.includes('data-ag-quota-slot="1"'));
  assert.ok(!usageOnlyTt.includes('ag-tt-footer'));
  assert.ok(!usageOnlyTt.includes('ag-tt-live-chip'));
  assert.ok(!usageOnlyTt.includes('ag-tt-wait-note'));

  const bothTt = buildMetricsTooltipHtml({
    ...baseTooltip,
    modelName: 'Gemini 4 Neon (Extra High)',
    avgTps: 150.5,
    avgTtft: 1.35,
    contextBreakdown: {
      totalTokens: 50000,
      items: [
        { key: 'tool_results', label: '工具结果', tokens: 28000 },
        { key: 'assistant', label: '模型回复', tokens: 12000 },
        { key: 'system_prompt', label: '系统提示词', tokens: 6000 },
        { key: 'skills', label: 'Skill', tokens: 4000 }
      ]
    },
    showSessionStatus: true,
    showUsageStats: true
  });
  assert.ok(bothTt.includes('ag-tt-dash'));
  assert.ok(bothTt.includes('ag-tt-live-chip'));
  assert.ok(bothTt.includes('ag-tt-wait-note'));
  assert.ok(bothTt.includes('Gemini 4 Neon (Extra High)'));
  assert.ok(bothTt.includes('ag-tt-ctx-grid'));
  assert.ok(bothTt.includes('工具结果'));
  assert.ok(bothTt.includes('ag-tt-sess-grid'));
  assert.ok(!bothTt.includes('ag-tt-hdr-refresh'), 'session header must not render redundant refresh button');
  assert.ok(bothTt.includes('data-ag-quota-slot="1"'));

  const enTt = buildMetricsTooltipHtml({
    ...baseTooltip,
    isZh: false,
    modelName: 'Gemini 4 Neon (Extra High)',
    avgTps: 150.5,
    avgTtft: 1.35,
    contextBreakdown: {
      totalTokens: 50000,
      items: [
        { key: 'tool_results', label: '工具结果', tokens: 28000 },
        { key: 'assistant', label: '模型回复', tokens: 12000 },
        { key: 'system_prompt', label: '系统提示词', tokens: 6000 },
        { key: 'skills', label: 'Skill', tokens: 4000 }
      ]
    },
    showSessionStatus: true,
    showUsageStats: true
  });
  assert.ok(enTt.includes('Ready'));
  assert.ok(enTt.includes('Speed'));
  assert.ok(enTt.includes('Cache Hit'));
  assert.ok(enTt.includes('Context Window'));
  assert.ok(enTt.includes('Tool Results'));
  assert.ok(enTt.includes('Model Replies'));
  assert.ok(enTt.includes('Session Totals'));
  assert.ok(enTt.includes('New In'));
  assert.ok(!/[\u4e00-\u9fff]/.test(enTt), 'English mode tooltip must contain zero Chinese characters');
});

test('extractContextBreakdownFromGenData decodes exact native ctxMeta breakdown groups and tool splits', () => {
  const mkChild = (name, tok) => Buffer.concat([fieldBytes(1, name), fieldVarint(3, tok)]);
  const mkGroup = (name, cat, tok, kids = []) =>
    Buffer.concat([
      fieldBytes(1, name),
      fieldVarint(2, cat),
      fieldVarint(4, tok),
      ...kids.map((k) => fieldBytes(5, k))
    ]);

  const breakdownMsg = Buffer.concat([
    fieldBytes(1, mkGroup('System Prompt', 1, 5000)),
    fieldBytes(1, mkGroup('Plugins', 9, 1500)),
    fieldBytes(
      1,
      mkGroup('Tools', 2, 3000, [mkChild('read_file', 2200), mkChild('mcp_gemini_search', 800)])
    ),
    fieldBytes(1, mkGroup('Mcp Tools', 4, 400)),
    fieldBytes(1, mkGroup('Skills', 5, 4200)),
    fieldBytes(1, mkGroup('Rules', 3, 900)),
    fieldBytes(1, mkGroup('Subagents', 6, 1800)),
    fieldBytes(
      1,
      mkGroup('Chat Messages', 7, 45000, [
        mkChild('10: GENERIC', 25000),
        mkChild('11: PLANNER_RESPONSE', 13000),
        mkChild('12: CHECKPOINT', 5000),
        mkChild('13: SYSTEM_MESSAGE', 1200),
        mkChild('14: USER_INPUT', 800)
      ])
    )
  ]);
  const ctxMeta = Buffer.concat([fieldVarint(1, 61800), fieldBytes(3, breakdownMsg), fieldVarint(4, 512000)]);
  const genData = fieldBytes(1, fieldBytes(9, fieldBytes(10, ctxMeta)));

  const parsed = extractContextBreakdownFromGenData(genData);
  assert.ok(parsed);
  assert.equal(parsed.totalTokens, 61800);
  const byKey = Object.fromEntries(parsed.items.map((it) => [it.key, it.tokens]));
  assert.equal(byKey.tool_results, 25000);
  assert.equal(byKey.assistant, 13000);
  assert.equal(byKey.system_prompt, 6500);
  assert.equal(byKey.checkpoint, 5000);
  assert.equal(byKey.skills, 4200);
  assert.equal(byKey.system_tools, 2200);
  assert.equal(byKey.subagent, 1800);
  assert.equal(byKey.mcp_tools, 1200);
  assert.equal(byKey.system_msg, 1200);
  assert.equal(byKey.rules, 900);
  assert.equal(byKey.user_msg, 800);
  assert.equal(parsed.items[0].key, 'tool_results', 'items must be sorted descending by token count');

  // Empty/missing ctxMeta.3 returns null cleanly
  assert.equal(parseContextBreakdown(fieldVarint(4, 512000)), null);
});
