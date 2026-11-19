/**
 * Part 50: Telemetry Pill, Hover Bento Tooltip, Per-Turn Badges & Live 4-State Probe Loop
 */
  // Remove any stale DOM nodes from a prior bundle version so fresh listeners attach cleanly
  try {
    for (const staleId of ['ag-live-metrics-pill', 'ag-live-metrics-tooltip', 'ag-turn-metrics-tooltip']) {
      const staleEl = document.getElementById(staleId);
      if (staleEl) staleEl.remove();
    }
  } catch (e) {}

  function extractCascadeId() {
    try {
      const pathStr = String(window.location && window.location.pathname ? window.location.pathname : '');
      const mRoute = pathStr.match(/\/c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-zA-Z_-]{8,})/i);
      if (mRoute && mRoute[1]) return mRoute[1];
      if (!document.querySelector('[data-testid="home-greeting"], [data-testid="home-splash-content"]')) {
        const selRow = document.querySelector('[data-testid="conversation-row-sidebar"][data-selected="true"]');
        const selCid = selRow ? selRow.getAttribute('data-cascade-id') || '' : '';
        if (selCid) return selCid;
      }
    } catch (e) {}
    return '';
  }

  function isMetricsRouteActive(curCid, m) {
    if (!MODULES.metrics) return false;
    if (curCid) return true;
    const box = document.getElementById(SELECTORS.inputBoxId);
    if (!box) return false;
    return true;
  }

  function positionMetricsTooltip(pill, tt) {
    if (!pill || !tt) return;
    try {
      const rect = pill.getBoundingClientRect();
      const box = document.getElementById(SELECTORS.inputBoxId);
      const boxRect = box ? box.getBoundingClientRect() : null;
      const anchorTop = rect.height > 0 ? rect.top : boxRect ? boxRect.top : 0;
      const anchorLeft = rect.width > 0 ? rect.left + rect.width / 2 : boxRect ? boxRect.left + boxRect.width / 2 : 0;
      const ttW = tt.offsetWidth || tt.getBoundingClientRect().width || 332;
      const vw = window.innerWidth || document.documentElement.clientWidth || 1280;
      const vh = window.innerHeight || document.documentElement.clientHeight || 800;
      const left = Math.max(12, Math.min(Math.round(anchorLeft - ttW / 2), vw - ttW - 12));
      const bottomPx = Math.max(12, Math.round(vh - anchorTop + 10));
      const wrap = tt.querySelector('.ag-tt-wrap');
      if (wrap) {
        wrap.style.maxHeight = Math.max(180, Math.round(anchorTop - 24)) + 'px';
        wrap.style.overflowY = 'auto';
      }
      tt.style.top = 'auto';
      tt.style.bottom = bottomPx + 'px';
      tt.style.left = left + 'px';
    } catch (e) {}
  }

  function ensureMetricsTooltipEl() {
    let tt = document.getElementById('ag-live-metrics-tooltip');
    if (!tt && document.body) {
      tt = document.createElement('div');
      tt.id = 'ag-live-metrics-tooltip';
      document.body.appendChild(tt);
      tt.addEventListener('mouseenter', () => {
        if (window.__ag_tt_hide_timer) {
          clearTimeout(window.__ag_tt_hide_timer);
          window.__ag_tt_hide_timer = null;
        }
      });
      tt.addEventListener('mouseleave', () => {
        if (window.__ag_tt_pinned) return;
        if (window.__ag_tt_hide_timer) clearTimeout(window.__ag_tt_hide_timer);
        window.__ag_tt_hide_timer = setTimeout(() => {
          const curTt = document.getElementById('ag-live-metrics-tooltip');
          if (curTt && !window.__ag_tt_pinned) {
            curTt.removeAttribute('data-visible');
            window.__ag_tt_hover_opened_at = 0;
          }
        }, 180);
      });
      tt.addEventListener('click', (e) => {
        if (window.__ag_tt_hide_timer) {
          clearTimeout(window.__ag_tt_hide_timer);
          window.__ag_tt_hide_timer = null;
        }
        const btn = e.target && e.target.closest ? e.target.closest('.ag-tt-btn-toggle') : null;
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        const expanded = tt.getAttribute('data-expanded') === '1';
        if (expanded) {
          tt.removeAttribute('data-expanded');
        } else {
          tt.setAttribute('data-expanded', '1');
        }
        const pill = document.getElementById('ag-live-metrics-pill');
        if (pill) positionMetricsTooltip(pill, tt);
      });
    }
    if (tt && !tt.innerHTML.trim()) {
      const curCid = extractCascadeId();
      const cachedM = curCid ? window.__ag_last_metrics : null;
      if (cachedM && cachedM.tooltipHtml && (cachedM.cid === curCid || cachedM.cascadeId === curCid)) {
        tt.setAttribute('data-ag-raw-tt', cachedM.tooltipHtml);
        tt.innerHTML = cachedM.tooltipHtml;
      }
    }
    return tt;
  }

  function findInputToolbarContext(inputBox) {
    if (!inputBox) return null;
    const modelTrigger = inputBox.querySelector('[data-testid="model-selector-trigger"]');
    if (!modelTrigger) return null;

    let row = modelTrigger.parentElement;
    for (let i = 0; i < 6 && row && row !== inputBox; i++, row = row.parentElement) {
      if (row.children && row.children.length >= 2) {
        const leftGroup = row.firstElementChild;
        const rightGroup = row.lastElementChild;
        if (leftGroup && rightGroup && leftGroup !== rightGroup && leftGroup.contains(modelTrigger)) {
          return { row, leftGroup, rightGroup };
        }
      }
    }
    return null;
  }

  function ensureMetricsPill(forceLayout = false, resetHysteresis = false) {
    const inputBox = document.getElementById(SELECTORS.inputBoxId);
    if (!inputBox) {
      const stale = document.getElementById('ag-live-metrics-pill');
      if (stale) stale.remove();
      const staleTt = document.getElementById('ag-live-metrics-tooltip');
      if (staleTt) staleTt.removeAttribute('data-visible');
      return null;
    }

    const ctx = findInputToolbarContext(inputBox);
    if (!ctx) return null;
    const { row, leftGroup, rightGroup } = ctx;

    let pill = document.getElementById('ag-live-metrics-pill');
    if (!pill) {
      pill = document.createElement('div');
      pill.id = 'ag-live-metrics-pill';
      pill.innerHTML = '<span id="ag-live-metrics-text"><span class="ag-ctx-pending-dot ag-dot-idle"></span></span>';
      const curCid = extractCascadeId();
      const cachedM = curCid ? window.__ag_last_metrics : null;
      if (cachedM && cachedM.inlineHtml && (cachedM.cid === curCid || cachedM.cascadeId === curCid)) {
        const textEl = pill.querySelector('#ag-live-metrics-text');
        if (textEl) {
          textEl.setAttribute('data-ag-raw-html', cachedM.inlineHtml);
          textEl.innerHTML = cachedM.inlineHtml;
        }
      }

      pill.addEventListener('mouseenter', () => {
        if (window.__ag_tt_hide_timer) {
          clearTimeout(window.__ag_tt_hide_timer);
          window.__ag_tt_hide_timer = null;
        }
        if (window.__ag_tt_show_timer) clearTimeout(window.__ag_tt_show_timer);
        window.__ag_tt_show_timer = setTimeout(() => {
          const tt = ensureMetricsTooltipEl();
          if (!tt || !tt.innerHTML.trim()) return;
          if (tt.getAttribute('data-visible') !== '1') {
            window.__ag_tt_hover_opened_at = Date.now();
          }
          positionMetricsTooltip(pill, tt);
          tt.setAttribute('data-visible', '1');
        }, 85);
      });

      pill.addEventListener('mouseleave', () => {
        if (window.__ag_tt_show_timer) {
          clearTimeout(window.__ag_tt_show_timer);
          window.__ag_tt_show_timer = null;
        }
        if (window.__ag_tt_pinned) return;
        if (window.__ag_tt_hide_timer) clearTimeout(window.__ag_tt_hide_timer);
        window.__ag_tt_hide_timer = setTimeout(() => {
          const tt = document.getElementById('ag-live-metrics-tooltip');
          if (tt && !window.__ag_tt_pinned) {
            tt.removeAttribute('data-visible');
            window.__ag_tt_hover_opened_at = 0;
          }
        }, 180);
      });

      pill.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.__ag_tt_show_timer) {
          clearTimeout(window.__ag_tt_show_timer);
          window.__ag_tt_show_timer = null;
        }
        if (window.__ag_tt_hide_timer) {
          clearTimeout(window.__ag_tt_hide_timer);
          window.__ag_tt_hide_timer = null;
        }
        const tt = ensureMetricsTooltipEl();
        if (!tt || !tt.innerHTML.trim()) return;
        const isVisible = tt.getAttribute('data-visible') === '1';
        const isExpanded = tt.getAttribute('data-expanded') === '1';

        if (!isVisible || !window.__ag_tt_pinned) {
          // 1st click: open & pin L1 summary panel reliably even if hover preview just showed
          tt.removeAttribute('data-expanded');
          tt.setAttribute('data-visible', '1');
          window.__ag_tt_pinned = true;
          window.__ag_tt_hover_opened_at = 0;
        } else if (!isExpanded) {
          // 2nd click: expand L2 detail breakdown
          tt.setAttribute('data-expanded', '1');
          tt.setAttribute('data-visible', '1');
          window.__ag_tt_pinned = true;
        } else {
          // 3rd click: close panel
          tt.removeAttribute('data-expanded');
          tt.removeAttribute('data-visible');
          window.__ag_tt_pinned = false;
          window.__ag_tt_hover_opened_at = 0;
        }
        if (tt.getAttribute('data-visible') === '1') {
          positionMetricsTooltip(pill, tt);
        }
      });
    }

    const boxRect = inputBox.getBoundingClientRect();
    const rowWidth = Math.round(boxRect.width || 0);
    if (resetHysteresis) window.__ag_metrics_row_mode = '';
    const prevMode = window.__ag_metrics_row_mode || '';

    let leftUsed = 0;
    for (let i = 0; i < leftGroup.children.length; i++) {
      const ch = leftGroup.children[i];
      if (ch === pill) continue;
      leftUsed += Math.ceil(ch.getBoundingClientRect().width || 0);
    }
    const rightUsed = Math.ceil(rightGroup.getBoundingClientRect().width || 0);
    const freeWidth = rowWidth - leftUsed - rightUsed - 32;

    const threshold = prevMode === 'middle' ? 168 : 202;
    const mode = rowWidth > 0 && freeWidth >= threshold ? 'middle' : 'bottom';
    const sig = mode + ':' + Math.round(rowWidth / 8);

    if (forceLayout || window.__ag_last_metrics_layout_sig !== sig || !pill.isConnected) {
      window.__ag_metrics_row_mode = mode;
      window.__ag_last_metrics_layout_sig = sig;
      row.setAttribute('data-ag-row-mode', mode);
      pill.setAttribute('data-ag-row-mode', mode);
      if (mode === 'middle') {
        if (pill.parentElement !== leftGroup) {
          leftGroup.appendChild(pill);
        }
      } else if (row.parentElement) {
        if (pill.parentElement !== row.parentElement || row.nextElementSibling !== pill) {
          row.parentElement.insertBefore(pill, row.nextSibling);
        }
      }
    }

    if (window.__ag_metrics_ro_observed !== inputBox && typeof ResizeObserver !== 'undefined') {
      if (window.__ag_metrics_ro) {
        try { window.__ag_metrics_ro.disconnect(); } catch (e) {}
      }
      window.__ag_metrics_ro_observed = inputBox;
      window.__ag_metrics_ro = new ResizeObserver(() => {
        ensureMetricsPill(false, false);
        const tt = document.getElementById('ag-live-metrics-tooltip');
        const p = document.getElementById('ag-live-metrics-pill');
        if (tt && p && tt.getAttribute('data-visible') === '1') {
          positionMetricsTooltip(p, tt);
        }
      });
      try { window.__ag_metrics_ro.observe(inputBox); } catch (e) {}
    }

    return pill;
  }

  function applyPendingWaitVisuals() {
    if (!MODULES.metrics) return null;
    const now = Date.now();
    const curCid = extractCascadeId();
    const m =
      curCid &&
      window.__ag_last_metrics &&
      (window.__ag_last_metrics.cid === curCid || window.__ag_last_metrics.cascadeId === curCid)
        ? window.__ag_last_metrics
        : null;
    const st = m && m.status ? m.status : null;
    const expectedCid = curCid;
    const live = typeof readLiveCascadeRuntimeState === 'function'
      ? readLiveCascadeRuntimeState(expectedCid)
      : null;

    if (!window.__ag_unconn_state || window.__ag_unconn_state.cid !== expectedCid) {
      window.__ag_unconn_state = { cid: expectedCid, startMs: 0 };
    }
    const isUnconnNow = Boolean(
      curCid && live && live.matched && live.hasProvider && Number(live.aspStatus) === 0 && !live.hasTrajectory
    );
    if (isUnconnNow) {
      if (!window.__ag_unconn_state.startMs) {
        window.__ag_unconn_state.startMs = now;
      }
    } else {
      window.__ag_unconn_state.startMs = 0;
    }
    const unconnSec = window.__ag_unconn_state.startMs
      ? Math.max(0, Math.floor((now - window.__ag_unconn_state.startMs) / 1000))
      : 0;

    const stKind = st && st.pendingKind ? String(st.pendingKind) : 'idle';
    const stSteps = st && typeof st.totalSteps === 'number' ? st.totalSteps : 0;
    const stGens = st && typeof st.totalGenerations === 'number' ? st.totalGenerations : 0;
    const curStreamLen = typeof readActiveStreamProgressLen === 'function' ? readActiveStreamProgressLen() : 0;

    if (!window.__ag_pending_wait_state || window.__ag_pending_wait_state.cid !== expectedCid) {
      window.__ag_pending_wait_state = {
        cid: expectedCid,
        kind: stKind,
        startMs: 0,
        lastSteps: stSteps,
        lastGens: stGens,
        lastStreamLen: curStreamLen
      };
    }

    const ws = window.__ag_pending_wait_state;
    const activeProbe = Boolean(
      (stKind !== 'idle') ||
        (live && live.matched && live.hasProvider && (Number(live.effRunStatus) === 2 || live.stopBtnActive || live.execCase === 'modelRequest'))
    );

    if (activeProbe) {
      const progressed =
        stSteps > ws.lastSteps ||
        stGens > ws.lastGens ||
        curStreamLen > ws.lastStreamLen + 1;
      if (!ws.startMs || ws.kind !== stKind || progressed) {
        ws.startMs = now;
      }
      ws.kind = stKind;
      ws.lastSteps = Math.max(ws.lastSteps, stSteps);
      ws.lastGens = Math.max(ws.lastGens, stGens);
      ws.lastStreamLen = Math.max(ws.lastStreamLen, curStreamLen);
    } else {
      ws.startMs = 0;
      ws.kind = 'idle';
      ws.lastSteps = stSteps;
      ws.lastGens = stGens;
      ws.lastStreamLen = curStreamLen;
    }

    const waitSec = ws.startMs ? Math.max(0, Math.floor((now - ws.startMs) / 1000)) : 0;
    const snap = computeStatusSnapshot({
      now,
      st,
      live,
      waitSec,
      unconnSec,
      lastHb: window.__ag_last_daemon_hb || 0,
      visibleSince: window.__ag_visible_since || 0,
      documentHidden: Boolean(document.hidden),
      navigatorOnline: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
      hasConversation: Boolean(curCid),
      curModel: typeof getSelectedModelLabel === 'function' ? getSelectedModelLabel() : ''
    });

    const routeVisible =
      isMetricsRouteActive(curCid, m) || snap.visualState === 'error' || snap.visualState === 'slow' || snap.isExecuting;

    let pill = document.getElementById('ag-live-metrics-pill');
    if (routeVisible && !pill) {
      pill = ensureMetricsPill(false, false);
    }

    if (pill) {
      const hasInlineData = Boolean(m && m.hasData && m.inlineHtml);
      const showPill = Boolean(hasInlineData || routeVisible);
      pill.style.display = showPill ? 'inline-flex' : 'none';

      const textEl = pill.querySelector('#ag-live-metrics-text');
      if (textEl && !hasInlineData && showPill) {
        const fallbackLabel =
          snap.visualState === 'error'
            ? (snap.chipText || '连接异常')
            : snap.visualState === 'slow'
            ? (snap.chipText || '等待响应...')
            : snap.isExecuting
            ? (snap.chipText || '生成中...')
            : '就绪';
        const fallbackHtml =
          '<span class="ag-ctx-pending-dot ag-dot-idle"></span><span>' +
          escapeStatusHtml(fallbackLabel) +
          '</span>';
        if (textEl.getAttribute('data-ag-raw-html') !== fallbackHtml) {
          textEl.setAttribute('data-ag-raw-html', fallbackHtml);
          textEl.innerHTML = fallbackHtml;
        }
      }

      const dotEl = pill.querySelector('.ag-ctx-pending-dot');
      if (dotEl) {
        const targetClass =
          'ag-ctx-pending-dot ' +
          (snap.visualState === 'error'
            ? 'ag-dot-error'
            : snap.visualState === 'slow'
            ? 'ag-dot-slow'
            : snap.visualState === 'running'
            ? 'ag-dot-running'
            : 'ag-dot-idle');
        if (dotEl.className !== targetClass) {
          dotEl.className = targetClass;
        }
        if (dotEl.title !== snap.dotTitle) {
          dotEl.title = snap.dotTitle;
        }
      }
      if (pill.title !== snap.dotTitle) {
        pill.title = snap.dotTitle;
      }
    }

    const tt = document.getElementById('ag-live-metrics-tooltip');
    if (tt) {
      const chipEl = tt.querySelector('.ag-tt-live-chip');
      if (chipEl) {
        if (chipEl.textContent !== snap.chipText) chipEl.textContent = snap.chipText;
        const targetChipClass = 'ag-tt-live-chip' + (snap.chipClass ? ' ' + snap.chipClass : '');
        if (chipEl.className !== targetChipClass) chipEl.className = targetChipClass;
      }
      const noteEl = tt.querySelector('.ag-tt-wait-note');
      if (noteEl) {
        const targetNoteClass = 'ag-tt-wait-note' + (snap.noteClass ? ' ' + snap.noteClass : '');
        if (noteEl.className !== targetNoteClass) noteEl.className = targetNoteClass;
        if (noteEl.getAttribute('data-ag-note-html') !== snap.noteHtml) {
          noteEl.setAttribute('data-ag-note-html', snap.noteHtml);
          noteEl.innerHTML = snap.noteHtml;
          if (pill && tt.getAttribute('data-visible') === '1') {
            positionMetricsTooltip(pill, tt);
          }
        }
      }
    }

    return snap;
  }

  window.__ag_refresh_wait_ui = applyPendingWaitVisuals;

  function extractToolbarStepMeta(tb) {
    try {
      const fk = Object.keys(tb).find(
        (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')
      );
      if (!fk) return null;
      let f = tb[fk];
      let nrcProps = null;
      let iEcProps = null;
      for (let i = 0; i < 14 && f; i++) {
        const p = f.memoizedProps;
        if (p) {
          if (!nrcProps && Array.isArray(p.steps) && 'showThumbsUpDown' in p) nrcProps = p;
          if (!iEcProps && p.cascadeId && Array.isArray(p.trajectorySteps) && typeof p.trajectoryLength === 'number') {
            iEcProps = p;
          }
        }
        if (nrcProps && iEcProps) break;
        f = f.return;
      }
      if (!nrcProps || !iEcProps) return null;
      const tSteps = iEcProps.trajectorySteps;
      const base = iEcProps.trajectoryLength - tSteps.length;
      let maxStep = -1;
      let maxMeta = -1;
      for (let i = 0; i < nrcProps.steps.length; i++) {
        const s = nrcProps.steps[i];
        if (!s) continue;
        const srcInfo = s.metadata && s.metadata.sourceTrajectoryStepInfo;
        let si = srcInfo && typeof srcInfo.stepIndex === 'number' ? srcInfo.stepIndex : -1;
        if (si < 0) {
          const pos = tSteps.indexOf(s);
          if (pos >= 0) si = base + pos;
        }
        if (si > maxStep) maxStep = si;
        if (srcInfo && typeof srcInfo.metadataIndex === 'number' && srcInfo.metadataIndex > maxMeta) {
          maxMeta = srcInfo.metadataIndex;
        }
      }
      return {
        cascadeId: iEcProps.cascadeId || '',
        maxStep,
        maxMeta
      };
    } catch {
      return null;
    }
  }

  function matchTurnForToolbar(turns, meta) {
    if (!turns || turns.length === 0 || !meta) return null;
    if (meta.maxStep >= 0) {
      for (let i = 0; i < turns.length; i++) {
        const t = turns[i];
        if (meta.maxStep >= t.startStepIdx && (t.endStepIdx < 0 || meta.maxStep <= t.endStepIdx)) {
          return t;
        }
      }
    }
    if (meta.maxMeta >= 0) {
      for (let i = 0; i < turns.length; i++) {
        const t = turns[i];
        if (meta.maxMeta >= t.minGenIdx && meta.maxMeta <= t.maxGenIdx) {
          return t;
        }
      }
    }
    return null;
  }

  function formatTurnBadgeData(t) {
    const parts = [];
    if (t.model) parts.push('<span class="ag-turn-model">' + escapeStatusHtml(t.model) + '</span>');
    const promptTok = typeof t.promptTok === 'number' ? t.promptTok : t.inTok + t.cacheWrite + t.cacheRead;
    const promptStr = t.promptStr || '';
    if (promptTok > 0 && promptStr) {
      parts.push('<span>In ' + escapeStatusHtml(promptStr) + '</span>');
    }
    if (t.outTok > 0) parts.push('<span>Out ' + escapeStatusHtml(t.outStr) + '</span>');
    if (promptTok > 0 && t.cacheRate) {
      parts.push('<span>Cache ' + escapeStatusHtml(t.cacheRate) + '</span>');
    }
    if (t.tps > 0) parts.push('<span>' + t.tps + ' tok/s</span>');
    const html = parts.join('<span class="ag-sep"> · </span>');

    const rows = [];
    if (t.lastCtx > 0) {
      const ctxCls = t.ctxPct >= 90 ? 'ag-tmt-ctx-crit' : t.ctxPct >= 75 ? 'ag-tmt-ctx-warn' : '';
      const ctxVal =
        escapeStatusHtml(t.lastCtx.toLocaleString('en-US')) +
        ' / ' +
        escapeStatusHtml(t.limitStr) +
        ' <span class="' +
        ctxCls +
        '">(' +
        escapeStatusHtml(String(t.ctxPct)) +
        '%)</span>';
      rows.push('<div class="ag-tmt-row"><span class="ag-tmt-lbl">当前上下文</span><span class="ag-tmt-val">' + ctxVal + '</span></div>');
    }
    if (t.outTok > 0) {
      const outVal =
        escapeStatusHtml(t.outTok.toLocaleString('en-US')) +
        ' <span class="ag-tmt-sub">(思考 ' +
        escapeStatusHtml(t.thinkTok.toLocaleString('en-US')) +
        ' + 正文/工具 ' +
        escapeStatusHtml(t.respTok.toLocaleString('en-US')) +
        ')</span>';
      rows.push('<div class="ag-tmt-row"><span class="ag-tmt-lbl">本轮输出</span><span class="ag-tmt-val">' + outVal + '</span></div>');
    }
    const promptSum = t.inTok + t.cacheWrite + t.cacheRead;
    if (promptSum > 0) {
      const inVal =
        '新增 ' +
        escapeStatusHtml(t.inTok.toLocaleString('en-US')) +
        (t.cacheWrite > 0 ? ' + 写缓存 ' + escapeStatusHtml(t.cacheWrite.toLocaleString('en-US')) : '') +
        ' + 读缓存 ' +
        escapeStatusHtml(t.cacheRead.toLocaleString('en-US')) +
        ' <span class="ag-tmt-sub">(命中率 ' +
        escapeStatusHtml(t.cacheRate) +
        ')</span>';
      rows.push('<div class="ag-tmt-row"><span class="ag-tmt-lbl">本轮累计输入</span><span class="ag-tmt-val">' + inVal + '</span></div>');
    }
    if (t.tps > 0 || t.totDur > 0) {
      const spdVal =
        (t.tps > 0
          ? escapeStatusHtml(String(t.tps)) +
            ' tok/s <span class="ag-tmt-sub">(端到端 ' +
            escapeStatusHtml(String(t.e2eTps)) +
            ' tok/s)</span> · '
          : '') +
        '流式 ' +
        escapeStatusHtml(String(t.streamDur)) +
        's / 总计 ' +
        escapeStatusHtml(String(t.totDur)) +
        's';
      rows.push('<div class="ag-tmt-row"><span class="ag-tmt-lbl">速度与耗时</span><span class="ag-tmt-val">' + spdVal + '</span></div>');
    }

    const hdrHtml = t.model
      ? '<div class="ag-tmt-hdr"><span class="ag-tmt-model">' +
        escapeStatusHtml(t.model) +
        '</span><span class="ag-tmt-chip">' +
        escapeStatusHtml(String(t.steps || 1)) +
        ' 步</span></div>'
      : '';
    const tooltipHtml = hdrHtml || rows.length > 0 ? hdrHtml + '<div class="ag-tmt-grid">' + rows.join('') + '</div>' : '';
    return { html, tooltipHtml };
  }

  let activeTurnBadgeEl = null;

  function clearTurnTooltipTimers() {
    if (window.__ag_turn_tt_show_timer) {
      clearTimeout(window.__ag_turn_tt_show_timer);
      window.__ag_turn_tt_show_timer = null;
    }
    if (window.__ag_turn_tt_hide_timer) {
      clearTimeout(window.__ag_turn_tt_hide_timer);
      window.__ag_turn_tt_hide_timer = null;
    }
  }

  function hideTurnMetricsTooltip(immediate = false) {
    if (window.__ag_turn_tt_show_timer) {
      clearTimeout(window.__ag_turn_tt_show_timer);
      window.__ag_turn_tt_show_timer = null;
    }
    const doHide = () => {
      window.__ag_turn_tt_hide_timer = null;
      activeTurnBadgeEl = null;
      const tt = document.getElementById('ag-turn-metrics-tooltip');
      if (tt) tt.removeAttribute('data-visible');
    };
    if (immediate) {
      if (window.__ag_turn_tt_hide_timer) {
        clearTimeout(window.__ag_turn_tt_hide_timer);
        window.__ag_turn_tt_hide_timer = null;
      }
      doHide();
      return;
    }
    if (window.__ag_turn_tt_hide_timer) clearTimeout(window.__ag_turn_tt_hide_timer);
    window.__ag_turn_tt_hide_timer = setTimeout(doHide, 110);
  }

  function ensureTurnMetricsTooltipEl() {
    let tt = document.getElementById('ag-turn-metrics-tooltip');
    if (!tt && document.body) {
      tt = document.createElement('div');
      tt.id = 'ag-turn-metrics-tooltip';
      document.body.appendChild(tt);
      tt.addEventListener('mouseenter', () => {
        if (window.__ag_turn_tt_hide_timer) {
          clearTimeout(window.__ag_turn_tt_hide_timer);
          window.__ag_turn_tt_hide_timer = null;
        }
      });
      tt.addEventListener('mouseleave', () => {
        hideTurnMetricsTooltip(false);
      });
    }
    return tt;
  }

  function positionTurnMetricsTooltip(badge, tt) {
    if (!badge || !tt) return;
    try {
      const rect = badge.getBoundingClientRect();
      const vw = window.innerWidth || document.documentElement.clientWidth || 1280;
      const vh = window.innerHeight || document.documentElement.clientHeight || 800;
      const ttRect = tt.getBoundingClientRect();
      const ttW = tt.offsetWidth || ttRect.width || 320;
      const ttH = tt.offsetHeight || ttRect.height || 130;

      const preferAbove = rect.top >= ttH + 16 || rect.top >= vh - rect.bottom;
      const left = Math.max(12, Math.min(Math.round(rect.left), vw - ttW - 12));
      if (preferAbove) {
        const top = Math.max(12, Math.round(rect.top - ttH - 8));
        tt.setAttribute('data-placement', 'above');
        tt.style.top = top + 'px';
      } else {
        const top = Math.min(vh - ttH - 12, Math.round(rect.bottom + 8));
        tt.setAttribute('data-placement', 'below');
        tt.style.top = Math.max(12, top) + 'px';
      }
      tt.style.left = left + 'px';
    } catch (e) {}
  }

  function scheduleShowTurnMetricsTooltip(badge) {
    if (!badge || !badge.__agTurnTtHtml) return;
    if (window.__ag_turn_tt_hide_timer) {
      clearTimeout(window.__ag_turn_tt_hide_timer);
      window.__ag_turn_tt_hide_timer = null;
    }
    if (activeTurnBadgeEl === badge) {
      const existingTt = document.getElementById('ag-turn-metrics-tooltip');
      if (existingTt && existingTt.getAttribute('data-visible') === '1') return;
    }
    if (window.__ag_turn_tt_show_timer) clearTimeout(window.__ag_turn_tt_show_timer);
    window.__ag_turn_tt_show_timer = setTimeout(() => {
      window.__ag_turn_tt_show_timer = null;
      if (!badge.isConnected || !badge.__agTurnTtHtml) return;
      const tt = ensureTurnMetricsTooltipEl();
      if (!tt) return;
      activeTurnBadgeEl = badge;
      if (tt.getAttribute('data-ag-turn-tt-raw') !== badge.__agTurnTtHtml) {
        tt.setAttribute('data-ag-turn-tt-raw', badge.__agTurnTtHtml);
        tt.innerHTML = badge.__agTurnTtHtml;
      }
      positionTurnMetricsTooltip(badge, tt);
      tt.setAttribute('data-visible', '1');
    }, 80);
  }

  function renderTurnMetrics(payload, currentId) {
    try {
      const toolbars = document.querySelectorAll('[data-testid="cascade-system-message-toolbar"]');
      if (!toolbars || toolbars.length === 0) return;
      const cid = currentId || extractCascadeId();
      const payloadCid = payload ? payload.cid || payload.cascadeId || '' : '';
      const turns =
        MODULES.metrics && payload && payload.hasData && (!cid || payloadCid === cid) && Array.isArray(payload.turns)
          ? payload.turns
          : null;

      for (let i = 0; i < toolbars.length; i++) {
        const tb = toolbars[i];
        const row = tb.firstElementChild;
        if (!row) continue;
        let badge = row.querySelector(':scope > .ag-turn-metrics');
        if (!turns || turns.length === 0) {
          if (badge) badge.remove();
          continue;
        }
        const meta = extractToolbarStepMeta(tb);
        if (!meta || (cid && meta.cascadeId && meta.cascadeId !== cid)) {
          if (badge) badge.remove();
          continue;
        }
        const turn = matchTurnForToolbar(turns, meta);
        if (!turn) {
          if (badge) badge.remove();
          continue;
        }
        const { html, tooltipHtml } = formatTurnBadgeData(turn);
        if (!html) {
          if (badge) badge.remove();
          continue;
        }
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'ag-turn-metrics';
          badge.setAttribute('data-ag-turn-metrics', '1');
          row.prepend(badge);
        } else if (row.firstElementChild !== badge) {
          row.prepend(badge);
        }
        if (badge.getAttribute('data-ag-turn-html') !== html) {
          badge.setAttribute('data-ag-turn-html', html);
          badge.innerHTML = html;
        }
        if (badge.hasAttribute('title')) badge.removeAttribute('title');
        badge.__agTurnTtHtml = tooltipHtml;
        if (activeTurnBadgeEl === badge) {
          const tt = document.getElementById('ag-turn-metrics-tooltip');
          if (tt && tt.getAttribute('data-visible') === '1' && tt.getAttribute('data-ag-turn-tt-raw') !== tooltipHtml) {
            tt.setAttribute('data-ag-turn-tt-raw', tooltipHtml);
            tt.innerHTML = tooltipHtml;
            positionTurnMetricsTooltip(badge, tt);
          }
        }
      }
    } catch (e) {}
  }

  function ensureTurnMetricsObserver() {
    if (!MODULES.metrics || !document.body || typeof MutationObserver === 'undefined') return;
    if (window.__ag_turn_metrics_observer) return;
    const scheduleSync = () => {
      if (window.__ag_turn_sync_raf) return;
      window.__ag_turn_sync_raf = requestAnimationFrame(() => {
        window.__ag_turn_sync_raf = null;
        if (window.__ag_last_metrics) {
          renderTurnMetrics(window.__ag_last_metrics, extractCascadeId());
        }
      });
    };
    window.__ag_turn_metrics_observer = new MutationObserver((mutations) => {
      for (let i = 0; i < mutations.length; i++) {
        const added = mutations[i].addedNodes;
        if (!added || added.length === 0) continue;
        for (let j = 0; j < added.length; j++) {
          const n = added[j];
          if (n.nodeType !== 1) continue;
          if (
            (n.getAttribute && n.getAttribute('data-testid') === 'cascade-system-message-toolbar') ||
            (n.querySelector && n.querySelector('[data-testid="cascade-system-message-toolbar"]'))
          ) {
            scheduleSync();
            return;
          }
        }
      }
    });
    try {
      window.__ag_turn_metrics_observer.observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
  }

  window.__ag_render_metrics = function (payload) {
    window.__ag_last_daemon_hb = Date.now();
    const curCid = extractCascadeId();
    if (!payload || typeof payload !== 'object') return;
    const payloadCid = payload.cid || payload.cascadeId || '';
    if (!curCid || (payloadCid && payloadCid !== curCid)) return;

    window.__ag_last_metrics = payload;
    if (!MODULES.metrics) return;

    const pill = ensureMetricsPill(false, false);
    if (pill) {
      const textEl = pill.querySelector('#ag-live-metrics-text');
      if (textEl && payload.inlineHtml) {
        if (textEl.getAttribute('data-ag-raw-html') !== payload.inlineHtml) {
          textEl.setAttribute('data-ag-raw-html', payload.inlineHtml);
          textEl.innerHTML = payload.inlineHtml;
        }
      }
    }

    if (payload.tooltipHtml) {
      const tt = ensureMetricsTooltipEl();
      if (tt && tt.getAttribute('data-ag-raw-tt') !== payload.tooltipHtml) {
        tt.setAttribute('data-ag-raw-tt', payload.tooltipHtml);
        tt.innerHTML = payload.tooltipHtml;
        if (pill && tt.getAttribute('data-visible') === '1') {
          positionMetricsTooltip(pill, tt);
        }
      }
    }

    ensureTurnMetricsObserver();
    renderTurnMetrics(payload, curCid);
    applyPendingWaitVisuals();
  };

  function checkRouteAndMountMetrics() {
    if (!MODULES.metrics) return;
    const curCid = extractCascadeId();
    window.__ag_watched_cascade_id = curCid || '';
    if (window.__ag_last_route_cid !== curCid) {
      window.__ag_last_route_cid = curCid;
      if (typeof window.__agRequestMetrics === 'function') {
        try { window.__agRequestMetrics(curCid || ''); } catch (e) {}
      }
      window.__ag_tt_pinned = false;
      window.__ag_tt_hover_opened_at = 0;
      hideTurnMetricsTooltip(true);
      const tt = document.getElementById('ag-live-metrics-tooltip');
      if (tt) {
        tt.removeAttribute('data-visible');
        tt.removeAttribute('data-expanded');
        tt.removeAttribute('data-ag-raw-tt');
        tt.innerHTML = '';
      }
      window.__ag_last_metrics = null;
      window.__ag_unconn_state = { cid: curCid, startMs: 0 };
      window.__ag_pending_wait_state = { cid: curCid, kind: 'idle', startMs: 0, lastSteps: 0, lastGens: 0, lastStreamLen: 0 };
      document.querySelectorAll('.ag-turn-metrics').forEach((el) => el.remove());
      const pill = document.getElementById('ag-live-metrics-pill');
      const textEl = pill && pill.querySelector('#ag-live-metrics-text');
      if (textEl) {
        textEl.removeAttribute('data-ag-raw-html');
        textEl.innerHTML =
          '<span class="ag-ctx-pending-dot ag-dot-idle"></span><span>' +
          (curCid ? '读取中...' : '就绪') +
          '</span>';
      }
    }
    ensureMetricsPill(false, false);
    ensureTurnMetricsObserver();
    if (curCid && window.__ag_last_metrics && (window.__ag_last_metrics.cid === curCid || window.__ag_last_metrics.cascadeId === curCid)) {
      if (window.__ag_last_metrics.tooltipHtml) {
        ensureMetricsTooltipEl();
      }
      renderTurnMetrics(window.__ag_last_metrics, curCid);
    }
    applyPendingWaitVisuals();
  }

  window.__ag_on_route_change = checkRouteAndMountMetrics;

  if (!window.__ag_history_hooked) {
    window.__ag_history_hooked = true;
    const origPush = history.pushState;
    const origReplace = history.replaceState;
    history.pushState = function () {
      const res = origPush.apply(this, arguments);
      setTimeout(() => window.__ag_on_route_change && window.__ag_on_route_change(), 40);
      return res;
    };
    history.replaceState = function () {
      const res = origReplace.apply(this, arguments);
      setTimeout(() => window.__ag_on_route_change && window.__ag_on_route_change(), 40);
      return res;
    };
  }

  const _onPopState = () => setTimeout(() => checkRouteAndMountMetrics(), 40);
  const _onVisibility = () => {
    if (!document.hidden) {
      window.__ag_visible_since = Date.now();
      applyPendingWaitVisuals();
    }
  };
  const _onNetworkChange = () => applyPendingWaitVisuals();
  const _closeMetricsTooltip = () => {
    window.__ag_tt_pinned = false;
    window.__ag_tt_hover_opened_at = 0;
    hideTurnMetricsTooltip(true);
    const tt = document.getElementById('ag-live-metrics-tooltip');
    if (tt) {
      tt.removeAttribute('data-expanded');
      tt.removeAttribute('data-visible');
    }
  };
  const _onEscapeKey = (e) => {
    if (e && e.key === 'Escape') {
      _closeMetricsTooltip();
    }
  };
  const _onDocClick = (e) => {
    const t = e && e.target;
    if (!t || !t.closest) return;
    if (t.closest('#ag-live-metrics-pill') || t.closest('#ag-live-metrics-tooltip') || t.closest('#ag-turn-metrics-tooltip')) return;
    _closeMetricsTooltip();
  };
  const _onTurnMouseOver = (e) => {
    if (!MODULES.metrics) return;
    const t = e && e.target;
    if (!t || !t.closest) return;
    const badge = t.closest('.ag-turn-metrics');
    if (!badge) return;
    scheduleShowTurnMetricsTooltip(badge);
  };
  const _onTurnMouseOut = (e) => {
    const t = e && e.target;
    if (!t || !t.closest) return;
    const badge = t.closest('.ag-turn-metrics');
    if (!badge) return;
    const rel = e.relatedTarget;
    if (rel && rel.closest && (rel.closest('.ag-turn-metrics') === badge || rel.closest('#ag-turn-metrics-tooltip'))) {
      return;
    }
    hideTurnMetricsTooltip(false);
  };
  const _onTurnScroll = () => {
    if (activeTurnBadgeEl || window.__ag_turn_tt_show_timer) {
      hideTurnMetricsTooltip(true);
    }
  };

  window.__ag_tt_pinned = false;
  window.__ag_tt_hover_opened_at = 0;

  window.addEventListener('popstate', _onPopState);
  document.addEventListener('visibilitychange', _onVisibility);
  window.addEventListener('online', _onNetworkChange);
  window.addEventListener('offline', _onNetworkChange);
  window.addEventListener('keydown', _onEscapeKey, true);
  document.addEventListener('click', _onDocClick, true);
  document.addEventListener('mouseover', _onTurnMouseOver, true);
  document.addEventListener('mouseout', _onTurnMouseOut, true);
  window.addEventListener('scroll', _onTurnScroll, true);

  if (MODULES.metrics) {
    if (!window.__ag_visible_since) window.__ag_visible_since = Date.now();
    window.__ag_metrics_route_watcher = setInterval(() => {
      if (!document.hidden) checkRouteAndMountMetrics();
    }, 2000);
    window.__ag_live_probe_timer = setInterval(() => {
      if (!document.hidden) applyPendingWaitVisuals();
    }, 1000);
  } else {
    try {
      hideTurnMetricsTooltip(true);
      document.querySelectorAll('.ag-turn-metrics').forEach((el) => el.remove());
      if (window.__ag_metrics_ro) {
        window.__ag_metrics_ro.disconnect();
        window.__ag_metrics_ro = null;
        window.__ag_metrics_ro_target = null;
        window.__ag_metrics_ro_observed = null;
        window.__ag_last_metrics_layout_sig = '';
      }
    } catch (e) {}
  }

  window.__ag_cleanup_fns.push(() => {
    window.removeEventListener('popstate', _onPopState);
    document.removeEventListener('visibilitychange', _onVisibility);
    window.removeEventListener('online', _onNetworkChange);
    window.removeEventListener('offline', _onNetworkChange);
    window.removeEventListener('keydown', _onEscapeKey, true);
    document.removeEventListener('click', _onDocClick, true);
    document.removeEventListener('mouseover', _onTurnMouseOver, true);
    document.removeEventListener('mouseout', _onTurnMouseOut, true);
    window.removeEventListener('scroll', _onTurnScroll, true);
    clearTurnTooltipTimers();
    activeTurnBadgeEl = null;
    window.__ag_tt_pinned = false;
    window.__ag_tt_hover_opened_at = 0;
    if (window.__ag_metrics_route_watcher) {
      clearInterval(window.__ag_metrics_route_watcher);
      window.__ag_metrics_route_watcher = null;
    }
    if (window.__ag_live_probe_timer) {
      clearInterval(window.__ag_live_probe_timer);
      window.__ag_live_probe_timer = null;
    }
    if (window.__ag_tt_show_timer) {
      clearTimeout(window.__ag_tt_show_timer);
      window.__ag_tt_show_timer = null;
    }
    if (window.__ag_tt_hide_timer) {
      clearTimeout(window.__ag_tt_hide_timer);
      window.__ag_tt_hide_timer = null;
    }
  });
