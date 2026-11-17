/**
 * Part 50: Telemetry Pill, Hover Bento Tooltip, Per-Turn Badges & Live 4-State Probe Loop
 */
  // Remove any stale DOM nodes from a prior bundle version so fresh listeners attach cleanly
  try {
    for (const staleId of ['ag-live-metrics-pill', 'ag-live-metrics-tooltip']) {
      const staleEl = document.getElementById(staleId);
      if (staleEl) staleEl.remove();
    }
  } catch (e) {}

  function extractCascadeId() {
    try {
      const href = String(window.location && window.location.href ? window.location.href : '');
      const mRoute = href.match(/\/c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-zA-Z_-]{8,})/i);
      if (mRoute && mRoute[1]) return mRoute[1];
      const mUuid = href.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
      if (mUuid && mUuid[1]) return mUuid[1];
    } catch (e) {}
    return '';
  }

  function isMetricsRouteActive(curCid, m) {
    if (!MODULES.metrics) return false;
    if (curCid) return true;
    const box = document.getElementById(SELECTORS.inputBoxId);
    if (!box) return false;
    if (m && m.cid && m.hasData) return true;
    if (!navigator.onLine) return true;
    return false;
  }

  function positionMetricsTooltip(pill, tt) {
    if (!pill || !tt) return;
    try {
      const rect = pill.getBoundingClientRect();
      const ttW = tt.offsetWidth || 320;
      const ttH = tt.offsetHeight || 180;
      const vw = window.innerWidth || document.documentElement.clientWidth || 1280;
      const vh = window.innerHeight || document.documentElement.clientHeight || 800;
      let left = rect.left + rect.width / 2 - ttW / 2;
      left = Math.max(12, Math.min(vw - ttW - 12, left));
      let top = rect.top - ttH - 10;
      if (top < 12) {
        top = Math.min(vh - ttH - 12, rect.bottom + 10);
      }
      tt.style.left = Math.round(left) + 'px';
      tt.style.top = Math.round(top) + 'px';
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
        if (window.__ag_tt_hide_timer) clearTimeout(window.__ag_tt_hide_timer);
        window.__ag_tt_hide_timer = setTimeout(() => {
          const curTt = document.getElementById('ag-live-metrics-tooltip');
          if (curTt) curTt.removeAttribute('data-visible');
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
      const cachedM = window.__ag_last_metrics;
      if (cachedM && cachedM.tooltipHtml && (!curCid || !cachedM.cid || cachedM.cid === curCid)) {
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
      const cachedM = window.__ag_last_metrics;
      if (cachedM && cachedM.inlineHtml && (!curCid || !cachedM.cid || cachedM.cid === curCid)) {
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
          positionMetricsTooltip(pill, tt);
          tt.setAttribute('data-visible', '1');
        }, 85);
      });

      pill.addEventListener('mouseleave', () => {
        if (window.__ag_tt_show_timer) {
          clearTimeout(window.__ag_tt_show_timer);
          window.__ag_tt_show_timer = null;
        }
        if (window.__ag_tt_hide_timer) clearTimeout(window.__ag_tt_hide_timer);
        window.__ag_tt_hide_timer = setTimeout(() => {
          const tt = document.getElementById('ag-live-metrics-tooltip');
          if (tt) tt.removeAttribute('data-visible');
        }, 180);
      });

      pill.addEventListener('click', (e) => {
        e.stopPropagation();
        const tt = ensureMetricsTooltipEl();
        if (!tt || !tt.innerHTML.trim()) return;
        if (tt.getAttribute('data-visible') === '1') {
          tt.removeAttribute('data-visible');
        } else {
          positionMetricsTooltip(pill, tt);
          tt.setAttribute('data-visible', '1');
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
    const m = window.__ag_last_metrics && (!curCid || window.__ag_last_metrics.cid === curCid)
      ? window.__ag_last_metrics
      : null;
    const st = m && m.status ? m.status : null;
    const expectedCid = curCid || (m && m.cid) || '';
    const live = typeof readLiveCascadeRuntimeState === 'function'
      ? readLiveCascadeRuntimeState(expectedCid)
      : null;

    if (!window.__ag_unconn_state || window.__ag_unconn_state.cid !== expectedCid) {
      window.__ag_unconn_state = { cid: expectedCid, startMs: 0 };
    }
    const isUnconnNow = Boolean(live && live.matched && live.hasProvider && Number(live.aspStatus) === 0 && !live.hasTrajectory);
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
        }
      }
    }

    return snap;
  }

  window.__ag_refresh_wait_ui = applyPendingWaitVisuals;

  function renderTurnMetrics(payload, currentId) {
    if (!MODULES.metrics || !document.body) return;
    const cid = currentId || extractCascadeId();
    const list = payload && payload.cid === cid && Array.isArray(payload.turns) ? payload.turns : [];
    const existing = document.querySelectorAll('.ag-turn-metrics');
    if (list.length === 0) {
      for (let i = 0; i < existing.length; i++) existing[i].remove();
      return;
    }

    const msgNodes = document.querySelectorAll(
      '[data-testid="agent-message"], [data-testid="assistant-message"], [data-message-author-role="assistant"]'
    );
    if (!msgNodes.length) return;

    const count = Math.min(msgNodes.length, list.length);
    for (let i = 0; i < count; i++) {
      const msgEl = msgNodes[msgNodes.length - 1 - i];
      const turn = list[list.length - 1 - i];
      if (!msgEl || !turn || (!turn.badgeHtml && !turn.badgeText)) continue;
      let badge = msgEl.querySelector(':scope > .ag-turn-metrics');
      if (!badge) {
        badge = document.createElement('div');
        badge.className = 'ag-turn-metrics';
        msgEl.appendChild(badge);
      }
      if (turn.badgeHtml) {
        if (badge.getAttribute('data-ag-turn-html') !== turn.badgeHtml) {
          badge.setAttribute('data-ag-turn-html', turn.badgeHtml);
          badge.innerHTML = turn.badgeHtml;
        }
      } else if (badge.textContent !== turn.badgeText) {
        badge.textContent = turn.badgeText;
      }
      if (turn.badgeTitle && badge.title !== turn.badgeTitle) {
        badge.title = turn.badgeTitle;
      }
    }
  }

  function ensureTurnMetricsObserver() {
    if (!MODULES.metrics || !document.body) return;
    if (window.__ag_turn_metrics_observer) return;
    window.__ag_turn_metrics_observer = new MutationObserver(() => {
      if (window.__ag_turn_sync_raf) return;
      window.__ag_turn_sync_raf = requestAnimationFrame(() => {
        window.__ag_turn_sync_raf = null;
        if (window.__ag_last_metrics) {
          renderTurnMetrics(window.__ag_last_metrics, extractCascadeId());
        }
      });
    });
    try {
      window.__ag_turn_metrics_observer.observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
  }

  window.__ag_render_metrics = function (payload) {
    window.__ag_last_daemon_hb = Date.now();
    const curCid = extractCascadeId();
    if (!payload || typeof payload !== 'object') return;
    if (curCid && payload.cid && payload.cid !== curCid) return;

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
      }
    }

    ensureTurnMetricsObserver();
    renderTurnMetrics(payload, curCid);
    applyPendingWaitVisuals();
  };

  function checkRouteAndMountMetrics() {
    if (!MODULES.metrics) return;
    const curCid = extractCascadeId();
    if (curCid) {
      window.__ag_watched_cascade_id = curCid;
    } else if (window.__ag_watched_cascade_id && window.location && window.location.pathname === '/') {
      window.__ag_watched_cascade_id = '';
    }
    if (window.__ag_last_route_cid !== curCid) {
      window.__ag_last_route_cid = curCid;
      if (curCid && typeof window.__agRequestMetrics === 'function') {
        try { window.__agRequestMetrics(curCid); } catch (e) {}
      }
      const tt = document.getElementById('ag-live-metrics-tooltip');
      if (tt) tt.removeAttribute('data-visible');
      if (window.__ag_last_metrics && curCid && window.__ag_last_metrics.cid !== curCid) {
        window.__ag_last_metrics = null;
        const pill = document.getElementById('ag-live-metrics-pill');
        const textEl = pill && pill.querySelector('#ag-live-metrics-text');
        if (textEl) {
          textEl.removeAttribute('data-ag-raw-html');
          textEl.innerHTML = '<span class="ag-ctx-pending-dot ag-dot-idle"></span><span>读取中...</span>';
        }
      }
    }
    ensureMetricsPill(false, false);
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
  const _onEscapeKey = (e) => {
    if (e && e.key === 'Escape') {
      const tt = document.getElementById('ag-live-metrics-tooltip');
      if (tt) tt.removeAttribute('data-visible');
    }
  };

  window.addEventListener('popstate', _onPopState);
  document.addEventListener('visibilitychange', _onVisibility);
  window.addEventListener('online', _onNetworkChange);
  window.addEventListener('offline', _onNetworkChange);
  window.addEventListener('keydown', _onEscapeKey, true);

  if (MODULES.metrics) {
    if (!window.__ag_visible_since) window.__ag_visible_since = Date.now();
    window.__ag_metrics_route_watcher = setInterval(() => {
      if (!document.hidden) checkRouteAndMountMetrics();
    }, 2000);
    window.__ag_live_probe_timer = setInterval(() => {
      if (!document.hidden) applyPendingWaitVisuals();
    }, 1000);
  }

  window.__ag_cleanup_fns.push(() => {
    window.removeEventListener('popstate', _onPopState);
    document.removeEventListener('visibilitychange', _onVisibility);
    window.removeEventListener('online', _onNetworkChange);
    window.removeEventListener('offline', _onNetworkChange);
    window.removeEventListener('keydown', _onEscapeKey, true);
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
