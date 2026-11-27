/**
 * core/daemon/telemetry-renderer.mjs — Codex Inline Pill, Bento Tooltip & Per-Turn Formatters
 */

export function fmtTok(n) {
  if (!n || n <= 0) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M';
  if (n >= 10000) return Math.round(n / 1000) + 'k';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

export function fmtNum(n) {
  return (n || 0).toLocaleString('en-US');
}

export function formatContextLimitLabel(tokens) {
  if (!tokens || tokens <= 0) return '0k';
  if (tokens >= 1000000) {
    if (tokens === 1000000 || tokens === 1048576) return '1M';
    return (tokens / 1000000).toFixed(2).replace(/\.?0+$/, '') + 'M';
  }
  return Math.round(tokens / 1000) + 'k';
}

export function computeSegPcts(values, targetTotalPct = 100, minVisiblePct = 1.6) {
  const sum = values.reduce((acc, v) => acc + (v > 0 ? v : 0), 0);
  const clampedTotal = Math.max(0, Math.min(100, targetTotalPct));
  if (sum <= 0 || clampedTotal <= 0) {
    return values.map(() => 0);
  }
  const raw = values.map((v) => (v > 0 ? (v / sum) * clampedTotal : 0));
  const nonZeroIdxs = [];
  for (let i = 0; i < values.length; i++) {
    if (values[i] > 0) nonZeroIdxs.push(i);
  }
  if (nonZeroIdxs.length > 1 && clampedTotal > minVisiblePct * nonZeroIdxs.length) {
    let deficit = 0;
    let flexibleSum = 0;
    for (const idx of nonZeroIdxs) {
      if (raw[idx] < minVisiblePct) {
        deficit += minVisiblePct - raw[idx];
        raw[idx] = minVisiblePct;
      } else {
        flexibleSum += raw[idx] - minVisiblePct;
      }
    }
    if (deficit > 0 && flexibleSum > 0) {
      const ratio = Math.min(1, deficit / flexibleSum);
      for (const idx of nonZeroIdxs) {
        if (raw[idx] > minVisiblePct) {
          raw[idx] -= (raw[idx] - minVisiblePct) * ratio;
        }
      }
    }
  }
  return raw.map((pct) => Number(pct.toFixed(1)));
}

export function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildInlineTelemetryHtml({
  telemetryLayout = 'compact',
  telemetryCacheMode = 'session',
  showSessionStatus = true,
  showUsageStats = true,
  statusDotHtml,
  displayTps,
  ttft,
  lastCtx,
  limitKStr,
  ctxClass,
  ctxPct,
  compactedPending,
  outTok,
  lastCacheRate,
  sessionCacheRate
}) {
  const dotPart = showSessionStatus ? statusDotHtml || '' : '';
  if (!showUsageStats) {
    return dotPart;
  }

  if (telemetryLayout === 'detailed') {
    const inlineCtxHtml = compactedPending
      ? '<span class="ag-ctx-compacted">Ctx 已压缩</span>'
      : `<span>Ctx ${fmtTok(lastCtx)}/${limitKStr} <span class="${ctxClass}">(${ctxPct}%)</span></span>`;
    return (
      dotPart +
      [
        `<span>${Math.round(displayTps)} tok/s</span>`,
        '<span class="ag-sep">·</span>',
        `<span>TTFT ${Number(ttft || 0).toFixed(1)}s</span>`,
        '<span class="ag-sep">·</span>',
        inlineCtxHtml,
        '<span class="ag-sep">·</span>',
        `<span>Out ${fmtTok(outTok)}</span>`
      ].join('')
    );
  }

  const cacheVal = telemetryCacheMode === 'step' ? lastCacheRate : sessionCacheRate;
  const compactCtxHtml = compactedPending
    ? '<span class="ag-ctx-compacted">Ctx 已压缩</span>'
    : `<span>Ctx <span class="${ctxClass}">${ctxPct}%</span></span>`;

  return (
    dotPart +
    [
      `<span>${Math.round(displayTps)} tok/s</span>`,
      '<span class="ag-sep">·</span>',
      compactCtxHtml,
      '<span class="ag-sep">·</span>',
      `<span>Cache ${cacheVal}%</span>`
    ].join('')
  );
}

export function buildMetricsTooltipHtml({
  showSessionStatus = true,
  showUsageStats = true,
  genIdx,
  modelName = '',
  streamTps,
  avgTps = 0,
  e2eTps,
  streamTpsValid,
  avgTtft = 0,
  last,
  lastCacheRate,
  ctxPct,
  contextLimitTokens,
  limitKStr,
  remainCtx,
  contextBreakdown = null,
  compactedPending,
  compactSummaryKb,
  compactingNow,
  generatingPending,
  pendingRetrying,
  lastErrorMsg,
  turnSteps,
  turnOut,
  turnThink,
  turnResp,
  turnDur,
  userStepsCount,
  validCount,
  totalIn,
  totalCacheWrite,
  totalCache,
  totalPrompt,
  totalAllTokens = 0,
  sessionCacheRate,
  totalOut,
  totalThink,
  totalResp
}) {
  const ctxLevelClass = compactedPending
    ? 'ag-tt-compacted'
    : ctxPct >= 90
    ? 'ag-tt-crit'
    : ctxPct >= 75
    ? 'ag-tt-warn'
    : 'ag-tt-ok';
  const mainTpsVal = streamTpsValid ? streamTps : e2eTps;
  const effAvgTps = avgTps > 0 ? avgTps : e2eTps;
  const speedSub = avgTps > 0 ? `均速 ${effAvgTps.toFixed(1)}` : streamTpsValid ? `端到端 ${e2eTps.toFixed(1)}` : '端到端均值';
  const effAvgTtft = avgTtft > 0 ? avgTtft : Number(last.ttft || 0);
  const ttftSub = avgTtft > 0 ? `均 ${effAvgTtft.toFixed(2)}s` : `流式 ${Number(last.stream || 0).toFixed(1)}s`;
  const hasSessionCache = parseFloat(sessionCacheRate) > 0;
  const effTotalTokens = totalAllTokens > 0 ? totalAllTokens : totalPrompt + totalOut;
  const liveChipClass =
    lastErrorMsg && !compactingNow && !generatingPending && !pendingRetrying
      ? ' is-error'
      : pendingRetrying
      ? ' is-slow'
      : compactingNow || generatingPending
      ? ' is-running'
      : '';
  const liveChipText =
    lastErrorMsg && !compactingNow && !generatingPending && !pendingRetrying
      ? '执行报错'
      : pendingRetrying
      ? '重试连接中…'
      : compactingNow
      ? '压缩中…'
      : generatingPending
      ? '生成中…'
      : '就绪';
  const liveDotClass =
    lastErrorMsg && !compactingNow && !generatingPending && !pendingRetrying
      ? ' is-error'
      : pendingRetrying
      ? ' is-slow'
      : compactingNow || generatingPending
      ? ' is-running'
      : ' is-idle';
  const liveChipHtml = showSessionStatus
    ? `<span class="ag-tt-live-chip${liveChipClass}">${liveChipText}</span>`
    : '';
  const liveDotHtml = showSessionStatus ? `<span class="ag-tt-hdr-dot${liveDotClass}"></span>` : '';
  const waitNoteHtml = showSessionStatus ? '<div class="ag-tt-wait-note" id="ag-tt-wait-note"></div>' : '';

  if (!showUsageStats) {
    if (!showSessionStatus) return '';
    return `<div class="ag-tt-wrap ag-tt-status-only">
    <div class="ag-tt-hdr">
      <span class="ag-tt-hdr-left-wrap">${liveDotHtml}<span class="ag-tt-hdr-left">实时会话状态</span></span>
      <span class="ag-tt-hdr-right">${liveChipHtml}</span>
    </div>
    ${waitNoteHtml}
    <div class="ag-tt-status-desc" data-ag-status-desc="1">会话连接正常，随时可继续对话。</div>
  </div>`;
  }

  const headerTitle = String(modelName || (last && last.modelName) || '').trim() || '会话用量';
  const ctxUsedTargetPct = contextLimitTokens > 0 ? Math.min(100, (last.ctx / contextLimitTokens) * 100) : 0;
  const bdItems =
    !compactedPending && contextBreakdown && Array.isArray(contextBreakdown.items) && contextBreakdown.items.length > 0
      ? contextBreakdown.items
      : null;

  let ctxSegsHtml = '';
  let ctxBreakdownGridHtml = '';
  if (compactedPending) {
    ctxSegsHtml = '<div class="ag-tt-seg ag-tt-c-compacted" style="width:10%"></div>';
  } else if (bdItems) {
    const segPcts = computeSegPcts(
      bdItems.map((it) => it.tokens),
      ctxUsedTargetPct,
      1.1
    );
    ctxSegsHtml = bdItems
      .map(
        (it, idx) =>
          `<div class="ag-tt-seg ag-tt-ctx-k-${escapeHtml(it.key)}" style="width:${segPcts[idx]}%"></div>`
      )
      .join('');
    ctxBreakdownGridHtml = `<div class="ag-tt-ctx-grid">${bdItems
      .map(
        (it) =>
          `<div class="ag-tt-ctx-row"><span class="ag-tt-ctx-lbl"><span class="ag-tt-dot ag-tt-ctx-k-${escapeHtml(it.key)}"></span><span class="ag-tt-ctx-name">${escapeHtml(it.label)}</span></span><span class="ag-tt-ctx-val">${fmtTok(it.tokens)}</span></div>`
      )
      .join('')}</div>`;
  } else {
    const hasStepWrite = last.cacheWrite > 0;
    const ctxPcts = hasStepWrite
      ? computeSegPcts([last.inTok, last.cacheWrite, last.cacheRead], ctxUsedTargetPct, 1.5)
      : computeSegPcts([last.inTok, last.cacheRead], ctxUsedTargetPct, 1.6);
    ctxSegsHtml = hasStepWrite
      ? `<div class="ag-tt-seg ag-tt-c-ctx-new" style="width:${ctxPcts[0]}%"></div><div class="ag-tt-seg ag-tt-c-slate" style="width:${ctxPcts[1]}%"></div><div class="ag-tt-seg ag-tt-c-ctx-cache" style="width:${ctxPcts[2]}%"></div>`
      : `<div class="ag-tt-seg ag-tt-c-ctx-new" style="width:${ctxPcts[0]}%"></div><div class="ag-tt-seg ag-tt-c-ctx-cache" style="width:${ctxPcts[1]}%"></div>`;
  }

  const ctxBarTopMetaHtml = compactedPending
    ? `<strong class="ag-tt-compacted-val">已完成压缩</strong>${compactSummaryKb > 0 ? ` · 摘要 ${compactSummaryKb} KB` : ''}`
    : `<strong>${fmtTok(last.ctx)}</strong> / ${limitKStr} <span class="ag-tt-pill">(${ctxPct}%)</span>`;

  const turnRightFootHtml =
    turnSteps > 1
      ? `<span class="ag-tt-ctx-foot-right">本轮 ${turnSteps} 步 · 输 <strong>${fmtTok(turnOut)}</strong></span>`
      : `<span class="ag-tt-ctx-foot-right">余 <strong>${fmtTok(remainCtx)}</strong></span>`;
  const ctxFootLeftHtml = compactedPending
    ? `<span class="ag-tt-ctx-foot-left">压缩前 ${fmtTok(last.ctx)} (${ctxPct}%) · 下步刷新</span>`
    : turnSteps > 1
    ? `<span class="ag-tt-ctx-foot-left">新增 ${fmtTok(last.inTok)} · 缓存 ${fmtTok(last.cacheRead)} · 余 ${fmtTok(remainCtx)}</span>`
    : `<span class="ag-tt-ctx-foot-left">新增 ${fmtTok(last.inTok)}${last.cacheWrite > 0 ? ` · 写 ${fmtTok(last.cacheWrite)}` : ''} · 缓存 ${fmtTok(last.cacheRead)}</span>`;

  const totalNewWithWrite = totalIn + totalCacheWrite;
  const totalInNewPct = effTotalTokens > 0 ? ((totalNewWithWrite / effTotalTokens) * 100).toFixed(1) : '0.0';
  const totalInCachePct = effTotalTokens > 0 ? ((totalCache / effTotalTokens) * 100).toFixed(1) : '0.0';
  const totalOutPct = effTotalTokens > 0 ? ((totalOut / effTotalTokens) * 100).toFixed(1) : '0.0';
  const sessSegPcts = computeSegPcts([totalNewWithWrite, totalCache, totalOut], 100, 2.2);

  return `<div class="ag-tt-wrap ag-tt-dash ${ctxLevelClass}">
    <div class="ag-tt-col-usage">
      <div class="ag-tt-hdr">
        <span class="ag-tt-hdr-left-wrap">
          ${liveDotHtml}
          <span class="ag-tt-hdr-left" title="${escapeHtml(headerTitle)}">${escapeHtml(headerTitle)}</span>
        </span>
        <span class="ag-tt-hdr-right">
          ${liveChipHtml}
          <button type="button" class="ag-tt-quota-btn ag-tt-hdr-refresh" aria-label="刷新用量与配额" title="刷新用量与配额">
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 8a5.5 5.5 0 1 1-1.4-3.67M13.5 2.5v2.8h-2.8"/></svg>
          </button>
        </span>
      </div>
      ${waitNoteHtml}
      <div class="ag-tt-bento">
        <div class="ag-tt-bento-cell">
          <div class="ag-tt-bento-lbl">输出速度</div>
          <div class="ag-tt-bento-val-row">
            <span class="ag-tt-bento-val">${mainTpsVal.toFixed(1)}</span>
            <span class="ag-tt-bento-unit">t/s</span>
          </div>
          <div class="ag-tt-bento-sub">${speedSub}</div>
        </div>
        <div class="ag-tt-bento-cell">
          <div class="ag-tt-bento-lbl">首字延迟</div>
          <div class="ag-tt-bento-val-row">
            <span class="ag-tt-bento-val">${Number(last.ttft || 0).toFixed(2)}</span>
            <span class="ag-tt-bento-unit">s</span>
          </div>
          <div class="ag-tt-bento-sub">${ttftSub}</div>
        </div>
        <div class="ag-tt-bento-cell">
          <div class="ag-tt-bento-lbl">缓存命中</div>
          <div class="ag-tt-bento-val-row">
            <span class="ag-tt-bento-val${hasSessionCache ? ' ag-tt-val-accent' : ''}">${sessionCacheRate}%</span>
          </div>
          <div class="ag-tt-bento-sub">本步 ${lastCacheRate}%</div>
        </div>
        <div class="ag-tt-bento-cell">
          <div class="ag-tt-bento-lbl">会话总量</div>
          <div class="ag-tt-bento-val-row">
            <span class="ag-tt-bento-val">${fmtTok(effTotalTokens)}</span>
          </div>
          <div class="ag-tt-bento-sub">${userStepsCount} 轮 · ${validCount} 次</div>
        </div>
      </div>
      <div class="ag-tt-card ag-tt-ctx-card">
        <div class="ag-tt-bar-top">
          <span class="ag-tt-bar-name">上下文窗口</span>
          <span class="ag-tt-bar-meta">${ctxBarTopMetaHtml}</span>
        </div>
        <div class="ag-tt-track">${ctxSegsHtml}</div>
        ${ctxBreakdownGridHtml}
        <div class="ag-tt-ctx-foot">
          ${ctxFootLeftHtml}
          ${turnRightFootHtml}
        </div>
      </div>
      <div class="ag-tt-card ag-tt-sess-card">
        <div class="ag-tt-bar-top">
          <span class="ag-tt-bar-name">当前会话累计</span>
          <span class="ag-tt-bar-meta">${userStepsCount} 轮 · ${validCount} 次 · <strong>${fmtTok(effTotalTokens)}</strong></span>
        </div>
        <div class="ag-tt-sess-grid">
          <div class="ag-tt-sess-col">
            <div class="ag-tt-sess-head"><span class="ag-tt-leg"><span class="ag-tt-dot ag-tt-c-in-new"></span>新输入</span><span class="ag-tt-sess-pct">${totalInNewPct}%</span></div>
            <div class="ag-tt-sess-val">${fmtTok(totalNewWithWrite)}</div>
          </div>
          <div class="ag-tt-sess-col">
            <div class="ag-tt-sess-head"><span class="ag-tt-leg"><span class="ag-tt-dot ag-tt-c-in-cache"></span>缓存读取</span><span class="ag-tt-sess-pct">${totalInCachePct}%</span></div>
            <div class="ag-tt-sess-val">${fmtTok(totalCache)}</div>
          </div>
          <div class="ag-tt-sess-col">
            <div class="ag-tt-sess-head"><span class="ag-tt-leg"><span class="ag-tt-dot ag-tt-c-out"></span>总输出</span><span class="ag-tt-sess-pct">${totalOutPct}%</span></div>
            <div class="ag-tt-sess-val">${fmtTok(totalOut)}</div>
            <div class="ag-tt-sess-sub">思 ${fmtTok(totalThink)} · 正 ${fmtTok(totalResp)}</div>
          </div>
        </div>
        <div class="ag-tt-track ag-tt-track-xs">
          <div class="ag-tt-seg ag-tt-c-in-new" style="width:${sessSegPcts[0]}%"></div>
          <div class="ag-tt-seg ag-tt-c-in-cache" style="width:${sessSegPcts[1]}%"></div>
          <div class="ag-tt-seg ag-tt-c-out" style="width:${sessSegPcts[2]}%"></div>
        </div>
      </div>
    </div>
    <div class="ag-tt-col-quota" data-ag-quota-slot="1"></div>
  </div>`;
}

export function formatTurnModelName(gens) {
  const models = [];
  for (let i = 0; i < gens.length; i++) {
    const m = gens[i].modelName;
    if (m && !models.includes(m)) {
      models.push(m);
    }
  }
  if (models.length === 0) return '';
  if (models.length === 1) return models[0];
  const first = models[0];
  let last = models[models.length - 1];
  if (/^Orchestrator\b/i.test(first)) {
    last = last.replace(/\s*\(Orchestrator\)\s*$/i, '').trim();
  }
  return last && last !== first ? `${first} → ${last}` : first;
}

export function buildTurnSummaries(valid, userStepIdxs, manualLim, fallbackLim) {
  if (!valid || valid.length === 0 || !valid.some((it) => it.maxStepIdx >= 0)) {
    return [];
  }
  const bucketMap = new Map();
  for (let i = 0; i < valid.length; i++) {
    const item = valid[i];
    const si = item.maxStepIdx;
    if (si < 0) continue;
    let lo = 0;
    let hi = userStepIdxs.length - 1;
    let foundIdx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (userStepIdxs[mid] <= si) {
        foundIdx = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    const key = foundIdx >= 0 ? foundIdx : -1;
    let arr = bucketMap.get(key);
    if (!arr) {
      arr = [];
      bucketMap.set(key, arr);
    }
    arr.push(item);
  }

  const keys = Array.from(bucketMap.keys()).sort((a, b) => a - b);
  const MIN_STREAM_DUR_SEC = 0.12;
  const MAX_SANITY_STREAM_TPS = 3000;
  const turns = [];

  for (let ki = 0; ki < keys.length; ki++) {
    const k = keys[ki];
    const gens = bucketMap.get(k);
    if (!gens || gens.length === 0) continue;

    const startStepIdx = k >= 0 ? userStepIdxs[k] : -1;
    const nextUserStep = k + 1 < userStepIdxs.length ? userStepIdxs[k + 1] : Infinity;
    const endStepIdx = Number.isFinite(nextUserStep) ? nextUserStep - 1 : -1;

    let inTokSum = 0;
    let cacheWriteSum = 0;
    let cacheReadSum = 0;
    let outTokSum = 0;
    let thinkTokSum = 0;
    let respTokSum = 0;
    let streamSum = 0;
    let totDurSum = 0;
    let nativeMaxCtx = 0;

    for (let j = 0; j < gens.length; j++) {
      const g = gens[j];
      inTokSum += g.inTok;
      cacheWriteSum += g.cacheWrite;
      cacheReadSum += g.cacheRead;
      outTokSum += g.outTok;
      thinkTokSum += g.thinkTok;
      respTokSum += g.respTok;
      streamSum += g.stream;
      totDurSum += g.totDur;
      if (g.maxCtx > 0) nativeMaxCtx = g.maxCtx;
    }

    const firstG = gens[0];
    const lastG = gens[gens.length - 1];
    const lastCtx = lastG.ctx;
    const contextLimit = manualLim > 0 ? manualLim : nativeMaxCtx > 0 ? nativeMaxCtx : fallbackLim;
    const streamTps = streamSum >= MIN_STREAM_DUR_SEC ? outTokSum / streamSum : 0;
    const e2eTps = totDurSum > 0 ? outTokSum / totDurSum : 0;
    const tps = Math.round(streamTps > 0 && streamTps <= MAX_SANITY_STREAM_TPS ? streamTps : e2eTps);
    const totalPromptTurn = inTokSum + cacheWriteSum + cacheReadSum;
    const model = formatTurnModelName(gens);
    const cacheRate = totalPromptTurn > 0 ? ((cacheReadSum / totalPromptTurn) * 100).toFixed(1) + '%' : '0.0%';
    const ctxStr = fmtTok(lastCtx);
    const outStr = fmtTok(outTokSum);
    const limitStr = formatContextLimitLabel(contextLimit);
    const ctxPct = Math.round((lastCtx / contextLimit) * 100);

    const badgeParts = [];
    if (model) badgeParts.push(model);
    badgeParts.push(`${tps} t/s`);
    badgeParts.push(`In ${fmtTok(inTokSum + cacheReadSum)}`);
    badgeParts.push(`Out ${outStr}`);
    badgeParts.push(`Cache ${cacheRate}`);
    const badgeText = badgeParts.join(' · ');

    const badgeHtml = [
      model ? `<span class="ag-turn-model">${escapeHtml(model)}</span><span class="ag-sep">·</span>` : '',
      `<span>${tps} t/s</span><span class="ag-sep">·</span>`,
      `<span>Out ${outStr}</span><span class="ag-sep">·</span>`,
      `<span>Cache ${cacheRate}</span>`
    ].join('');

    const badgeTitle = `Ctx ${ctxStr}/${limitStr} (${ctxPct}%) · ${gens.length} 步 · 耗时 ${totDurSum.toFixed(1)}s`;

    turns.push({
      turnIndex: k >= 0 ? k + 1 : 0,
      startStepIdx,
      endStepIdx,
      minGenIdx: firstG.idx,
      maxGenIdx: lastG.idx,
      steps: gens.length,
      model,
      lastCtx,
      ctxStr,
      promptTok: totalPromptTurn,
      promptStr: fmtTok(totalPromptTurn),
      outTok: outTokSum,
      outStr,
      inTok: inTokSum,
      cacheWrite: cacheWriteSum,
      cacheRead: cacheReadSum,
      thinkTok: thinkTokSum,
      respTok: respTokSum,
      streamDur: Number(streamSum.toFixed(1)),
      totDur: Number(totDurSum.toFixed(1)),
      tps,
      e2eTps: Number(e2eTps.toFixed(1)),
      contextLimit,
      limitStr,
      ctxPct,
      cacheRate,
      badgeText,
      badgeHtml,
      badgeTitle
    });
  }

  return turns;
}
