/**
 * Part 40: 4-State Session Status State Machine (Pure / Testable)
 *
 * ZERO DOM/window dependencies so Node unit tests can evaluate this file directly via `node:vm`.
 * Depends optionally on `normalizeModelMatchKey` from Part 30 (provides local fallback if absent).
 *
 * Visual States:
 *   - 'idle'    : Session ready (steady blue indicator)
 *   - 'running' : Active LLM / Compact / Tool step progressing (pulsing blue indicator)
 *   - 'slow'    : Waiting >= 60s without first byte/progress, model retry, or brief disconnect (3s-11s) (pulsing yellow indicator)
 *   - 'error'   : Offline, disconnect >= 12s, API/step failure, or background service timeout (pulsing red indicator)
 */
  const WAIT_DEFAULTS = Object.freeze({
    SLOW_WAIT_SEC: 60,
    UNCONN_WARN_SEC: 3,
    UNCONN_ERROR_SEC: 12,
    HEARTBEAT_STALE_MS: 90000,
    VISIBLE_GRACE_MS: 20000
  });

  function fmtWaitDuration(sec) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    if (s < 60) return s + 's';
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m + 'm' + (r > 0 ? String(r).padStart(2, '0') + 's' : '');
  }

  function isUserCancelError(msg) {
    const s = String(msg || '').trim();
    if (!s) return false;
    return /(\bcontext\s+canceled\b|\bcancell?ed\s+by\s+user\b|\baborted\s+by\s+user\b|\buser\s+cancell?ed\b)/i.test(
      s
    );
  }

  function escapeStatusHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function _fallbackCleanModelLabel(raw) {
    return String(raw || '')
      .trim()
      .replace(/^(?:Select model|Model(?:\s+selector)?)(?:,\s*current)?:\s*/i, '')
      .replace(/^模型(?:选择器)?(?:[，,]\s*当前)?[：:]\s*/, '')
      .replace(/,\s*(?:Model\s+cannot\s+be\s+changed|Cannot\s+be\s+changed|Disabled|Locked)[\s\S]*$/i, '')
      .replace(
        /\s*[（(]\s*(?:Model\s+cannot\s+be\s+changed|Cannot\s+be\s+changed|智能体运行期间无法切换模型|会话中途无法更改)[^）)]*[）)]\s*$/i,
        ''
      )
      .trim();
  }

  function _fallbackNormalizeModelKey(label) {
    return _fallbackCleanModelLabel(label)
      .toLowerCase()
      .replace(/\(\s*extra[\s_-]*high\s*\)|\bextra[\s_-]*high\b/g, 'extrahigh')
      .replace(/\(\s*x[\s_-]*high\s*\)|\bx[\s_-]*high\b/g, 'extrahigh')
      .replace(/\(\s*extra\s*\)|\bextra\b/g, 'extrahigh')
      .replace(/[^a-z0-9]+/g, '');
  }

  function _formatDisplayModelLabel(label) {
    const cleanFn = typeof cleanModelLabel === 'function' ? cleanModelLabel : _fallbackCleanModelLabel;
    return cleanFn(label)
      .replace(/\(\s*(?:x[\s_-]*high|extra[\s_-]*high)\s*\)/gi, '(Extra High)')
      .replace(/\bx[\s_-]*high\b/gi, 'Extra High');
  }

  function computeStatusSnapshot({
    now = Date.now(),
    st = null,
    live = null,
    waitSec = 0,
    unconnSec = 0,
    lastHb = 0,
    visibleSince = 0,
    documentHidden = false,
    navigatorOnline = true,
    hasConversation = true,
    curModel = '',
    isZh = true,
    limits = WAIT_DEFAULTS
  } = {}) {
    const cfg = Object.assign({}, WAIT_DEFAULTS, limits || {});
    const normModelFn =
      typeof normalizeModelMatchKey === 'function' ? normalizeModelMatchKey : _fallbackNormalizeModelKey;

    const liveUsable = Boolean(live && live.matched);
    const hasProvider = Boolean(liveUsable && live.hasProvider);
    const aspStatus = hasProvider ? Number(live.aspStatus || 0) : -1;
    const effRunStatus = hasProvider ? Number(live.effRunStatus || 0) : -1;
    const hasTrajectory = Boolean(hasProvider && live.hasTrajectory);
    const execCase = hasProvider ? String(live.execCase || '') : '';
    const loadingText = liveUsable ? String(live.loadingText || '').trim() : '';
    const loadingRetryMatch = loadingText
      ? loadingText.match(/(?:retrying|Model unavailable|attempt\s*\d+\/\d+|重试|暂不可用|不可用).*$/i)
      : null;
    const stopBtnActive = Boolean(liveUsable && live.stopBtnActive);

    // Explicitly do NOT require live.fullyIdle === true: Antigravity often leaves background flags non-idle after completion.
    const liveDefinitelyStopped = Boolean(
      hasProvider &&
        hasTrajectory &&
        effRunStatus === 1 &&
        !stopBtnActive &&
        execCase !== 'modelRequest' &&
        !loadingRetryMatch
    );

    const stKindRaw = st && st.pendingKind ? String(st.pendingKind) : 'idle';
    const stKind =
      stKindRaw === 'llm' || stKindRaw === 'compact' || stKindRaw === 'tool' ? stKindRaw : 'idle';
    const liveBusy = Boolean(
      hasProvider
        ? effRunStatus === 2 || execCase === 'modelRequest' || loadingRetryMatch || stopBtnActive
        : loadingRetryMatch || stopBtnActive
    );

    let effKind = stKind;
    if (effKind === 'idle' && liveBusy) {
      effKind = 'llm';
    }
    const isExecuting = Boolean(!liveDefinitelyStopped && (effKind === 'llm' || effKind === 'compact' || effKind === 'tool'));
    if (!isExecuting) {
      effKind = 'idle';
    }

    const liveErrRaw = hasProvider && live.lastStepErrorMsg ? String(live.lastStepErrorMsg).trim() : '';
    const isLiveNonCancelErr = Boolean(liveErrRaw && !isUserCancelError(liveErrRaw));

    const stRetrying = Boolean(st && st.pendingRetrying);
    const liveRetrying = Boolean(
      isExecuting &&
        hasProvider &&
        (execCase === 'modelRequest' || Boolean(loadingRetryMatch) || isLiveNonCancelErr)
    );
    const isRetrying = Boolean(isExecuting && !liveDefinitelyStopped && (stRetrying || liveRetrying));

    const isStreamUnconnected = Boolean(hasConversation && hasProvider && aspStatus === 0 && !hasTrajectory);
    const unconnDurSec = Math.max(0, Math.floor(Number(unconnSec) || 0));
    const waitDurSec = Math.max(0, Math.floor(Number(waitSec) || 0));

    const offlineProblem = !navigatorOnline
      ? isZh
        ? '当前网络已断开（离线），无法连接到模型服务'
        : 'Network offline — unable to reach model service'
      : '';
    const unconnProblem =
      isStreamUnconnected && unconnDurSec >= cfg.UNCONN_ERROR_SEC
        ? isZh
          ? '会话流未连接或重连超时（已等待 ' + fmtWaitDuration(unconnDurSec) + '）'
          : 'Session stream disconnected or reconnect timed out (' + fmtWaitDuration(unconnDurSec) + ')'
        : '';
    const unconnSlow = Boolean(
      isStreamUnconnected && unconnDurSec >= cfg.UNCONN_WARN_SEC && unconnDurSec < cfg.UNCONN_ERROR_SEC
    );

    const stErrRaw = st && st.lastErrorMsg ? String(st.lastErrorMsg).trim() : '';
    const stErrNonCancel = stErrRaw && !isUserCancelError(stErrRaw) ? stErrRaw : '';
    const apiErrMsg = !isExecuting ? stErrNonCancel || (isLiveNonCancelErr ? liveErrRaw : '') : '';

    const hbMs = Number(lastHb) || 0;
    const visMs = Number(visibleSince) || 0;
    const daemonProblem =
      !documentHidden &&
      hbMs > 0 &&
      now - hbMs > cfg.HEARTBEAT_STALE_MS &&
      (visMs === 0 || now - visMs >= cfg.VISIBLE_GRACE_MS)
        ? isZh
          ? '后台统计服务响应超时（超过 ' + fmtWaitDuration((now - hbMs) / 1000) + ' 未收到心跳）'
          : 'Background telemetry service timed out (no heartbeat for ' + fmtWaitDuration((now - hbMs) / 1000) + ')'
        : '';

    const curModelDisplay = _formatDisplayModelLabel(curModel);
    const lastModelDisplay = _formatDisplayModelLabel(st && st.lastModelLabel ? st.lastModelLabel : '');
    const curNorm = normModelFn(curModelDisplay);
    const lastNorm = lastModelDisplay ? normModelFn(lastModelDisplay) : '';
    const modelSwitched = Boolean(curNorm && lastNorm && curNorm !== lastNorm);

    const isModelWaiting = Boolean(isExecuting && waitDurSec >= cfg.SLOW_WAIT_SEC);
    const hardErrMsg = offlineProblem || unconnProblem || apiErrMsg;

    let visualState = 'idle';
    if (hardErrMsg) {
      visualState = 'error';
    } else if (unconnSlow || isRetrying || isModelWaiting) {
      visualState = 'slow';
    } else if (isExecuting) {
      visualState = 'running';
    } else if (daemonProblem) {
      visualState = 'error';
    }

    let chipText = '';
    let chipClass = '';
    let dotTitle = isZh ? '会话状态：就绪' : 'Session status: Ready';
    let noteHtml = '';
    let noteClass = '';

    if (visualState === 'error') {
      const errDetail = hardErrMsg || daemonProblem || (isZh ? '请求或连接出现异常' : 'Request or connection error');
      chipClass = 'is-error';
      if (offlineProblem) {
        chipText = isZh ? '网络离线' : 'Offline';
      } else if (unconnProblem) {
        chipText = (isZh ? '未连接 · ' : 'Disconnected · ') + fmtWaitDuration(unconnDurSec);
      } else if (apiErrMsg) {
        chipText = isZh ? '执行报错' : 'Error';
      } else {
        chipText = isZh ? '后台断连' : 'Service lost';
      }
      dotTitle = (isZh ? '会话状态：异常 · ' : 'Session status: Error · ') + errDetail;
      noteClass = 'is-visible is-error';
      noteHtml = (isZh ? '<strong>连接 / 执行异常</strong><br/>' : '<strong>Connection / Execution Error</strong><br/>') + escapeStatusHtml(errDetail);
    } else if (visualState === 'slow') {
      chipClass = 'is-slow';
      if (unconnSlow) {
        chipText = (isZh ? '重连中 · ' : 'Reconnecting · ') + fmtWaitDuration(unconnDurSec);
        dotTitle = isZh
          ? '会话状态：等待或重试 · 正在建立会话流连接（已等待 ' + fmtWaitDuration(unconnDurSec) + '）'
          : 'Session status: Reconnecting (' + fmtWaitDuration(unconnDurSec) + ')';
        noteClass = 'is-visible';
        noteHtml = isZh
          ? '<strong>会话连接中 (' +
            escapeStatusHtml(fmtWaitDuration(unconnDurSec)) +
            ')</strong><br/>当前窗口暂未完成数据流同步；若网络受限将转为红灯脉冲提示。'
          : '<strong>Connecting (' +
            escapeStatusHtml(fmtWaitDuration(unconnDurSec)) +
            ')</strong><br/>Waiting for session stream sync; turns red if connection fails.';
      } else if (isRetrying) {
        const retryBrief =
          (loadingRetryMatch && loadingRetryMatch[0]) ||
          (st && st.retryReason) ||
          (live && live.execAttempt && live.execMaxAttempts
            ? (isZh ? '正在重试连接 (attempt ' : 'Retrying connection (attempt ') + live.execAttempt + '/' + live.execMaxAttempts + ')'
            : isZh
            ? '正在自动重试模型连接'
            : 'Automatically retrying model connection');
        let countdownSuffix = '';
        if (hasProvider && live.execRetryAtMs && live.execRetryAtMs > now) {
          const leftSec = Math.max(1, Math.ceil((live.execRetryAtMs - now) / 1000));
          countdownSuffix = ' · ' + leftSec + 's';
        }
        chipText = (isZh ? '重试连接中' : 'Retrying') + countdownSuffix;
        dotTitle = (isZh ? '会话状态：等待或重试 · ' : 'Session status: Retrying · ') + retryBrief;
        noteClass = 'is-visible';
        noteHtml = (isZh ? '<strong>模型自动重试中</strong><br/>' : '<strong>Model Auto-Retrying</strong><br/>') + escapeStatusHtml(retryBrief);
      } else {
        const waitStr = fmtWaitDuration(waitDurSec);
        if (effKind === 'compact') {
          chipText = (isZh ? '压缩中 · ' : 'Compacting · ') + waitStr;
          dotTitle = isZh
            ? '会话状态：等待或重试 · 上下文压缩中（已等待 ' + waitStr + '）'
            : 'Session status: Compacting context (' + waitStr + ')';
          noteClass = 'is-visible';
          noteHtml = isZh
            ? '<strong>正在执行 /compact 上下文压缩（' +
              escapeStatusHtml(waitStr) +
              '）</strong>' +
              (modelSwitched
                ? '<br/>检测到模型已从 <code>' +
                  escapeStatusHtml(lastModelDisplay) +
                  '</code> 切换为 <code>' +
                  escapeStatusHtml(curModelDisplay) +
                  '</code>，无法复用原 KV 缓存，全量重算耗时较长属正常现象。建议下次保持原模型压缩后再切换模型。'
                : '<br/>系统正在汇总长对话历史，生成检查点后将自动恢复蓝色常亮。')
            : '<strong>Compacting context (' +
              escapeStatusHtml(waitStr) +
              ')</strong>' +
              (modelSwitched
                ? '<br/>Model switched from <code>' +
                  escapeStatusHtml(lastModelDisplay) +
                  '</code> to <code>' +
                  escapeStatusHtml(curModelDisplay) +
                  '</code>; full prefill without KV cache reuse takes longer.'
                : '<br/>Summarizing conversation history into a checkpoint.');
        } else if (effKind === 'tool') {
          chipText = (isZh ? '工具等待 · ' : 'Tool wait · ') + waitStr;
          dotTitle = isZh
            ? '会话状态：等待或重试 · 工具执行等待中（已等待 ' + waitStr + '）'
            : 'Session status: Waiting for tool (' + waitStr + ')';
          noteClass = 'is-visible';
          noteHtml = isZh
            ? '<strong>工具步执行等待中（' +
              escapeStatusHtml(waitStr) +
              '）</strong><br/>本地命令、文件检索或子任务尚未返回结果，请稍候。'
            : '<strong>Waiting on tool step (' +
              escapeStatusHtml(waitStr) +
              ')</strong><br/>Waiting for command, search, or subagent result.';
        } else {
          chipText = (isZh ? '首字等待 · ' : 'Waiting · ') + waitStr;
          dotTitle = isZh
            ? '会话状态：等待或重试 · 等待模型响应（已等待 ' + waitStr + '）'
            : 'Session status: Waiting for model (' + waitStr + ')';
          noteClass = 'is-visible';
          noteHtml = isZh
            ? '<strong>等待模型首字输出（' +
              escapeStatusHtml(waitStr) +
              '）</strong>' +
              (modelSwitched
                ? '<br/>模型已切换为 <code>' +
                  escapeStatusHtml(curModelDisplay) +
                  '</code>（原 <code>' +
                  escapeStatusHtml(lastModelDisplay) +
                  '</code>），当前正在冷启动预填充上下文，完成后即可恢复高速输出。'
                : '<br/>长上下文预填充或后端排队耗时较长，连接仍处于激活状态。')
            : '<strong>Waiting for first token (' +
              escapeStatusHtml(waitStr) +
              ')</strong>' +
              (modelSwitched
                ? '<br/>Model switched to <code>' +
                  escapeStatusHtml(curModelDisplay) +
                  '</code> (from <code>' +
                  escapeStatusHtml(lastModelDisplay) +
                  '</code>); cold context prefill is in progress.'
                : '<br/>Long context prefill or backend queueing in progress; connection is active.');
        }
      }
    } else if (visualState === 'running') {
      if (effKind === 'compact') {
        chipText = isZh ? '正在压缩...' : 'Compacting…';
        dotTitle = isZh ? '会话状态：执行中 · 正在压缩上下文历史' : 'Session status: Compacting context';
      } else if (effKind === 'tool') {
        chipText = isZh ? '工具执行中...' : 'Running tool…';
        dotTitle = isZh ? '会话状态：执行中 · 正在执行工具调用' : 'Session status: Running tool';
      } else {
        chipText = isZh ? '新步执行中...' : 'Running…';
        dotTitle = isZh ? '会话状态：执行中 · 模型推理与输出中' : 'Session status: Model generating';
      }
    } else {
      chipText = '';
      dotTitle = isZh ? '会话状态：就绪' : 'Session status: Ready';
    }

    return {
      visualState,
      effKind,
      isExecuting,
      isModelWaiting,
      isRetrying,
      isStreamUnconnected,
      unconnSlow,
      dotTitle,
      chipText,
      chipClass,
      noteHtml,
      noteClass,
      shouldStartWaitTimer: Boolean(isExecuting || isStreamUnconnected)
    };
  }
