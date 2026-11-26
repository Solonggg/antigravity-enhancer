/**
 * Part 30: Antigravity Live State Adapter (isolated for 2.31.x+ compatibility)
 * Pure helpers (isSupersededStepError, selectBestLoadingText, normalizeModelMatchKey)
 * have no DOM dependencies so unit tests can import/evaluate this file cleanly.
 */
  function cleanModelLabel(raw) {
    let s = String(raw || '').trim();
    if (!s) return '';
    s = s
      .replace(/^(?:Select model|Model(?:\s+selector)?)(?:,\s*current)?:\s*/i, '')
      .replace(/^模型(?:选择器)?(?:[，,]\s*当前)?[：:]\s*/, '')
      .trim();
    s = s
      .replace(/,\s*(?:Model\s+cannot\s+be\s+changed|Cannot\s+be\s+changed|Disabled|Locked)[\s\S]*$/i, '')
      .replace(
        /\s*[（(]\s*(?:Model\s+cannot\s+be\s+changed|Cannot\s+be\s+changed|智能体运行期间无法切换模型|会话中途无法更改)[^）)]*[）)]\s*$/i,
        ''
      )
      .replace(/\s*,\s*[^,]+$/i, (m) =>
        /(?:cannot|while|running|disabled|locked|unavailable|无法|运行期间)/i.test(m) ? '' : m
      )
      .trim();
    if (/^(?:Select model|选择模型)$/i.test(s)) return '';
    return s;
  }

  function normalizeModelMatchKey(label) {
    return cleanModelLabel(label)
      .toLowerCase()
      .replace(/\(\s*extra[\s_-]*high\s*\)|\bextra[\s_-]*high\b/g, 'extrahigh')
      .replace(/\(\s*x[\s_-]*high\s*\)|\bx[\s_-]*high\b/g, 'extrahigh')
      .replace(/\(\s*extra\s*\)|\bextra\b/g, 'extrahigh')
      .replace(/[^a-z0-9]+/g, '');
  }

  function isSupersededStepError({ lastStepType = 0, stepsTail = [], totalStepsLen = 0, errorId = '' } = {}) {
    const tail = Array.isArray(stepsTail) ? stepsTail : [];
    const tailLast = tail.length > 0 ? tail[tail.length - 1] : null;
    const isTailErrorStep =
      Number(lastStepType) === 17 ||
      (tailLast && (Number(tailLast.type) === 17 || Number(tailLast.status) === 7));
    if (isTailErrorStep) return false;
    const mErrIdx = errorId ? String(errorId).match(/-(\d+)$/) : null;
    const errStepIdx = mErrIdx ? Number(mErrIdx[1]) : -1;
    if (errStepIdx >= 0 && Number(totalStepsLen) > 0 && Number(totalStepsLen) - 1 - errStepIdx >= 2) {
      return true;
    }
    if (tailLast && Number(tailLast.status) === 3 && Number(tailLast.type) !== 17) {
      return true;
    }
    return false;
  }

  function selectBestLoadingText(texts) {
    const list = (Array.isArray(texts) ? texts : []).map((t) => String(t || '').trim()).filter(Boolean);
    return (
      list.find((t) => /(?:retrying|Model unavailable|attempt\s*\d+\/\d+|重试|暂不可用|不可用)/i.test(t)) ||
      list[0] ||
      ''
    );
  }

  function getSelectedModelLabel(scopeEl) {
    try {
      const el =
        (scopeEl && scopeEl.querySelector ? scopeEl.querySelector('[data-testid="model-selector-trigger"]') : null) ||
        document.querySelector('[data-testid="model-selector-trigger"]');
      if (!el) return '';
      const fk = Object.keys(el).find(
        (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')
      );
      if (fk && el[fk]) {
        let f = el[fk];
        for (let i = 0; i < 6 && f; i++, f = f.return) {
          const al = f.memoizedProps && f.memoizedProps['aria-label'];
          if (typeof al === 'string' && /^(?:Select model|Model(?:\s+selector)?)(?:,\s*current)?:/i.test(al)) {
            const cleaned = cleanModelLabel(al);
            if (cleaned) return cleaned;
          }
        }
      }
      const origAl = el.getAttribute('data-ag-orig-aria-label');
      if (origAl) {
        const cleaned = cleanModelLabel(origAl);
        if (cleaned) return cleaned;
      }
      const curAl = el.getAttribute('aria-label');
      if (curAl) {
        const cleaned = cleanModelLabel(curAl);
        if (cleaned) return cleaned;
      }
      return cleanModelLabel(el.innerText || '');
    } catch {
      return '';
    }
  }

  function readLiveCascadeRuntimeState(expectedCid, scopeBox, scopeContainer) {
    try {
      const box =
        scopeBox ||
        document.getElementById(SELECTORS.inputBoxId) ||
        document.querySelector('[data-testid="model-selector-trigger"]');
      const queryRoot = scopeContainer && scopeContainer.querySelectorAll ? scopeContainer : document;
      const isSideDraft = Boolean(
        !expectedCid &&
          scopeContainer &&
          scopeContainer.getAttribute &&
          scopeContainer.getAttribute('data-testid') === 'side-question-tab-content'
      );

      let aspState = null;
      if (box && !isSideDraft) {
        const fk = Object.keys(box).find(
          (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')
        );
        let cur = fk ? box[fk] : null;
        for (let i = 0; i < 36 && cur; i++, cur = cur.return) {
          const val = cur.memoizedProps && cur.memoizedProps.value;
          const asp =
            val &&
            ((val.cascadeContext && val.cascadeContext.state && val.cascadeContext.state.agentStateProvider) ||
              val.agentStateProvider);
          if (asp && typeof asp.getState === 'function') {
            aspState = asp.getState();
            break;
          }
        }
      }

      const loadingText = selectBestLoadingText(
        Array.from(queryRoot.querySelectorAll('[data-testid="agent-loading"]')).map(
          (el) => el.innerText || el.textContent || ''
        )
      );
      const stopScope = box || document.getElementById(SELECTORS.inputBoxId);
      const stopBtnActive = Boolean(
        stopScope &&
          stopScope.querySelector(
            '[data-testid="input-cancel-button"], [data-tooltip-id="input-send-button-cancel-tooltip"], [aria-label^="Cancel ("], [aria-label^="取消生成"]'
          )
      );

      if (!aspState) {
        return {
          hasProvider: false,
          matched: !expectedCid,
          loadingText,
          stopBtnActive
        };
      }

      const providerCid = String(aspState.conversationId || '').trim();
      const matched = !expectedCid || !providerCid || providerCid === expectedCid;
      if (!matched) {
        return {
          hasProvider: true,
          matched: false,
          cid: providerCid,
          loadingText: '',
          stopBtnActive: false
        };
      }

      const execStatus = aspState.executionStatus && aspState.executionStatus.status;
      const execCase = execStatus && execStatus.case ? String(execStatus.case) : '';
      const execVal = execStatus && execStatus.value;
      const retryTs = execVal && execVal.retryAt;
      let retryAtMs = 0;
      if (retryTs && typeof retryTs.seconds !== 'undefined') {
        retryAtMs = Number(retryTs.seconds) * 1000 + Math.floor(Number(retryTs.nanos || 0) / 1e6);
      }

      const traj = aspState.trajectorySlice;
      const rawErr = traj && traj.lastStepError;
      const lastStepType = traj ? Number(traj.lastStepType || 0) : 0;
      const errSuperseded = isSupersededStepError({
        lastStepType,
        stepsTail: traj && Array.isArray(traj.stepsInSlice) ? traj.stepsInSlice.slice(-4) : [],
        totalStepsLen: traj && typeof traj.totalStepsLength === 'number' ? traj.totalStepsLength : 0,
        errorId: rawErr && rawErr.errorId ? rawErr.errorId : ''
      });
      let lastStepErrorMsg = '';
      if (rawErr && !rawErr.isBenign && !errSuperseded) {
        lastStepErrorMsg = String(
          rawErr.shortError || rawErr.userErrorMessage || rawErr.modelErrorMessage || rawErr.fullError || ''
        ).trim();
      }

      const aspStatus = Number(aspState.status || 0);
      const execLoopStatus = Number(aspState.executorLoopStatus || 0);
      const effRunStatus =
        aspState.executorLoopStatus !== undefined && execLoopStatus !== 0 ? execLoopStatus : aspStatus;

      return {
        hasProvider: true,
        matched: true,
        cid: providerCid,
        aspStatus,
        execLoopStatus,
        effRunStatus,
        fullyIdle: aspState.fullyIdle !== false,
        hasTrajectory: Boolean(traj),
        execCase,
        execAttempt: execVal && typeof execVal.attempt === 'number' ? execVal.attempt : 0,
        execMaxAttempts: execVal && typeof execVal.maxAttempts === 'number' ? execVal.maxAttempts : 0,
        execRetryAtMs: retryAtMs,
        execInitText: execCase === 'initialization' && typeof execVal === 'string' ? execVal : '',
        lastStepType,
        lastStepErrorMsg,
        loadingText,
        stopBtnActive
      };
    } catch {
      return { hasProvider: false, matched: false, loadingText: '', stopBtnActive: false };
    }
  }

  function readActiveStreamProgressLen(scopeContainer) {
    try {
      const root = scopeContainer && scopeContainer.querySelectorAll ? scopeContainer : document;
      const nodes = root.querySelectorAll('[data-markdown-root], .prose');
      if (!nodes.length) return 0;
      const lastNode = nodes[nodes.length - 1];
      const txtLen = lastNode && lastNode.textContent ? lastNode.textContent.length : 0;
      return nodes.length * 100000 + txtLen;
    } catch {
      return 0;
    }
  }

  function formatQuotaWindowLabel(bucket, isZh = true) {
    const rawWin = String((bucket && bucket.window) || '').trim().toLowerCase();
    if (rawWin === 'daily') return isZh ? '每日限额' : 'Daily limit';
    if (rawWin === 'weekly') return isZh ? '每周限额' : 'Weekly limit';
    if (/^\d+[smhd]$/.test(rawWin)) {
      if (!isZh) return rawWin + ' limit';
      const num = rawWin.slice(0, -1);
      const unit = rawWin.slice(-1);
      const unitZh = unit === 'h' ? '小时' : unit === 'd' ? '天' : unit === 'm' ? '分钟' : '秒';
      return num + ' ' + unitZh + '限额';
    }
    return String((bucket && bucket.displayName) || '').trim();
  }

  function resolveQuotaResetTimeMs(bucket) {
    if (!bucket || typeof bucket !== 'object') return 0;
    if (typeof bucket.resetTimeMs === 'number' && Number.isFinite(bucket.resetTimeMs) && bucket.resetTimeMs > 0) {
      return bucket.resetTimeMs;
    }
    const rt = bucket.resetTime;
    if (!rt) return 0;
    if (typeof rt === 'number' && Number.isFinite(rt)) {
      return rt > 1e11 ? rt : rt * 1000;
    }
    if (rt instanceof Date) {
      const t = rt.getTime();
      return Number.isFinite(t) ? t : 0;
    }
    if (typeof rt === 'string') {
      const parsed = Date.parse(rt);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    if (typeof rt === 'object' && typeof rt.seconds !== 'undefined') {
      const ms = Number(rt.seconds) * 1000 + Math.round(Number(rt.nanos || 0) / 1e6);
      return Number.isFinite(ms) ? ms : 0;
    }
    return 0;
  }

  function formatQuotaResetCountdown(resetTimeMs, nowMs = Date.now(), isZh = true) {
    if (!resetTimeMs || !Number.isFinite(resetTimeMs)) return '';
    const diffMs = resetTimeMs - nowMs;
    if (diffMs <= 0) return isZh ? '<1 分钟后重置' : 'Resets in <1m';
    const totalMins = Math.floor(diffMs / 60000);
    const days = Math.floor(totalMins / 1440);
    const hours = Math.floor((totalMins % 1440) / 60);
    const mins = totalMins % 60;
    if (isZh) {
      if (days > 0) return hours > 0 ? days + ' 天 ' + hours + ' 小时后重置' : days + ' 天后重置';
      if (hours > 0) return mins > 0 ? hours + ' 小时 ' + mins + ' 分钟后重置' : hours + ' 小时后重置';
      if (mins > 0) return mins + ' 分钟后重置';
      return '<1 分钟后重置';
    }
    if (days > 0) return 'Resets in ' + (hours > 0 ? days + 'd ' + hours + 'h' : days + 'd');
    if (hours > 0) return 'Resets in ' + (mins > 0 ? hours + 'h ' + mins + 'm' : hours + 'h');
    if (mins > 0) return 'Resets in ' + mins + 'm';
    return 'Resets in <1m';
  }

  function normalizeOfficialQuotaGroups(rawGroups, { nowMs = Date.now(), isZh = true } = {}) {
    if (!Array.isArray(rawGroups)) return [];
    const groups = [];
    for (let i = 0; i < rawGroups.length; i++) {
      const g = rawGroups[i];
      if (!g || !Array.isArray(g.buckets) || g.buckets.length === 0) continue;
      const gName = String(g.displayName || '').trim();
      const buckets = [];
      for (let j = 0; j < g.buckets.length; j++) {
        const b = g.buckets[j];
        if (!b || typeof b !== 'object') continue;
        let fraction = undefined;
        if (b.remaining && b.remaining.case === 'remainingFraction' && typeof b.remaining.value === 'number') {
          fraction = b.remaining.value;
        } else if (typeof b.remainingFraction === 'number') {
          fraction = b.remainingFraction;
        }
        const hasFraction = typeof fraction === 'number' && Number.isFinite(fraction);
        const clamped = hasFraction ? Math.max(0, Math.min(1, fraction)) : undefined;
        const remainingPct = hasFraction ? Math.round(clamped * 100) : null;
        const level = !hasFraction ? 'unknown' : clamped < 0.1 ? 'crit' : clamped < 0.25 ? 'warn' : 'ok';
        const resetMs = resolveQuotaResetTimeMs(b);
        const resetText = resetMs ? formatQuotaResetCountdown(resetMs, nowMs, isZh) : '';
        const winLabel = formatQuotaWindowLabel(b, isZh);
        const desc = String(b.description || '').trim();
        buckets.push({
          bucketId: String(b.bucketId || j),
          displayName: String(b.displayName || '').trim(),
          windowLabel: winLabel,
          remainingFraction: clamped,
          remainingPct,
          level,
          resetText: resetText || desc,
          disabled: Boolean(b.disabled)
        });
      }
      if (buckets.length > 0) {
        groups.push({
          displayName: gName,
          description: String(g.description || '').trim(),
          buckets
        });
      }
    }
    return groups;
  }

  function findAntigravityServices(scopeEl) {
    if (typeof document === 'undefined') return { cloudCodeService: null, store: null };
    try {
      const roots = [];
      if (scopeEl) roots.push(scopeEl);
      const box = document.getElementById(SELECTORS.inputBoxId);
      if (box && !roots.includes(box)) roots.push(box);
      const modelBtn = document.querySelector('[data-testid="model-selector-trigger"]');
      if (modelBtn && !roots.includes(modelBtn)) roots.push(modelBtn);
      const appRoot = document.getElementById('root') || document.body;
      if (appRoot && appRoot.firstElementChild && !roots.includes(appRoot.firstElementChild)) {
        roots.push(appRoot.firstElementChild);
      }

      let cloudCodeService = null;
      let store = null;
      for (let r = 0; r < roots.length && (!cloudCodeService || !store); r++) {
        const el = roots[r];
        if (!el) continue;
        const fk = Object.keys(el).find(
          (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')
        );
        let cur = fk ? el[fk] : null;
        for (let i = 0; i < 80 && cur && (!cloudCodeService || !store); i++, cur = cur.return) {
          const val = cur.memoizedProps && cur.memoizedProps.value;
          if (!val || typeof val !== 'object') continue;
          if (
            !cloudCodeService &&
            val.core &&
            val.core.cloudCodeService &&
            typeof val.core.cloudCodeService.retrieveUserQuotaSummary === 'function'
          ) {
            cloudCodeService = val.core.cloudCodeService;
          }
          if (!store && val.store && typeof val.store.getState === 'function') {
            store = val.store;
          }
        }
      }
      return { cloudCodeService, store };
    } catch {
      return { cloudCodeService: null, store: null };
    }
  }

  function readCachedOfficialQuotaFromStore(store) {
    if (!store || typeof store.getState !== 'function') return null;
    try {
      const state = store.getState();
      if (!state || typeof state !== 'object') return null;
      let rawGroups = null;
      let description = '';
      const queries = state.modelQuotaApi && state.modelQuotaApi.queries;
      if (queries && typeof queries === 'object') {
        const vals = Object.values(queries);
        for (let i = vals.length - 1; i >= 0; i--) {
          const q = vals[i];
          if (q && q.data && Array.isArray(q.data.groups)) {
            rawGroups = q.data.groups;
            description = String(q.data.description || '');
            break;
          }
        }
      }
      const creditsState = state.credits && typeof state.credits === 'object' ? state.credits : null;
      const availableCredits =
        creditsState && typeof creditsState.availableCredits === 'number' ? creditsState.availableCredits : null;
      const useAICredits = Boolean(creditsState && creditsState.useAICredits);
      const planName = String(
        (state.userStatus && state.userStatus.userTier && state.userStatus.userTier.description) || ''
      ).trim();
      return { rawGroups, description, availableCredits, useAICredits, planName };
    } catch {
      return null;
    }
  }

  function loadOfficialQuotaSummary({ forceRefresh = false, scopeEl = null, isZh = true } = {}) {
    if (typeof window === 'undefined') {
      return Promise.resolve({ ok: false, unavailable: true, groups: [] });
    }
    const now = Date.now();
    const { cloudCodeService, store } = findAntigravityServices(scopeEl);
    const storeSnap = readCachedOfficialQuotaFromStore(store);

    const cache = window.__ag_official_quota_cache;
    if (!forceRefresh && cache && now - cache.fetchedAt < 30000 && Array.isArray(cache.rawGroups)) {
      return Promise.resolve({
        ok: true,
        cached: true,
        fetchedAt: cache.fetchedAt,
        groups: normalizeOfficialQuotaGroups(cache.rawGroups, { nowMs: now, isZh }),
        availableCredits: storeSnap ? storeSnap.availableCredits : cache.availableCredits,
        useAICredits: storeSnap ? storeSnap.useAICredits : cache.useAICredits,
        planName: (storeSnap && storeSnap.planName) || cache.planName || ''
      });
    }

    if (!cloudCodeService) {
      if (storeSnap && Array.isArray(storeSnap.rawGroups)) {
        return Promise.resolve({
          ok: true,
          cached: true,
          fetchedAt: now,
          groups: normalizeOfficialQuotaGroups(storeSnap.rawGroups, { nowMs: now, isZh }),
          availableCredits: storeSnap.availableCredits,
          useAICredits: storeSnap.useAICredits,
          planName: storeSnap.planName || ''
        });
      }
      return Promise.resolve({ ok: false, unavailable: true, groups: [] });
    }

    if (window.__ag_official_quota_inflight && (!forceRefresh || window.__ag_official_quota_inflight_force)) {
      return window.__ag_official_quota_inflight.then((res) =>
        Object.assign({}, res, {
          groups: normalizeOfficialQuotaGroups(res.rawGroups || [], { nowMs: Date.now(), isZh })
        })
      );
    }

    window.__ag_official_quota_inflight_force = Boolean(forceRefresh);
    const req = Promise.resolve()
      .then(() => cloudCodeService.retrieveUserQuotaSummary(Boolean(forceRefresh)))
      .then((res) => {
        const rawGroups = (res && res.response && Array.isArray(res.response.groups) && res.response.groups) ||
          (res && Array.isArray(res.groups) && res.groups) || [];
        const fetchedAt = Date.now();
        const latestStore = readCachedOfficialQuotaFromStore(store) || storeSnap;
        const entry = {
          ok: true,
          cached: false,
          fetchedAt,
          rawGroups,
          availableCredits: latestStore ? latestStore.availableCredits : null,
          useAICredits: Boolean(latestStore && latestStore.useAICredits),
          planName: (latestStore && latestStore.planName) || ''
        };
        window.__ag_official_quota_cache = entry;
        return Object.assign({}, entry, {
          groups: normalizeOfficialQuotaGroups(rawGroups, { nowMs: fetchedAt, isZh })
        });
      })
      .catch(() => {
        const prev = window.__ag_official_quota_cache;
        if (prev && Array.isArray(prev.rawGroups)) {
          return Object.assign({}, prev, {
            groups: normalizeOfficialQuotaGroups(prev.rawGroups, { nowMs: Date.now(), isZh })
          });
        }
        return { ok: false, unavailable: false, groups: [], rawGroups: [] };
      })
      .finally(() => {
        if (window.__ag_official_quota_inflight === req) {
          window.__ag_official_quota_inflight = null;
          window.__ag_official_quota_inflight_force = false;
        }
      });

    window.__ag_official_quota_inflight = req;
    return req;
  }
