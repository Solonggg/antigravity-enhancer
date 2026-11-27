/**
 * Part 50: Telemetry Pill, Hover Bento Tooltip, Per-Turn Badges & Live 4-State Probe Loop
 * Supports both the main conversation pane and the right-hand Side Question (旁路提问) pane.
 */
  // Remove any stale DOM nodes and observers from a prior bundle version so fresh listeners attach cleanly
  try {
    for (const staleId of ['ag-live-metrics-pill', 'ag-side-metrics-pill', 'ag-live-metrics-tooltip', 'ag-turn-metrics-tooltip']) {
      const staleEl = document.getElementById(staleId);
      if (staleEl) staleEl.remove();
    }
    document.querySelectorAll('.ag-live-metrics-pill').forEach((el) => el.remove());
    document.querySelectorAll('[data-ag-row-mode]').forEach((el) => el.removeAttribute('data-ag-row-mode'));
    document.querySelectorAll('[data-ag-turn-row]').forEach((el) => el.removeAttribute('data-ag-turn-row'));
    if (window.__ag_pane_states && typeof window.__ag_pane_states === 'object') {
      for (const k of Object.keys(window.__ag_pane_states)) {
        const ps = window.__ag_pane_states[k];
        if (ps && ps.roRaf && typeof cancelAnimationFrame === 'function') {
          try { cancelAnimationFrame(ps.roRaf); } catch (e) {}
        }
        if (ps && ps.ro) {
          try { ps.ro.disconnect(); } catch (e) {}
        }
      }
    }
    if (window.__ag_turn_metrics_observer) {
      try { window.__ag_turn_metrics_observer.disconnect(); } catch (e) {}
      window.__ag_turn_metrics_observer = null;
    }
  } catch (e) {}

  const AG_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const SHOW_SESSION_STATUS = typeof MODULES.sessionStatus === 'boolean' ? MODULES.sessionStatus : Boolean(MODULES.metrics);
  const SHOW_USAGE_STATS = typeof MODULES.usageStats === 'boolean' ? MODULES.usageStats : Boolean(MODULES.metrics);
  const HAS_TELEMETRY_UI = Boolean(SHOW_SESSION_STATUS || SHOW_USAGE_STATS);
  const metricsByCid = (window.__ag_metrics_by_cid = {});
  const paneStates = (window.__ag_pane_states = {});

  function getOrCreatePaneState(key) {
    if (!paneStates[key]) {
      paneStates[key] = {
        cid: '',
        unconnStartMs: 0,
        pendingKind: 'idle',
        waitStartMs: 0,
        lastSteps: 0,
        lastGens: 0,
        lastStreamLen: 0,
        wasExecuting: false,
        lastLiveStepsLen: 0,
        lastRefreshReqAt: 0,
        postTurnTimer1: null,
        postTurnTimer2: null,
        postTurnQuotaTimer: null,
        rowMode: '',
        layoutSig: '',
        ro: null,
        roObserved: null,
        roRaf: 0,
        lastSnap: null
      };
    }
    return paneStates[key];
  }

  function clearPanePostTurnTimers(ps) {
    if (!ps) return;
    if (ps.postTurnTimer1) {
      clearTimeout(ps.postTurnTimer1);
      ps.postTurnTimer1 = null;
    }
    if (ps.postTurnTimer2) {
      clearTimeout(ps.postTurnTimer2);
      ps.postTurnTimer2 = null;
    }
    if (ps.postTurnQuotaTimer) {
      clearTimeout(ps.postTurnQuotaTimer);
      ps.postTurnQuotaTimer = null;
    }
  }

  function storeMetricsPayload(cid, payload) {
    if (!cid || !payload) return;
    if (Object.prototype.hasOwnProperty.call(metricsByCid, cid)) {
      delete metricsByCid[cid];
    }
    metricsByCid[cid] = payload;
    const keys = Object.keys(metricsByCid);
    if (keys.length > 12) {
      delete metricsByCid[keys[0]];
    }
  }

  function extractCascadeId() {
    try {
      const pathStr = String(window.location && window.location.pathname ? window.location.pathname : '');
      const mRoute = pathStr.match(/\/c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-zA-Z_-]{8,})/i);
      if (mRoute && mRoute[1]) return mRoute[1];

      const onHomeSplash = Boolean(
        document.querySelector('[data-testid="home-greeting"], [data-testid="home-splash-content"]')
      );
      const selRow = !onHomeSplash
        ? document.querySelector('[data-testid="conversation-row-sidebar"][data-selected="true"]')
        : null;
      const selCid = selRow ? String(selRow.getAttribute('data-cascade-id') || '').trim() : '';

      if (typeof document.querySelectorAll === 'function') {
        const views = document.querySelectorAll('[data-testid="conversation-view"][data-cascade-id]');
        const visibleIds = [];
        let focusedId = '';
        const activeEl = document.activeElement || null;
        for (let i = 0; i < views.length; i++) {
          const viewEl = views[i];
          const cid = String(viewEl.getAttribute('data-cascade-id') || '').trim();
          if (!AG_UUID_RE.test(cid)) continue;
          if (viewEl.hasAttribute && viewEl.hasAttribute('hidden')) continue;
          if (viewEl.getBoundingClientRect) {
            const r = viewEl.getBoundingClientRect();
            if (r && r.width <= 0 && r.height <= 0) continue;
          }
          visibleIds.push(cid);
          if (activeEl && viewEl.contains && viewEl.contains(activeEl)) {
            focusedId = cid;
          }
        }
        if (focusedId) return focusedId;
        if (selCid && AG_UUID_RE.test(selCid) && visibleIds.some((id) => id.toLowerCase() === selCid.toLowerCase())) {
          return selCid;
        }
        if (visibleIds.length > 0) return visibleIds[0];
      }

      const mainView = document.querySelector('[data-testid="conversation-view"][data-cascade-id]');
      const viewCid = mainView ? String(mainView.getAttribute('data-cascade-id') || '').trim() : '';
      if (AG_UUID_RE.test(viewCid)) return viewCid;

      if (!onHomeSplash && typeof readLiveCascadeRuntimeState === 'function') {
        const live = readLiveCascadeRuntimeState('', null, document);
        if (live && live.hasProvider && live.cid && AG_UUID_RE.test(live.cid)) {
          return live.cid;
        }
      }

      if (selCid) return selCid;
    } catch (e) {}
    return '';
  }

  function extractSideCascadeId(sideContent) {
    try {
      if (!sideContent) return '';
      const convEl = sideContent.querySelector('[data-testid="side-question-tab-conversation"][data-cascade-id]');
      const attrCid = convEl ? String(convEl.getAttribute('data-cascade-id') || '').trim() : '';
      if (AG_UUID_RE.test(attrCid)) return attrCid;
    } catch (e) {}
    return '';
  }

  function isElementHiddenOrCollapsed(el) {
    if (!el) return true;
    if (el.hasAttribute && el.hasAttribute('hidden')) return true;
    if (el.closest && el.closest('[hidden]')) return true;
    if (el.getBoundingClientRect) {
      const r = el.getBoundingClientRect();
      if (r && r.width <= 0 && r.height <= 0) return true;
    }
    return false;
  }

  function discoverConversationPanes() {
    const panes = [];
    try {
      const boxes = document.querySelectorAll('[id="' + SELECTORS.inputBoxId + '"]');
      const mainCid = extractCascadeId();
      const activeEl = document.activeElement || null;
      const mainVisible = [];
      let fallbackMainBox = null;
      let sideFound = false;
      for (let i = 0; i < boxes.length; i++) {
        const box = boxes[i];
        const sideContent = box.closest ? box.closest('[data-testid="side-question-tab-content"]') : null;
        const inSide = Boolean(
          sideContent || (box.closest && box.closest('[data-testid="side-question-tab-composer"]'))
        );
        if (inSide) {
          if (sideFound) continue;
          sideFound = true;
          panes.push({
            key: 'side',
            pillId: 'ag-side-metrics-pill',
            inputBox: box,
            container: sideContent || box.parentElement || document,
            cid: extractSideCascadeId(sideContent)
          });
        } else {
          if (isElementHiddenOrCollapsed(box)) {
            if (!fallbackMainBox) fallbackMainBox = box;
            continue;
          }
          mainVisible.push(box);
        }
      }

      let chosenMainBox = null;
      if (mainVisible.length > 0) {
        if (activeEl) {
          chosenMainBox =
            mainVisible.find((b) => {
              const v = b.closest && b.closest('[data-testid="conversation-view"]');
              return Boolean((b.contains && b.contains(activeEl)) || (v && v.contains && v.contains(activeEl)));
            }) || null;
        }
        if (!chosenMainBox && mainCid) {
          chosenMainBox =
            mainVisible.find((b) => {
              const v = b.closest && b.closest('[data-testid="conversation-view"]');
              return Boolean(v && String(v.getAttribute('data-cascade-id') || '').trim() === mainCid);
            }) || null;
        }
        if (!chosenMainBox) chosenMainBox = mainVisible[0];
      } else {
        chosenMainBox = fallbackMainBox;
      }

      if (chosenMainBox) {
        panes.unshift({
          key: 'main',
          pillId: 'ag-live-metrics-pill',
          inputBox: chosenMainBox,
          container: (chosenMainBox.closest && chosenMainBox.closest('[data-testid="conversation-view"]')) || document,
          cid: mainCid
        });
      }
    } catch (e) {}
    return panes;
  }

  function getPaneByKey(paneKey) {
    const panes = discoverConversationPanes();
    for (let i = 0; i < panes.length; i++) {
      if (panes[i].key === paneKey) return panes[i];
    }
    return null;
  }

  function getWatchedCascadeIds() {
    const out = [];
    const add = (id) => {
      const s = String(id || '').trim();
      if (AG_UUID_RE.test(s) && !out.includes(s)) out.push(s);
    };
    add(extractCascadeId());
    try {
      document.querySelectorAll('[data-testid="side-question-tab-content"]').forEach((sc) => {
        add(extractSideCascadeId(sc));
      });
    } catch (e) {}
    return out;
  }

  window.__ag_get_watched_cascade_ids = getWatchedCascadeIds;

  function requestMetricsFromDaemon({ force = false, bypassCache = false, reason = '', minIntervalMs = 600 } = {}) {
    if (!HAS_TELEMETRY_UI) return false;
    if (typeof window.__agRequestMetrics !== 'function') return false;
    const watchedIds = getWatchedCascadeIds();
    const watchedSig = watchedIds.join(',');
    const routeChanged = window.__ag_last_watched_sig !== watchedSig;
    const now = Date.now();
    if (!routeChanged && !force && !bypassCache) return false;
    if (
      !routeChanged &&
      reason !== 'manual' &&
      minIntervalMs > 0 &&
      now - (window.__ag_last_metrics_req_at || 0) < minIntervalMs
    ) {
      return false;
    }
    try {
      const payload =
        force || bypassCache
          ? JSON.stringify({
              cids: watchedIds,
              force: Boolean(force),
              bypassCache: Boolean(bypassCache || force),
              reason: reason || (routeChanged ? 'route' : 'refresh')
            })
          : watchedSig;
      window.__agRequestMetrics(payload);
      window.__ag_last_watched_sig = watchedSig;
      window.__ag_last_metrics_req_at = now;
      return true;
    } catch (e) {
      return false;
    }
  }

  let quotaStoreUnsub = null;
  function ensureQuotaStoreSubscription(scopeEl = null) {
    if (!SHOW_USAGE_STATS || quotaStoreUnsub || typeof subscribeOfficialQuotaStore !== 'function') return;
    const unsub = subscribeOfficialQuotaStore((entry) => {
      const tt = document.getElementById('ag-live-metrics-tooltip');
      if (!tt || !entry || !Array.isArray(entry.rawGroups)) return;
      const isZh = MODULES.i18n !== false;
      const ownerKey = window.__ag_tt_owner_pane || 'main';
      const ownerPane = getPaneByKey(ownerKey);
      const ownerPill = document.getElementById(ownerKey === 'side' ? 'ag-side-metrics-pill' : 'ag-live-metrics-pill');
      const groups =
        typeof normalizeOfficialQuotaGroups === 'function'
          ? normalizeOfficialQuotaGroups(entry.rawGroups, { nowMs: Date.now(), isZh })
          : [];
      applyOfficialQuotaToTooltipDom(
        tt,
        {
          loading: false,
          groups,
          availableCredits: entry.availableCredits,
          useAICredits: entry.useAICredits
        },
        ownerPill,
        ownerPane ? ownerPane.inputBox : null
      );
    }, scopeEl);
    if (typeof unsub === 'function') {
      quotaStoreUnsub = unsub;
    }
  }

  function isMetricsRouteActive(pane) {
    if (!HAS_TELEMETRY_UI) return false;
    if (!pane) return false;
    if (SHOW_SESSION_STATUS) {
      if (pane.cid) return true;
      return Boolean(pane.inputBox);
    }
    if (SHOW_USAGE_STATS) {
      if (!pane.cid) return false;
      const m = metricsByCid[pane.cid];
      return Boolean(m && m.hasData && m.inlineHtml);
    }
    return false;
  }

  function buildStatusOnlyTooltipHtml(snap) {
    const chipClass = snap && snap.chipClass ? ' ' + snap.chipClass : '';
    const chipText = snap && snap.chipText ? escapeStatusHtml(snap.chipText) : '就绪';
    const noteClass = snap && snap.noteClass ? ' ' + snap.noteClass : '';
    const noteHtml = snap && snap.noteHtml ? snap.noteHtml : '';
    const descText =
      snap && snap.visualState === 'running'
        ? snap.dotTitle || '会话正在执行中。'
        : snap && (snap.visualState === 'slow' || snap.visualState === 'error')
        ? ''
        : '会话连接正常，随时可继续对话。';
    return (
      '<div class="ag-tt-wrap ag-tt-status-only">' +
      '<div class="ag-tt-hdr">' +
      '<span class="ag-tt-hdr-left">实时会话状态</span>' +
      '<span class="ag-tt-hdr-right"><span class="ag-tt-live-chip' +
      chipClass +
      '">' +
      chipText +
      '</span></span>' +
      '</div>' +
      '<div class="ag-tt-wait-note' +
      noteClass +
      '" id="ag-tt-wait-note">' +
      noteHtml +
      '</div>' +
      (descText ? '<div class="ag-tt-status-desc" data-ag-status-desc="1">' + escapeStatusHtml(descText) + '</div>' : '<div class="ag-tt-status-desc" data-ag-status-desc="1" hidden></div>') +
      '</div>'
    );
  }

  function formatShortQuotaGroupName(rawName) {
    const s = String(rawName || '').trim();
    if (!s) return '';
    if (/^gemini\s+models?$/i.test(s)) return 'Gemini';
    if (/^claude\s+(?:and|&)\s+gpt(?:\s+models?)?$/i.test(s)) return 'Claude & GPT';
    return s.replace(/\s+models?$/i, '').trim();
  }

  function renderOfficialQuotaSectionHtml(state, isZh) {
    const title = isZh ? '模型配额' : 'Model Quota';
    const modeLbl = isZh ? '已用比例' : 'Used %';
    const refreshLbl = isZh ? '刷新配额' : 'Refresh quota';
    const loading = Boolean(state && state.loading);
    const groups = state && Array.isArray(state.groups) ? state.groups : [];

    let bodyHtml = '';
    if (loading && groups.length === 0) {
      bodyHtml = '<div class="ag-tt-quota-empty">' + escapeStatusHtml(isZh ? '正在读取配额…' : 'Loading quota…') + '</div>';
    } else if (groups.length === 0) {
      bodyHtml =
        '<div class="ag-tt-quota-empty">' +
        escapeStatusHtml(isZh ? '暂无配额信息' : 'No quota info') +
        '</div>';
    } else {
      const itemsHtml = [];
      for (let gi = 0; gi < groups.length; gi++) {
        const g = groups[gi];
        const rawBuckets = Array.isArray(g.buckets) ? g.buckets.slice() : [];
        rawBuckets.sort((a, b) => (a.windowOrder || 9) - (b.windowOrder || 9));
        const shortGroup = formatShortQuotaGroupName(g.displayName || '');
        for (let bi = 0; bi < rawBuckets.length; bi++) {
          const b = rawBuckets[bi];
          const winRaw = b.shortWindowLabel || b.windowLabel || b.displayName || '';
          const winPrefix = isZh && winRaw === '每周' ? '周限' : winRaw;
          const rowLabel =
            winPrefix && shortGroup
              ? winPrefix + ' · ' + shortGroup
              : shortGroup || winPrefix || (isZh ? '配额' : 'Quota');

          const hasPct = !b.disabled && typeof b.remainingPct === 'number' && Number.isFinite(b.remainingPct);
          const usedPct = hasPct ? Math.max(0, Math.min(100, 100 - b.remainingPct)) : null;
          const level = b.disabled ? 'unknown' : b.level || 'ok';
          const resetTxt = b.resetText || b.shortResetText || (hasPct && usedPct === 0 ? (isZh ? '满额可用' : 'Full') : '');
          const usedText = b.disabled
            ? isZh ? '未启用' : 'Off'
            : usedPct !== null
            ? (isZh ? '已用 ' : 'Used ') + usedPct + '%'
            : '—';
          const metaParts = [];
          if (resetTxt) metaParts.push('<span class="ag-tt-qbar-reset">' + escapeStatusHtml(resetTxt) + '</span>');
          metaParts.push('<span class="ag-tt-quota-pct ag-q-' + escapeStatusHtml(level) + '">' + escapeStatusHtml(usedText) + '</span>');
          const fillWidth = usedPct !== null && usedPct > 0 ? Math.max(3, usedPct) : 0;
          const rowTitleAttr = b.resetText ? ' title="' + escapeStatusHtml(b.resetText) + '"' : '';

          itemsHtml.push(
            '<div class="ag-tt-qbar-item"' +
              rowTitleAttr +
              '>' +
              '<div class="ag-tt-qbar-head">' +
              '<span class="ag-tt-qbar-lbl">' +
              escapeStatusHtml(rowLabel) +
              '</span>' +
              '<span class="ag-tt-qbar-meta">' +
              metaParts.join('<span class="ag-tt-qbar-dot">·</span>') +
              '</span>' +
              '</div>' +
              '<div class="ag-tt-qbar-track">' +
              '<div class="ag-tt-qbar-fill ag-q-' +
              escapeStatusHtml(level) +
              '" style="width:' +
              fillWidth +
              '%"></div>' +
              '</div>' +
              '</div>'
          );
        }
      }
      bodyHtml = '<div class="ag-tt-qbar-list">' + itemsHtml.join('') + '</div>';
    }

    return (
      '<div class="ag-tt-hdr ag-tt-quota-hdr">' +
      '<span class="ag-tt-quota-title-wrap"><span class="ag-tt-hdr-left">' +
      escapeStatusHtml(title) +
      '</span></span>' +
      '<span class="ag-tt-quota-actions">' +
      '<span class="ag-tt-quota-mode">' +
      escapeStatusHtml(modeLbl) +
      '</span>' +
      '<button type="button" class="ag-tt-quota-btn ag-tt-quota-refresh' +
      (loading ? ' is-loading' : '') +
      '" aria-label="' +
      escapeStatusHtml(refreshLbl) +
      '" title="' +
      escapeStatusHtml(refreshLbl) +
      '">' +
      '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 8a5.5 5.5 0 1 1-1.4-3.67M13.5 2.5v2.8h-2.8"/></svg>' +
      '</button>' +
      '</span>' +
      '</div>' +
      bodyHtml
    );
  }

  function applyOfficialQuotaToTooltipDom(tt, state, ownerPill, ownerBox) {
    if (!tt || !SHOW_USAGE_STATS) return;
    const slot = tt.querySelector('[data-ag-quota-slot="1"]');
    if (!slot) return;
    const isZh = MODULES.i18n !== false;
    const html = renderOfficialQuotaSectionHtml(state, isZh);
    if (slot.getAttribute('data-ag-quota-html') !== html) {
      slot.setAttribute('data-ag-quota-html', html);
      slot.innerHTML = html;
      if (ownerPill && tt.getAttribute('data-visible') === '1') {
        positionMetricsTooltip(ownerPill, tt, ownerBox);
      }
    }
  }

  function syncOfficialQuotaIntoTooltip(
    tt,
    { forceRefresh = false, allowBackgroundForce = true, staleTtlMs = 30000, scopeEl = null } = {}
  ) {
    if (!tt || !SHOW_USAGE_STATS) return;
    const slot = tt.querySelector('[data-ag-quota-slot="1"]');
    if (!slot || typeof loadOfficialQuotaSummary !== 'function') return;

    const isZh = MODULES.i18n !== false;
    const ownerKey = window.__ag_tt_owner_pane || 'main';
    const ownerPane = getPaneByKey(ownerKey);
    const ownerPill = document.getElementById(ownerKey === 'side' ? 'ag-side-metrics-pill' : 'ag-live-metrics-pill');
    const ownerBox = scopeEl || (ownerPane ? ownerPane.inputBox : null);
    ensureQuotaStoreSubscription(ownerBox);

    const quotaState = typeof getOfficialQuotaState === 'function' ? getOfficialQuotaState() : null;
    const existingCache = (quotaState && quotaState.cache) || window.__ag_official_quota_cache;
    const hasCachedGroups = Boolean(
      existingCache && Array.isArray(existingCache.rawGroups) && existingCache.rawGroups.length > 0
    );
    const now = Date.now();
    const isDirty = Boolean(quotaState && quotaState.dirty);
    const resetPassed =
      hasCachedGroups &&
      typeof hasExpiredQuotaResetWindow === 'function' &&
      hasExpiredQuotaResetWindow(existingCache.rawGroups, now);
    const cacheStale = !existingCache || !existingCache.fetchedAt || now - existingCache.fetchedAt >= staleTtlMs;
    const shouldFetch = Boolean(forceRefresh || !hasCachedGroups || isDirty || resetPassed || cacheStale);

    if (hasCachedGroups) {
      const cachedGroups =
        typeof normalizeOfficialQuotaGroups === 'function'
          ? normalizeOfficialQuotaGroups(existingCache.rawGroups, { nowMs: now, isZh })
          : [];
      applyOfficialQuotaToTooltipDom(
        tt,
        {
          loading: shouldFetch,
          groups: cachedGroups,
          availableCredits: existingCache.availableCredits,
          useAICredits: existingCache.useAICredits
        },
        ownerPill,
        ownerBox
      );
      if (!shouldFetch) {
        return;
      }
    } else {
      applyOfficialQuotaToTooltipDom(tt, { loading: true, groups: [] }, ownerPill, ownerBox);
    }

    loadOfficialQuotaSummary({ forceRefresh, allowBackgroundForce, staleTtlMs, scopeEl: ownerBox, isZh }).then((res) => {
      const curTt = document.getElementById('ag-live-metrics-tooltip');
      if (!curTt) return;
      const curKey = window.__ag_tt_owner_pane || 'main';
      const curPane = getPaneByKey(curKey);
      const curPill = document.getElementById(curKey === 'side' ? 'ag-side-metrics-pill' : 'ag-live-metrics-pill');
      applyOfficialQuotaToTooltipDom(
        curTt,
        {
          loading: false,
          groups: (res && res.groups) || [],
          availableCredits: res ? res.availableCredits : null,
          useAICredits: Boolean(res && res.useAICredits)
        },
        curPill,
        curPane ? curPane.inputBox : ownerBox
      );
    });
  }

  function applyUsageTooltipHtml(tt, rawHtml) {
    if (!tt || !rawHtml) return false;
    if (tt.getAttribute('data-ag-raw-tt') === rawHtml) return false;
    tt.setAttribute('data-ag-raw-tt', rawHtml);

    // Patch only the left usage column in-place when dashboard layout is already mounted,
    // preserving the right-hand official quota DOM and scroll position with zero flicker.
    if (rawHtml.includes('ag-tt-col-usage')) {
      try {
        const curWrap = tt.querySelector('.ag-tt-wrap');
        const curUsageCol = tt.querySelector('.ag-tt-col-usage');
        const curQuotaSlot = tt.querySelector('[data-ag-quota-slot="1"]');
        if (curUsageCol && curQuotaSlot) {
          const tmp = document.createElement('div');
          tmp.innerHTML = rawHtml;
          const nextWrap = tmp.querySelector('.ag-tt-wrap');
          const nextUsageCol = tmp.querySelector('.ag-tt-col-usage');
          if (nextUsageCol && nextUsageCol.innerHTML) {
            const prevWrapScroll = curWrap ? curWrap.scrollTop || 0 : 0;
            const prevUsageScroll = curUsageCol.scrollTop || 0;
            if (curWrap && nextWrap && curWrap.className !== nextWrap.className) {
              curWrap.className = nextWrap.className;
            }
            curUsageCol.innerHTML = nextUsageCol.innerHTML;
            if (curWrap && prevWrapScroll > 0) curWrap.scrollTop = prevWrapScroll;
            if (prevUsageScroll > 0) curUsageCol.scrollTop = prevUsageScroll;
            return 'partial';
          }
        }
      } catch (e) {}
    }

    tt.innerHTML = rawHtml;
    return 'full';
  }

  function positionMetricsTooltip(pill, tt, inputBox) {
    if (!pill || !tt) return;
    try {
      const rect = pill.getBoundingClientRect();
      const textEl = pill.querySelector('.ag-live-metrics-text');
      const textRect = textEl ? textEl.getBoundingClientRect() : null;
      const anchorRect = textRect && textRect.width > 0 && textRect.height > 0 ? textRect : rect;
      const box = inputBox || pill.closest('[id="' + SELECTORS.inputBoxId + '"]') || document.getElementById(SELECTORS.inputBoxId);
      const boxRect = box ? box.getBoundingClientRect() : null;
      const anchorTop = rect.height > 0 ? rect.top : boxRect ? boxRect.top : 0;
      const anchorLeft =
        anchorRect && anchorRect.width > 0
          ? anchorRect.left + anchorRect.width / 2
          : boxRect
          ? boxRect.left + boxRect.width / 2
          : 0;
      const fallbackW = tt.classList && tt.classList.contains('ag-tt-is-status-only') ? 300 : 532;
      const ttW = tt.offsetWidth || tt.getBoundingClientRect().width || fallbackW;
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

  function syncTooltipLiveOverlay(tt, snap, ownerPill, ownerBox) {
    if (!tt || !snap || !SHOW_SESSION_STATUS) return;
    const dotEl = tt.querySelector('.ag-tt-hdr-dot');
    if (dotEl) {
      const dotMod =
        snap.visualState === 'error'
          ? ' is-error'
          : snap.visualState === 'slow'
          ? ' is-slow'
          : snap.visualState === 'running'
          ? ' is-running'
          : ' is-idle';
      const targetDotClass = 'ag-tt-hdr-dot' + dotMod;
      if (dotEl.className !== targetDotClass) dotEl.className = targetDotClass;
    }
    const chipEl = tt.querySelector('.ag-tt-live-chip');
    if (chipEl) {
      const chipDisplay = snap.chipText || '就绪';
      if (chipEl.textContent !== chipDisplay) chipEl.textContent = chipDisplay;
      const runMod = !snap.chipClass && snap.visualState === 'running' ? ' is-running' : '';
      const targetChipClass = 'ag-tt-live-chip' + (snap.chipClass ? ' ' + snap.chipClass : runMod);
      if (chipEl.className !== targetChipClass) chipEl.className = targetChipClass;
    }
    const noteEl = tt.querySelector('.ag-tt-wait-note');
    if (noteEl) {
      const targetNoteClass = 'ag-tt-wait-note' + (snap.noteClass ? ' ' + snap.noteClass : '');
      if (noteEl.className !== targetNoteClass) noteEl.className = targetNoteClass;
      if (noteEl.getAttribute('data-ag-note-html') !== snap.noteHtml) {
        noteEl.setAttribute('data-ag-note-html', snap.noteHtml);
        noteEl.innerHTML = snap.noteHtml;
        if (ownerPill && tt.getAttribute('data-visible') === '1') {
          positionMetricsTooltip(ownerPill, tt, ownerBox);
        }
      }
    }
    const statusDescEl = tt.querySelector('[data-ag-status-desc="1"]');
    if (statusDescEl) {
      if (snap.visualState === 'slow' || snap.visualState === 'error') {
        statusDescEl.hidden = true;
      } else {
        statusDescEl.hidden = false;
        const txt = snap.visualState === 'running' ? snap.dotTitle || '会话正在执行中。' : '会话连接正常，随时可继续对话。';
        if (statusDescEl.textContent !== txt) statusDescEl.textContent = txt;
      }
    }
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
        const refreshAllBtn = e.target && e.target.closest ? e.target.closest('.ag-tt-hdr-refresh') : null;
        if (refreshAllBtn) {
          e.preventDefault();
          e.stopPropagation();
          if (refreshAllBtn.classList) {
            refreshAllBtn.classList.add('is-loading');
            setTimeout(() => {
              if (refreshAllBtn && refreshAllBtn.classList) refreshAllBtn.classList.remove('is-loading');
            }, 650);
          }
          requestMetricsFromDaemon({ force: true, bypassCache: true, reason: 'manual', minIntervalMs: 0 });
          if (SHOW_USAGE_STATS) {
            syncOfficialQuotaIntoTooltip(tt, { forceRefresh: true });
          }
          return;
        }
        const refreshQuotaBtn = e.target && e.target.closest ? e.target.closest('.ag-tt-quota-refresh') : null;
        if (refreshQuotaBtn) {
          e.preventDefault();
          e.stopPropagation();
          syncOfficialQuotaIntoTooltip(tt, { forceRefresh: true });
        }
      });
    }
    return tt;
  }

  function hydrateTooltipForPane(paneKey) {
    const tt = ensureMetricsTooltipEl();
    if (!tt) return null;
    const pane = getPaneByKey(paneKey);
    const cid = pane ? pane.cid : paneKey === 'main' ? extractCascadeId() : '';
    const m = cid ? metricsByCid[cid] : null;
    const ps = paneStates[paneKey];

    if (SHOW_USAGE_STATS && cid && (!m || Date.now() - (m.__agAppliedAt || 0) > 2000)) {
      requestMetricsFromDaemon({ force: true, bypassCache: true, reason: 'tooltip_open', minIntervalMs: 1200 });
    }

    let rawHtml = m && m.tooltipHtml ? m.tooltipHtml : '';
    if (!SHOW_USAGE_STATS && SHOW_SESSION_STATUS) {
      rawHtml = buildStatusOnlyTooltipHtml(ps ? ps.lastSnap : null);
    }
    if (!rawHtml) return null;

    window.__ag_tt_owner_pane = paneKey;
    tt.setAttribute('data-ag-owner-pane', paneKey);
    if (tt.classList) {
      tt.classList.toggle('ag-tt-is-status-only', Boolean(!SHOW_USAGE_STATS && SHOW_SESSION_STATUS));
    }
    applyUsageTooltipHtml(tt, rawHtml);
    if (SHOW_SESSION_STATUS && ps && ps.lastSnap) {
      const pill = document.getElementById(pane ? pane.pillId : 'ag-live-metrics-pill');
      syncTooltipLiveOverlay(tt, ps.lastSnap, pill, pane ? pane.inputBox : null);
    }
    if (SHOW_USAGE_STATS) {
      syncOfficialQuotaIntoTooltip(tt, {
        forceRefresh: false,
        allowBackgroundForce: true,
        scopeEl: pane ? pane.inputBox : null
      });
    }
    return { tt, pane };
  }

  function isMetricsPillEl(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.id === 'ag-live-metrics-pill' || el.id === 'ag-side-metrics-pill') return true;
    return Boolean(el.classList && el.classList.contains('ag-live-metrics-pill'));
  }

  function getNonPillChildren(el) {
    const out = [];
    if (!el || !el.children) return out;
    for (let i = 0; i < el.children.length; i++) {
      const ch = el.children[i];
      if (!isMetricsPillEl(ch)) out.push(ch);
    }
    return out;
  }

  function isHorizontalFlexContainer(el) {
    if (!el || typeof window.getComputedStyle !== 'function') return true;
    try {
      const cs = window.getComputedStyle(el);
      const disp = cs && cs.display ? String(cs.display) : '';
      const dir = cs && cs.flexDirection ? String(cs.flexDirection) : '';
      return disp.includes('flex') && dir.startsWith('row');
    } catch (e) {
      return true;
    }
  }

  function isVerticalFlowContainer(el) {
    if (!el || typeof window.getComputedStyle !== 'function') return true;
    try {
      const cs = window.getComputedStyle(el);
      const disp = cs && cs.display ? String(cs.display) : '';
      const dir = cs && cs.flexDirection ? String(cs.flexDirection) : '';
      if (disp.includes('flex')) return dir.startsWith('column');
      return disp !== 'inline' && disp !== 'inline-block' && !disp.includes('inline-grid');
    } catch (e) {
      return true;
    }
  }

  function clearStaleRowModes(inputBox, activeRow, activePill) {
    if (!inputBox || !inputBox.querySelectorAll) return;
    try {
      inputBox.querySelectorAll('[data-ag-row-mode]').forEach((el) => {
        if (el !== activeRow && el !== activePill) {
          el.removeAttribute('data-ag-row-mode');
        }
      });
    } catch (e) {}
  }

  function findInputToolbarContext(inputBox) {
    if (!inputBox) return null;
    const modelTrigger = inputBox.querySelector('[data-testid="model-selector-trigger"]');
    if (!modelTrigger) return null;

    const extractPair = (candidate) => {
      if (!candidate || candidate === inputBox || !inputBox.contains(candidate) || isMetricsPillEl(candidate)) {
        return null;
      }
      const kids = getNonPillChildren(candidate);
      if (kids.length < 2) return null;
      const leftGroup = kids[0];
      const rightGroup = kids[kids.length - 1];
      if (!leftGroup || !rightGroup || leftGroup === rightGroup) return null;
      if (!leftGroup.contains(modelTrigger)) return null;
      return { row: candidate, leftGroup, rightGroup };
    };

    // Prefer Antigravity's canonical composer footer row so inner dropdown/tooltip siblings
    // mounted around model-selector-trigger can never hijack row detection.
    if (modelTrigger.closest) {
      const explicitRow = modelTrigger.closest('.agy-composer-footer, [data-agent-composer-root]');
      const explicitCtx = extractPair(explicitRow);
      if (explicitCtx) return explicitCtx;
    }

    // Structural fallback: pick the outermost full-width horizontal row inside inputBox
    // whose parent flows vertically (so bottom-mode stacking never lands inside a flex-row).
    const boxWidth = inputBox.getBoundingClientRect ? Math.round(inputBox.getBoundingClientRect().width || 0) : 0;
    let best = null;
    let row = modelTrigger.parentElement;
    for (let i = 0; i < 12 && row && row !== inputBox; i++, row = row.parentElement) {
      const ctx = extractPair(row);
      if (!ctx) continue;
      if (!isHorizontalFlexContainer(row)) continue;
      if (row.parentElement && !isVerticalFlowContainer(row.parentElement)) continue;
      if (boxWidth > 0 && row.getBoundingClientRect) {
        const rw = Math.round(row.getBoundingClientRect().width || 0);
        if (rw > 0 && rw < boxWidth * 0.7) continue;
      }
      best = ctx;
    }
    return best;
  }

  function ensureMetricsPillForPane(pane, forceLayout = false, resetHysteresis = false) {
    if (!pane || !pane.inputBox) return null;
    const { key: paneKey, pillId, inputBox, cid } = pane;
    const ctx = findInputToolbarContext(inputBox);
    if (!ctx) return null;
    const { row, leftGroup, rightGroup } = ctx;
    const ps = getOrCreatePaneState(paneKey);

    let pill = document.getElementById(pillId);
    if (!pill) {
      pill = document.createElement('div');
      pill.id = pillId;
      pill.className = 'ag-live-metrics-pill';
      pill.setAttribute('data-ag-pane', paneKey);
      const textSpanId = paneKey === 'main' ? ' id="ag-live-metrics-text"' : '';
      pill.innerHTML =
        '<span' +
        textSpanId +
        ' class="ag-live-metrics-text">' +
        (SHOW_SESSION_STATUS ? '<span class="ag-ctx-pending-dot ag-dot-idle"></span>' : '') +
        '</span>';
      const cachedM = cid ? metricsByCid[cid] : null;
      if (SHOW_USAGE_STATS && cachedM && cachedM.inlineHtml) {
        const textEl = pill.querySelector('.ag-live-metrics-text');
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
        if (window.__ag_tt_pinned && window.__ag_tt_owner_pane && window.__ag_tt_owner_pane !== paneKey) {
          return;
        }
        if (window.__ag_tt_show_timer) clearTimeout(window.__ag_tt_show_timer);
        window.__ag_tt_show_timer = setTimeout(() => {
          const res = hydrateTooltipForPane(paneKey);
          if (!res || !res.tt || !res.tt.innerHTML.trim()) return;
          if (res.tt.getAttribute('data-visible') !== '1') {
            window.__ag_tt_hover_opened_at = Date.now();
          }
          positionMetricsTooltip(pill, res.tt, res.pane ? res.pane.inputBox : inputBox);
          res.tt.setAttribute('data-visible', '1');
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
        const prevOwner = window.__ag_tt_owner_pane || '';
        const res = hydrateTooltipForPane(paneKey);
        if (!res || !res.tt || !res.tt.innerHTML.trim()) return;
        const tt = res.tt;
        const isVisible = tt.getAttribute('data-visible') === '1';
        const switchedOwner = prevOwner && prevOwner !== paneKey;

        if (!isVisible || !window.__ag_tt_pinned || switchedOwner) {
          // 1st click (or switching from the other pane): open & pin with details expanded by default
          tt.removeAttribute('data-collapsed');
          tt.setAttribute('data-visible', '1');
          window.__ag_tt_pinned = true;
          window.__ag_tt_hover_opened_at = 0;
        } else {
          // 2nd click: close panel
          tt.removeAttribute('data-collapsed');
          tt.removeAttribute('data-visible');
          window.__ag_tt_pinned = false;
          window.__ag_tt_hover_opened_at = 0;
        }
        if (tt.getAttribute('data-visible') === '1') {
          positionMetricsTooltip(pill, tt, res.pane ? res.pane.inputBox : inputBox);
        }
      });

      pill.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        requestMetricsFromDaemon({ force: true, bypassCache: true, reason: 'manual', minIntervalMs: 0 });
        if (SHOW_USAGE_STATS) {
          const curTt = document.getElementById('ag-live-metrics-tooltip');
          if (curTt && curTt.querySelector('[data-ag-quota-slot="1"]')) {
            syncOfficialQuotaIntoTooltip(curTt, { forceRefresh: true, scopeEl: inputBox });
          } else if (typeof loadOfficialQuotaSummary === 'function') {
            loadOfficialQuotaSummary({ forceRefresh: true, scopeEl: inputBox, isZh: MODULES.i18n !== false });
          }
        }
      });
    }

    const boxRect = inputBox.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const rowWidth = Math.round(rowRect.width || boxRect.width || 0);
    if (resetHysteresis) ps.rowMode = '';
    const prevMode = ps.rowMode || '';

    let leftUsed = 0;
    for (let i = 0; i < leftGroup.children.length; i++) {
      const ch = leftGroup.children[i];
      if (ch === pill || isMetricsPillEl(ch)) continue;
      leftUsed += Math.ceil(ch.getBoundingClientRect().width || 0);
    }
    const rightUsed = Math.ceil(rightGroup.getBoundingClientRect().width || 0);
    const freeWidth = rowWidth - leftUsed - rightUsed - 16;

    const textEl = pill.querySelector('.ag-live-metrics-text');
    const measuredTextWidth = textEl ? Math.ceil(textEl.scrollWidth || 0) : 0;
    const isDetailed =
      boot.telemetryLayout === 'detailed' ||
      Boolean(boot.userConfig && boot.userConfig.telemetryLayout === 'detailed');
    const neededWidth = measuredTextWidth > 24 ? measuredTextWidth + 20 : 204;
    const threshold = prevMode === 'middle' ? Math.max(168, neededWidth) : Math.max(202, neededWidth + 24);
    const mode = !isDetailed && rowWidth > 0 && freeWidth >= threshold ? 'middle' : 'bottom';
    const sig = mode + ':' + Math.round(rowWidth / 8) + ':' + Math.round(neededWidth / 16);

    const isMountedCorrectly =
      pill.isConnected &&
      inputBox.contains(pill) &&
      row.getAttribute('data-ag-row-mode') === mode &&
      pill.getAttribute('data-ag-row-mode') === mode &&
      (mode === 'middle'
        ? pill.parentElement === leftGroup
        : Boolean(row.parentElement && pill.parentElement === row.parentElement && row.nextElementSibling === pill));

    if (forceLayout || !isMountedCorrectly || ps.rowMode !== mode || ps.layoutSig !== sig) {
      ps.rowMode = mode;
      ps.layoutSig = sig;
      clearStaleRowModes(inputBox, row, pill);
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

    if (ps.roObserved !== inputBox && typeof ResizeObserver !== 'undefined') {
      if (ps.roRaf && typeof cancelAnimationFrame === 'function') {
        try { cancelAnimationFrame(ps.roRaf); } catch (e) {}
        ps.roRaf = 0;
      }
      if (ps.ro) {
        try { ps.ro.disconnect(); } catch (e) {}
      }
      ps.roObserved = inputBox;
      ps.ro = new ResizeObserver(() => {
        if (ps.roRaf) return;
        const runLayout = () => {
          ps.roRaf = 0;
          const curPane = getPaneByKey(paneKey);
          if (!curPane) return;
          ensureMetricsPillForPane(curPane, false, false);
          const tt = document.getElementById('ag-live-metrics-tooltip');
          const p = document.getElementById(pillId);
          if (tt && p && tt.getAttribute('data-visible') === '1' && (window.__ag_tt_owner_pane || 'main') === paneKey) {
            positionMetricsTooltip(p, tt, curPane.inputBox);
          }
        };
        if (typeof requestAnimationFrame === 'function') {
          ps.roRaf = requestAnimationFrame(runLayout);
        } else {
          runLayout();
        }
      });
      try { ps.ro.observe(inputBox); } catch (e) {}
    }

    return pill;
  }

  function pruneStalePills(activePanes) {
    const activeKeys = new Set(activePanes.map((p) => p.key));
    for (const [k, pid] of [['main', 'ag-live-metrics-pill'], ['side', 'ag-side-metrics-pill']]) {
      if (activeKeys.has(k)) continue;
      const stale = document.getElementById(pid);
      if (stale) stale.remove();
      const ps = paneStates[k];
      if (ps) {
        if (ps.roRaf && typeof cancelAnimationFrame === 'function') {
          try { cancelAnimationFrame(ps.roRaf); } catch (e) {}
          ps.roRaf = 0;
        }
        if (ps.ro) {
          try { ps.ro.disconnect(); } catch (e) {}
          ps.ro = null;
          ps.roObserved = null;
        }
        ps.cid = '';
        ps.layoutSig = '';
        ps.rowMode = '';
      }
      if ((window.__ag_tt_owner_pane || '') === k) {
        window.__ag_tt_pinned = false;
        window.__ag_tt_hover_opened_at = 0;
        const tt = document.getElementById('ag-live-metrics-tooltip');
        if (tt) {
          tt.removeAttribute('data-visible');
          tt.removeAttribute('data-collapsed');
        }
      }
    }
  }

  function ensureMetricsPill(forceLayout = false, resetHysteresis = false) {
    const panes = discoverConversationPanes();
    pruneStalePills(panes);
    let mainPill = null;
    for (let i = 0; i < panes.length; i++) {
      const pill = ensureMetricsPillForPane(panes[i], forceLayout, resetHysteresis);
      if (panes[i].key === 'main') mainPill = pill;
    }
    return mainPill;
  }

  function schedulePostTurnRefresh(ps, pane) {
    if (!ps || !pane || !pane.cid) return;
    clearPanePostTurnTimers(ps);
    const targetCid = pane.cid;
    if (typeof markOfficialQuotaDirty === 'function') {
      markOfficialQuotaDirty();
    }
    ps.postTurnTimer1 = setTimeout(() => {
      ps.postTurnTimer1 = null;
      if (ps.cid !== targetCid) return;
      requestMetricsFromDaemon({ force: true, bypassCache: true, reason: 'turn_done', minIntervalMs: 250 });
    }, 300);
    ps.postTurnTimer2 = setTimeout(() => {
      ps.postTurnTimer2 = null;
      if (ps.cid !== targetCid) return;
      requestMetricsFromDaemon({ force: true, bypassCache: true, reason: 'turn_done_followup', minIntervalMs: 600 });
    }, 1200);
    if (SHOW_USAGE_STATS) {
      ps.postTurnQuotaTimer = setTimeout(() => {
        ps.postTurnQuotaTimer = null;
        if (ps.cid !== targetCid) return;
        const curTt = document.getElementById('ag-live-metrics-tooltip');
        if (curTt && curTt.getAttribute('data-visible') === '1' && !document.hidden) {
          syncOfficialQuotaIntoTooltip(curTt, {
            forceRefresh: false,
            allowBackgroundForce: true,
            staleTtlMs: 30000,
            scopeEl: pane.inputBox
          });
        }
      }, 1500);
    }
  }

  function trackPaneRefreshEdges(ps, pane, now, nowExecuting, liveStepsLen, m) {
    if (!ps || !pane) return;
    const curCid = pane.cid;
    if (ps.wasExecuting && !nowExecuting && curCid) {
      schedulePostTurnRefresh(ps, pane);
    } else if (nowExecuting && curCid && liveStepsLen > 0 && ps.lastLiveStepsLen > 0 && liveStepsLen > ps.lastLiveStepsLen) {
      if (now - (ps.lastRefreshReqAt || 0) >= 1500) {
        ps.lastRefreshReqAt = now;
        requestMetricsFromDaemon({ force: true, bypassCache: true, reason: 'step_progress', minIntervalMs: 1200 });
      }
    } else if (SHOW_USAGE_STATS && curCid && (!m || !m.hasData)) {
      if (now - (ps.lastRefreshReqAt || 0) >= 4000) {
        ps.lastRefreshReqAt = now;
        requestMetricsFromDaemon({ force: true, bypassCache: true, reason: 'missing_data', minIntervalMs: 3000 });
      }
    }
    ps.wasExecuting = Boolean(nowExecuting);
    if (liveStepsLen > 0) {
      ps.lastLiveStepsLen = Math.max(ps.lastLiveStepsLen || 0, liveStepsLen);
    }
  }

  function applyPendingWaitVisualsForPane(pane, now) {
    const { key: paneKey, pillId, inputBox, container, cid: curCid } = pane;
    const ps = getOrCreatePaneState(paneKey);
    const m = curCid && metricsByCid[curCid] ? metricsByCid[curCid] : null;
    const live =
      typeof readLiveCascadeRuntimeState === 'function'
        ? readLiveCascadeRuntimeState(curCid, inputBox, container)
        : null;

    if (!SHOW_SESSION_STATUS) {
      if (ps.cid !== curCid) {
        clearPanePostTurnTimers(ps);
        ps.cid = curCid;
        ps.wasExecuting = false;
        ps.lastLiveStepsLen = 0;
        ps.lastRefreshReqAt = 0;
      }
      ps.lastSnap = null;
      const hasInlineData = Boolean(SHOW_USAGE_STATS && m && m.hasData && m.inlineHtml);
      let pill = document.getElementById(pillId);
      if (hasInlineData && (!pill || !pill.isConnected || !inputBox.contains(pill))) {
        pill = ensureMetricsPillForPane(pane, Boolean(pill), false);
      }
      if (pill) {
        const nextDisplay = hasInlineData ? 'inline-flex' : 'none';
        const displayChanged = pill.style.display !== nextDisplay;
        pill.style.display = nextDisplay;
        const textEl = pill.querySelector('.ag-live-metrics-text');
        let inlineTextChanged = false;
        if (textEl && hasInlineData && textEl.getAttribute('data-ag-raw-html') !== m.inlineHtml) {
          textEl.setAttribute('data-ag-raw-html', m.inlineHtml);
          textEl.innerHTML = m.inlineHtml;
          inlineTextChanged = true;
        }
        if ((inlineTextChanged || displayChanged) && hasInlineData) {
          ensureMetricsPillForPane(pane, false, false);
        }
        if (pill.hasAttribute('title')) pill.removeAttribute('title');
        const usageAria = '用量统计 · 悬停或点击查看明细与官方配额';
        if (pill.getAttribute('aria-label') !== usageAria) pill.setAttribute('aria-label', usageAria);
      }
      const stKindOnly = m && m.status && m.status.pendingKind ? String(m.status.pendingKind) : 'idle';
      const nowExecOnly = Boolean(
        stKindOnly !== 'idle' ||
          (live &&
            live.matched &&
            (live.stopBtnActive || (live.hasProvider && (Number(live.effRunStatus) === 2 || live.execCase === 'modelRequest'))))
      );
      trackPaneRefreshEdges(ps, pane, now, nowExecOnly, live && live.totalStepsLen ? live.totalStepsLen : 0, m);
      return null;
    }

    const st = m && m.status ? m.status : null;

    if (ps.cid !== curCid) {
      clearPanePostTurnTimers(ps);
      ps.cid = curCid;
      ps.unconnStartMs = 0;
      ps.waitStartMs = 0;
      ps.pendingKind = 'idle';
      ps.lastSteps = 0;
      ps.lastGens = 0;
      ps.lastStreamLen = 0;
      ps.wasExecuting = false;
      ps.lastLiveStepsLen = 0;
      ps.lastRefreshReqAt = 0;
    }

    const isUnconnNow = Boolean(
      curCid && live && live.matched && live.hasProvider && Number(live.aspStatus) === 0 && !live.hasTrajectory
    );
    if (isUnconnNow) {
      if (!ps.unconnStartMs) ps.unconnStartMs = now;
    } else {
      ps.unconnStartMs = 0;
    }
    const unconnSec = ps.unconnStartMs ? Math.max(0, Math.floor((now - ps.unconnStartMs) / 1000)) : 0;

    const stKind = st && st.pendingKind ? String(st.pendingKind) : 'idle';
    const stSteps = st && typeof st.totalSteps === 'number' ? st.totalSteps : 0;
    const stGens = st && typeof st.totalGenerations === 'number' ? st.totalGenerations : 0;
    const curStreamLen =
      typeof readActiveStreamProgressLen === 'function' ? readActiveStreamProgressLen(container) : 0;

    const activeProbe = Boolean(
      stKind !== 'idle' ||
        (live &&
          live.matched &&
          (live.stopBtnActive || (live.hasProvider && (Number(live.effRunStatus) === 2 || live.execCase === 'modelRequest'))))
    );

    if (activeProbe) {
      const progressed =
        stSteps > ps.lastSteps ||
        stGens > ps.lastGens ||
        curStreamLen > ps.lastStreamLen + 1;
      if (!ps.waitStartMs || ps.pendingKind !== stKind || progressed) {
        ps.waitStartMs = now;
      }
      ps.pendingKind = stKind;
      ps.lastSteps = Math.max(ps.lastSteps, stSteps);
      ps.lastGens = Math.max(ps.lastGens, stGens);
      ps.lastStreamLen = Math.max(ps.lastStreamLen, curStreamLen);
    } else {
      ps.waitStartMs = 0;
      ps.pendingKind = 'idle';
      ps.lastSteps = stSteps;
      ps.lastGens = stGens;
      ps.lastStreamLen = curStreamLen;
    }

    const waitSec = ps.waitStartMs ? Math.max(0, Math.floor((now - ps.waitStartMs) / 1000)) : 0;
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
      curModel: typeof getSelectedModelLabel === 'function' ? getSelectedModelLabel(inputBox) : ''
    });
    ps.lastSnap = snap;
    trackPaneRefreshEdges(
      ps,
      pane,
      now,
      Boolean(snap.isExecuting || activeProbe),
      live && live.totalStepsLen ? live.totalStepsLen : 0,
      m
    );

    const routeVisible =
      isMetricsRouteActive(pane) || snap.visualState === 'error' || snap.visualState === 'slow' || snap.isExecuting;

    let pill = document.getElementById(pillId);
    if (routeVisible && (!pill || !pill.isConnected || !inputBox.contains(pill))) {
      pill = ensureMetricsPillForPane(pane, Boolean(pill), false);
    }

    if (pill) {
      const hasInlineData = Boolean(SHOW_USAGE_STATS && m && m.hasData && m.inlineHtml);
      const showPill = Boolean(hasInlineData || routeVisible);
      const nextDisplay = showPill ? 'inline-flex' : 'none';
      const displayChanged = pill.style.display !== nextDisplay;
      pill.style.display = nextDisplay;

      const textEl = pill.querySelector('.ag-live-metrics-text');
      let inlineTextChanged = false;
      if (textEl && hasInlineData) {
        if (textEl.getAttribute('data-ag-raw-html') !== m.inlineHtml) {
          textEl.setAttribute('data-ag-raw-html', m.inlineHtml);
          textEl.innerHTML = m.inlineHtml;
          inlineTextChanged = true;
        }
      } else if (textEl && !hasInlineData && showPill) {
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
          inlineTextChanged = true;
        }
      }
      if ((inlineTextChanged || displayChanged) && showPill) {
        ensureMetricsPillForPane(pane, false, false);
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
        if (dotEl.hasAttribute('title')) {
          dotEl.removeAttribute('title');
        }
        if (dotEl.getAttribute('aria-label') !== snap.dotTitle) {
          dotEl.setAttribute('aria-label', snap.dotTitle);
        }
      }
      if (pill.hasAttribute('title')) {
        pill.removeAttribute('title');
      }
      if (pill.getAttribute('aria-label') !== snap.dotTitle) {
        pill.setAttribute('aria-label', snap.dotTitle);
      }
    }

    const tt = document.getElementById('ag-live-metrics-tooltip');
    if (tt && (window.__ag_tt_owner_pane || 'main') === paneKey) {
      syncTooltipLiveOverlay(tt, snap, pill, inputBox);
    }

    return snap;
  }

  function applyPendingWaitVisuals() {
    if (!HAS_TELEMETRY_UI) return null;
    const now = Date.now();
    const panes = discoverConversationPanes();
    pruneStalePills(panes);
    let mainSnap = null;
    for (let i = 0; i < panes.length; i++) {
      const snap = applyPendingWaitVisualsForPane(panes[i], now);
      if (panes[i].key === 'main') mainSnap = snap;
    }
    return mainSnap;
  }

  window.__ag_refresh_wait_ui = applyPendingWaitVisuals;

  function extractToolbarStepMeta(tb) {
    try {
      const domCidEl = tb.closest ? tb.closest('[data-cascade-id]') : null;
      const domCid = domCidEl ? String(domCidEl.getAttribute('data-cascade-id') || '').trim() : '';

      const fk = Object.keys(tb).find(
        (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')
      );
      if (!fk) return null;
      let f = tb[fk];
      let nrcProps = null;
      let iEcProps = null;
      let sliceProps = null;
      for (let i = 0; i < 20 && f; i++) {
        const p = f.memoizedProps;
        if (p) {
          if (!nrcProps && Array.isArray(p.steps) && 'showThumbsUpDown' in p) nrcProps = p;
          if (!iEcProps && p.cascadeId && Array.isArray(p.trajectorySteps) && typeof p.trajectoryLength === 'number') {
            iEcProps = p;
          }
          if (!sliceProps && p.trajectorySlice && Array.isArray(p.trajectorySlice.stepsInSlice)) {
            sliceProps = p;
          }
        }
        if (nrcProps && (iEcProps || sliceProps)) break;
        f = f.return;
      }
      if (!nrcProps) return null;

      const tSteps = iEcProps
        ? iEcProps.trajectorySteps
        : sliceProps && sliceProps.trajectorySlice
        ? sliceProps.trajectorySlice.stepsInSlice
        : [];
      const base = iEcProps
        ? iEcProps.trajectoryLength - tSteps.length
        : sliceProps && sliceProps.trajectorySlice && typeof sliceProps.trajectorySlice.totalStepsLength === 'number'
        ? sliceProps.trajectorySlice.totalStepsLength - tSteps.length
        : 0;

      let maxStep = -1;
      let maxMeta = -1;
      for (let i = 0; i < nrcProps.steps.length; i++) {
        const s = nrcProps.steps[i];
        if (!s) continue;
        const srcInfo = s.metadata && s.metadata.sourceTrajectoryStepInfo;
        let si = srcInfo && typeof srcInfo.stepIndex === 'number' ? srcInfo.stepIndex : -1;
        if (si < 0 && tSteps.length > 0) {
          const pos = tSteps.indexOf(s);
          if (pos >= 0) si = base + pos;
        }
        if (si > maxStep) maxStep = si;
        if (srcInfo && typeof srcInfo.metadataIndex === 'number' && srcInfo.metadataIndex > maxMeta) {
          maxMeta = srcInfo.metadataIndex;
        }
      }
      const fiberCid = iEcProps && iEcProps.cascadeId ? String(iEcProps.cascadeId).trim() : '';
      const resolvedCid = AG_UUID_RE.test(domCid) ? domCid : fiberCid;
      if (!resolvedCid && maxStep < 0 && maxMeta < 0) return null;
      return {
        cascadeId: resolvedCid,
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
        '<span class="ag-tmt-nowrap">' +
        escapeStatusHtml(t.lastCtx.toLocaleString('en-US')) +
        ' / ' +
        escapeStatusHtml(t.limitStr) +
        ' <span class="' +
        ctxCls +
        '">(' +
        escapeStatusHtml(String(t.ctxPct)) +
        '%)</span></span>';
      rows.push('<div class="ag-tmt-row"><span class="ag-tmt-lbl">当前上下文</span><span class="ag-tmt-val">' + ctxVal + '</span></div>');
    }
    if (t.outTok > 0) {
      const outVal =
        '<span class="ag-tmt-nowrap">' +
        escapeStatusHtml(t.outTok.toLocaleString('en-US')) +
        '</span> <span class="ag-tmt-nowrap ag-tmt-sub">(思考 ' +
        escapeStatusHtml(t.thinkTok.toLocaleString('en-US')) +
        ' + 正文/工具 ' +
        escapeStatusHtml(t.respTok.toLocaleString('en-US')) +
        ')</span>';
      rows.push('<div class="ag-tmt-row"><span class="ag-tmt-lbl">本轮输出</span><span class="ag-tmt-val">' + outVal + '</span></div>');
    }
    const promptSum = t.inTok + t.cacheWrite + t.cacheRead;
    if (promptSum > 0) {
      const inVal =
        '<span class="ag-tmt-nowrap">新增 ' +
        escapeStatusHtml(t.inTok.toLocaleString('en-US')) +
        '</span>' +
        (t.cacheWrite > 0
          ? ' <span class="ag-tmt-nowrap">+ 写缓存 ' + escapeStatusHtml(t.cacheWrite.toLocaleString('en-US')) + '</span>'
          : '') +
        ' <span class="ag-tmt-nowrap">+ 读缓存 ' +
        escapeStatusHtml(t.cacheRead.toLocaleString('en-US')) +
        '</span> <span class="ag-tmt-nowrap ag-tmt-sub">(命中率 ' +
        escapeStatusHtml(t.cacheRate) +
        ')</span>';
      rows.push('<div class="ag-tmt-row"><span class="ag-tmt-lbl">本轮累计输入</span><span class="ag-tmt-val">' + inVal + '</span></div>');
    }
    if (t.tps > 0 || t.totDur > 0) {
      const spdVal =
        (t.tps > 0
          ? '<span class="ag-tmt-nowrap">' +
            escapeStatusHtml(String(t.tps)) +
            ' tok/s <span class="ag-tmt-sub">(端到端 ' +
            escapeStatusHtml(String(t.e2eTps)) +
            ' tok/s)</span></span> · '
          : '') +
        '<span class="ag-tmt-nowrap">流式 ' +
        escapeStatusHtml(String(t.streamDur)) +
        's / 总计 ' +
        escapeStatusHtml(String(t.totDur)) +
        's</span>';
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
      tt.style.left = '12px';
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

  function renderTurnMetrics(optionalPayload, optionalCid) {
    try {
      if (optionalPayload && typeof optionalPayload === 'object') {
        const pCid = optionalCid || optionalPayload.cid || optionalPayload.cascadeId || '';
        if (pCid) storeMetricsPayload(pCid, optionalPayload);
      }
      const toolbars = document.querySelectorAll('[data-testid="cascade-system-message-toolbar"]');
      if (!toolbars || toolbars.length === 0) return;

      for (let i = 0; i < toolbars.length; i++) {
        const tb = toolbars[i];
        tb.querySelectorAll(':scope > button > .ag-turn-metrics').forEach((el) => el.remove());
        const directDivs = tb.querySelectorAll(':scope > div');
        const row = (directDivs.length > 0 ? directDivs[directDivs.length - 1] : null) || tb.lastElementChild;
        if (!row) continue;
        let badge = row.querySelector(':scope > .ag-turn-metrics');
        if (!SHOW_USAGE_STATS) {
          if (badge) badge.remove();
          if (row.hasAttribute('data-ag-turn-row')) row.removeAttribute('data-ag-turn-row');
          continue;
        }
        if (row.getAttribute('data-ag-turn-row') !== '1') {
          row.setAttribute('data-ag-turn-row', '1');
        }
        const meta = extractToolbarStepMeta(tb);
        if (!meta) {
          if (badge) badge.remove();
          continue;
        }
        const tbCid = meta.cascadeId || '';
        const payload = tbCid ? metricsByCid[tbCid] : null;
        const turns =
          payload && payload.hasData && Array.isArray(payload.turns) && payload.turns.length > 0
            ? payload.turns
            : null;
        if (!turns) {
          if (badge) badge.remove();
          continue;
        }
        const turn = matchTurnForToolbar(turns, meta);
        if (!turn) {
          if (badge) badge.remove();
          if (tbCid && getWatchedCascadeIds().includes(tbCid)) {
            requestMetricsFromDaemon({
              force: true,
              bypassCache: true,
              reason: 'missing_turn_badge',
              minIntervalMs: 2500
            });
          }
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
    if (!HAS_TELEMETRY_UI || !document.body || typeof MutationObserver === 'undefined') return;
    if (window.__ag_turn_metrics_observer) return;
    const scheduleSync = (withPaneCheck) => {
      if (withPaneCheck) window.__ag_turn_sync_needs_pane = true;
      if (window.__ag_turn_sync_raf) return;
      window.__ag_turn_sync_raf = requestAnimationFrame(() => {
        window.__ag_turn_sync_raf = null;
        const needPane = Boolean(window.__ag_turn_sync_needs_pane);
        window.__ag_turn_sync_needs_pane = false;
        if (needPane) {
          checkRouteAndMountMetrics();
        } else {
          renderTurnMetrics();
        }
      });
    };
    window.__ag_turn_metrics_observer = new MutationObserver((mutations) => {
      let hitToolbar = false;
      let hitPane = false;
      for (let i = 0; i < mutations.length; i++) {
        const m = mutations[i];
        if (m.type === 'attributes') {
          if (m.attributeName === 'data-cascade-id' || m.attributeName === 'data-selected') {
            hitPane = true;
            break;
          }
          continue;
        }
        const checkList = (nodes) => {
          if (!nodes || nodes.length === 0) return;
          for (let j = 0; j < nodes.length; j++) {
            const n = nodes[j];
            if (n.nodeType !== 1) continue;
            const tid = n.getAttribute ? n.getAttribute('data-testid') || '' : '';
            if (
              n.id === SELECTORS.inputBoxId ||
              tid === 'side-question-tab-content' ||
              tid === 'side-question-tab-composer' ||
              tid === 'side-question-tab-conversation' ||
              (n.querySelector &&
                n.querySelector('[data-testid="side-question-tab-content"], [id="' + SELECTORS.inputBoxId + '"]'))
            ) {
              hitPane = true;
              return;
            }
            if (
              tid === 'cascade-system-message-toolbar' ||
              (n.querySelector && n.querySelector('[data-testid="cascade-system-message-toolbar"]'))
            ) {
              hitToolbar = true;
            }
          }
        };
        checkList(m.addedNodes);
        if (!hitPane) checkList(m.removedNodes);
        if (hitPane) break;
      }
      if (hitPane) {
        scheduleSync(true);
      } else if (hitToolbar) {
        scheduleSync(false);
      }
    });
    try {
      window.__ag_turn_metrics_observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-cascade-id', 'data-selected']
      });
    } catch (e) {}
  }

  let postGenQuotaTimer = null;
  window.__ag_render_metrics = function (payload) {
    window.__ag_last_daemon_hb = Date.now();
    if (!payload || typeof payload !== 'object') return { applied: false, reason: 'invalid_payload' };
    const payloadCid = String(payload.cid || payload.cascadeId || '').trim();
    const watched = getWatchedCascadeIds();
    if (!payloadCid || !watched.includes(payloadCid)) {
      return { applied: false, reason: 'not_watched' };
    }

    const prevPayload = metricsByCid[payloadCid] || null;
    const prevGens = prevPayload && prevPayload.status ? Number(prevPayload.status.totalGenerations || 0) : 0;
    const nextGens = payload.status ? Number(payload.status.totalGenerations || 0) : 0;
    const stampedPayload = Object.assign({}, payload, { __agAppliedAt: Date.now() });

    storeMetricsPayload(payloadCid, stampedPayload);
    const mainCid = extractCascadeId();
    if (payloadCid === mainCid) {
      window.__ag_last_metrics = stampedPayload;
    }
    if (!HAS_TELEMETRY_UI) return { applied: false, reason: 'disabled' };

    if (SHOW_USAGE_STATS && prevGens > 0 && nextGens > prevGens) {
      if (typeof markOfficialQuotaDirty === 'function') {
        markOfficialQuotaDirty();
      }
      const openTt = document.getElementById('ag-live-metrics-tooltip');
      if (openTt && openTt.getAttribute('data-visible') === '1' && !document.hidden) {
        if (postGenQuotaTimer) clearTimeout(postGenQuotaTimer);
        postGenQuotaTimer = setTimeout(() => {
          postGenQuotaTimer = null;
          const curTt = document.getElementById('ag-live-metrics-tooltip');
          if (curTt && curTt.getAttribute('data-visible') === '1' && !document.hidden) {
            syncOfficialQuotaIntoTooltip(curTt, {
              forceRefresh: false,
              allowBackgroundForce: true,
              staleTtlMs: 30000
            });
          }
        }, 1500);
      }
    }

    const panes = discoverConversationPanes();
    pruneStalePills(panes);
    for (let i = 0; i < panes.length; i++) {
      const pane = panes[i];
      if (pane.cid !== payloadCid) continue;
      ensureQuotaStoreSubscription(pane.inputBox);
      const pill = ensureMetricsPillForPane(pane, false, false);
      if (SHOW_USAGE_STATS && pill && payload.inlineHtml) {
        const textEl = pill.querySelector('.ag-live-metrics-text');
        if (textEl && textEl.getAttribute('data-ag-raw-html') !== payload.inlineHtml) {
          textEl.setAttribute('data-ag-raw-html', payload.inlineHtml);
          textEl.innerHTML = payload.inlineHtml;
          ensureMetricsPillForPane(pane, false, false);
        }
      }
      if (SHOW_USAGE_STATS && payload.tooltipHtml && (window.__ag_tt_owner_pane || 'main') === pane.key) {
        const tt = ensureMetricsTooltipEl();
        if (tt) {
          if (tt.classList) tt.classList.remove('ag-tt-is-status-only');
          const mode = applyUsageTooltipHtml(tt, payload.tooltipHtml);
          if (mode === 'full') {
            syncOfficialQuotaIntoTooltip(tt, {
              forceRefresh: false,
              allowBackgroundForce: true,
              scopeEl: pane.inputBox
            });
          }
          if (mode && pill && tt.getAttribute('data-visible') === '1') {
            positionMetricsTooltip(pill, tt, pane.inputBox);
          }
        }
      }
    }

    ensureTurnMetricsObserver();
    renderTurnMetrics();
    applyPendingWaitVisuals();
    return { applied: true, cid: payloadCid, sig: String(payload.dataSig || payload.sig || '') };
  };

  function checkRouteAndMountMetrics() {
    if (!HAS_TELEMETRY_UI) return;
    const mainCid = extractCascadeId();
    const panes = discoverConversationPanes();
    pruneStalePills(panes);

    const watchedIds = getWatchedCascadeIds();
    const watchedSig = watchedIds.join(',');
    window.__ag_watched_cascade_id = mainCid || '';
    if (window.__ag_last_watched_sig !== watchedSig) {
      requestMetricsFromDaemon({ force: true, bypassCache: true, reason: 'route', minIntervalMs: 0 });
    }
    if (SHOW_USAGE_STATS && panes.length > 0) {
      ensureQuotaStoreSubscription(panes[0].inputBox);
    }

    for (let i = 0; i < panes.length; i++) {
      const pane = panes[i];
      const ps = getOrCreatePaneState(pane.key);
      if (ps.cid !== pane.cid) {
        clearPanePostTurnTimers(ps);
        ps.cid = pane.cid;
        ps.unconnStartMs = 0;
        ps.waitStartMs = 0;
        ps.pendingKind = 'idle';
        ps.lastSteps = 0;
        ps.lastGens = 0;
        ps.lastStreamLen = 0;
        ps.wasExecuting = false;
        ps.lastLiveStepsLen = 0;
        ps.lastRefreshReqAt = 0;
        if (pane.key === 'main') {
          window.__ag_last_metrics = pane.cid && metricsByCid[pane.cid] ? metricsByCid[pane.cid] : null;
        }
        if ((window.__ag_tt_owner_pane || 'main') === pane.key) {
          window.__ag_tt_pinned = false;
          window.__ag_tt_hover_opened_at = 0;
          const tt = document.getElementById('ag-live-metrics-tooltip');
          if (tt) {
            tt.removeAttribute('data-visible');
            tt.removeAttribute('data-collapsed');
            tt.removeAttribute('data-ag-raw-tt');
            tt.innerHTML = '';
          }
        }
        hideTurnMetricsTooltip(true);
        try {
          const scopeRoot = pane.container && pane.container.querySelectorAll ? pane.container : document;
          scopeRoot.querySelectorAll('.ag-turn-metrics').forEach((el) => el.remove());
        } catch (e) {}
        const pill = document.getElementById(pane.pillId);
        const textEl = pill && pill.querySelector('.ag-live-metrics-text');
        if (textEl) {
          const cachedM = pane.cid ? metricsByCid[pane.cid] : null;
          if (SHOW_USAGE_STATS && cachedM && cachedM.hasData && cachedM.inlineHtml) {
            textEl.setAttribute('data-ag-raw-html', cachedM.inlineHtml);
            textEl.innerHTML = cachedM.inlineHtml;
          } else if (SHOW_SESSION_STATUS) {
            textEl.removeAttribute('data-ag-raw-html');
            textEl.innerHTML =
              '<span class="ag-ctx-pending-dot ag-dot-idle"></span><span>' +
              (SHOW_USAGE_STATS && pane.cid ? '读取中...' : '就绪') +
              '</span>';
          } else {
            textEl.removeAttribute('data-ag-raw-html');
            textEl.innerHTML = '';
          }
        }
      }
      ensureMetricsPillForPane(pane, false, false);
    }

    ensureTurnMetricsObserver();
    renderTurnMetrics();
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
  const _onFocusIn = () => checkRouteAndMountMetrics();
  const _onWindowFocus = () => {
    if (document.hidden) return;
    window.__ag_visible_since = Date.now();
    checkRouteAndMountMetrics();
    requestMetricsFromDaemon({ force: true, bypassCache: true, reason: 'focus', minIntervalMs: 2000 });
    const tt = document.getElementById('ag-live-metrics-tooltip');
    if (SHOW_USAGE_STATS && tt && tt.getAttribute('data-visible') === '1') {
      syncOfficialQuotaIntoTooltip(tt, { forceRefresh: false, allowBackgroundForce: true, staleTtlMs: 30000 });
    }
  };
  const _onVisibility = () => {
    if (!document.hidden) {
      window.__ag_visible_since = Date.now();
      checkRouteAndMountMetrics();
      requestMetricsFromDaemon({ force: true, bypassCache: true, reason: 'visibility', minIntervalMs: 2000 });
      const tt = document.getElementById('ag-live-metrics-tooltip');
      if (SHOW_USAGE_STATS && tt && tt.getAttribute('data-visible') === '1') {
        syncOfficialQuotaIntoTooltip(tt, { forceRefresh: false, allowBackgroundForce: true, staleTtlMs: 30000 });
      }
    }
  };
  const _onNetworkChange = () => applyPendingWaitVisuals();
  const _closeMetricsTooltip = () => {
    window.__ag_tt_pinned = false;
    window.__ag_tt_hover_opened_at = 0;
    hideTurnMetricsTooltip(true);
    const tt = document.getElementById('ag-live-metrics-tooltip');
    if (tt) {
      tt.removeAttribute('data-collapsed');
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
    if (
      t.closest('.ag-live-metrics-pill') ||
      t.closest('#ag-live-metrics-pill') ||
      t.closest('#ag-live-metrics-tooltip') ||
      t.closest('#ag-turn-metrics-tooltip')
    ) {
      return;
    }
    _closeMetricsTooltip();
  };
  const _onTurnMouseOver = (e) => {
    if (!SHOW_USAGE_STATS) return;
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
  window.__ag_tt_owner_pane = 'main';
  window.__ag_last_watched_sig = '';

  window.addEventListener('popstate', _onPopState);
  window.addEventListener('focus', _onWindowFocus);
  document.addEventListener('focusin', _onFocusIn, true);
  document.addEventListener('visibilitychange', _onVisibility);
  window.addEventListener('online', _onNetworkChange);
  window.addEventListener('offline', _onNetworkChange);
  window.addEventListener('keydown', _onEscapeKey, true);
  document.addEventListener('click', _onDocClick, true);
  document.addEventListener('mouseover', _onTurnMouseOver, true);
  document.addEventListener('mouseout', _onTurnMouseOut, true);
  window.addEventListener('scroll', _onTurnScroll, true);

  if (HAS_TELEMETRY_UI) {
    if (!window.__ag_visible_since) window.__ag_visible_since = Date.now();
    window.__ag_metrics_route_watcher = setInterval(() => {
      if (!document.hidden) checkRouteAndMountMetrics();
    }, 2000);
    window.__ag_live_probe_timer = setInterval(() => {
      if (!document.hidden) applyPendingWaitVisuals();
    }, 1000);
    if (SHOW_USAGE_STATS) {
      window.__ag_quota_tick_timer = setInterval(() => {
        if (document.hidden) return;
        const tt = document.getElementById('ag-live-metrics-tooltip');
        if (!tt || tt.getAttribute('data-visible') !== '1') return;
        syncOfficialQuotaIntoTooltip(tt, {
          forceRefresh: false,
          allowBackgroundForce: true,
          staleTtlMs: 60000
        });
      }, 30000);
    }
  } else {
    try {
      hideTurnMetricsTooltip(true);
      document.querySelectorAll('.ag-turn-metrics, .ag-live-metrics-pill').forEach((el) => el.remove());
      document.querySelectorAll('[data-ag-row-mode]').forEach((el) => el.removeAttribute('data-ag-row-mode'));
      for (const k of Object.keys(paneStates)) {
        const ps = paneStates[k];
        if (ps && ps.roRaf && typeof cancelAnimationFrame === 'function') {
          try { cancelAnimationFrame(ps.roRaf); } catch (e) {}
          ps.roRaf = 0;
        }
        if (ps && ps.ro) {
          ps.ro.disconnect();
          ps.ro = null;
          ps.roObserved = null;
        }
      }
    } catch (e) {}
  }

  window.__ag_cleanup_fns.push(() => {
    window.removeEventListener('popstate', _onPopState);
    window.removeEventListener('focus', _onWindowFocus);
    document.removeEventListener('focusin', _onFocusIn, true);
    document.removeEventListener('visibilitychange', _onVisibility);
    window.removeEventListener('online', _onNetworkChange);
    window.removeEventListener('offline', _onNetworkChange);
    window.removeEventListener('keydown', _onEscapeKey, true);
    document.removeEventListener('click', _onDocClick, true);
    document.removeEventListener('mouseover', _onTurnMouseOver, true);
    document.removeEventListener('mouseout', _onTurnMouseOut, true);
    window.removeEventListener('scroll', _onTurnScroll, true);
    if (typeof quotaStoreUnsub === 'function') {
      try { quotaStoreUnsub(); } catch (e) {}
      quotaStoreUnsub = null;
    }
    if (postGenQuotaTimer) {
      clearTimeout(postGenQuotaTimer);
      postGenQuotaTimer = null;
    }
    clearTurnTooltipTimers();
    activeTurnBadgeEl = null;
    window.__ag_tt_pinned = false;
    window.__ag_tt_hover_opened_at = 0;
    try {
      document.querySelectorAll('[data-ag-row-mode]').forEach((el) => el.removeAttribute('data-ag-row-mode'));
    } catch (e) {}
    for (const k of Object.keys(paneStates)) {
      const ps = paneStates[k];
      clearPanePostTurnTimers(ps);
      if (ps && ps.roRaf && typeof cancelAnimationFrame === 'function') {
        try { cancelAnimationFrame(ps.roRaf); } catch (e) {}
        ps.roRaf = 0;
      }
      if (ps && ps.ro) {
        try { ps.ro.disconnect(); } catch (e) {}
        ps.ro = null;
        ps.roObserved = null;
      }
    }
    if (window.__ag_turn_metrics_observer) {
      try { window.__ag_turn_metrics_observer.disconnect(); } catch (e) {}
      window.__ag_turn_metrics_observer = null;
    }
    if (window.__ag_metrics_route_watcher) {
      clearInterval(window.__ag_metrics_route_watcher);
      window.__ag_metrics_route_watcher = null;
    }
    if (window.__ag_live_probe_timer) {
      clearInterval(window.__ag_live_probe_timer);
      window.__ag_live_probe_timer = null;
    }
    if (window.__ag_quota_tick_timer) {
      clearInterval(window.__ag_quota_tick_timer);
      window.__ag_quota_tick_timer = null;
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
