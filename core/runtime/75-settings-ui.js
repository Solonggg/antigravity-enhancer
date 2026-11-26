/**
 * Part 75: Embedded Native Enhancer Settings Panel (inside Antigravity Settings Modal)
 * Mounts a native-style "Antigravity增强" tab into [data-testid="settings-sidebar"],
 * persists changes to user/config.json via local CDP bindings with ~200ms hot-reload,
 * provides simplified Open-In target toggles, and includes a 2-level popover model picker
 * populated from local `agy models`. Zero outbound network calls or external links.
 */
  const AG_SETTINGS_FALLBACK_FAMILIES = [
    {
      key: 'gemini-3.8-flash',
      name: 'Gemini 3.8 Flash',
      recommended: true,
      defaultEffort: 'Low',
      efforts: [
        { label: 'Low', id: 'gemini-3.8-flash-low' },
        { label: 'Medium', id: 'gemini-3.8-flash-medium' },
        { label: 'High', id: 'gemini-3.8-flash-high' }
      ]
    },
    {
      key: 'gemini-4-neon',
      name: 'Gemini 4 Neon',
      recommended: false,
      defaultEffort: 'Medium',
      efforts: [
        { label: 'Low', id: 'gemini-4-neon-low' },
        { label: 'Medium', id: 'gemini-4-neon-medium' },
        { label: 'High', id: 'gemini-4-neon-high' },
        { label: 'Extra High', id: 'gemini-4-neon-xhigh' }
      ]
    },
    {
      key: 'gemini-4-carbon',
      name: 'Gemini 4 Carbon',
      recommended: false,
      defaultEffort: 'Medium',
      efforts: [
        { label: 'Low', id: 'gemini-4-carbon-low' },
        { label: 'Medium', id: 'gemini-4-carbon-medium' },
        { label: 'High', id: 'gemini-4-carbon-high' }
      ]
    },
    {
      key: 'gemini-4-argon',
      name: 'Gemini 4 Argon',
      recommended: false,
      defaultEffort: 'Medium',
      efforts: [
        { label: 'Low', id: 'gemini-4-argon-low' },
        { label: 'Medium', id: 'gemini-4-argon-medium' },
        { label: 'High', id: 'gemini-4-argon-high' }
      ]
    },
    {
      key: 'gemini-4-hydrogen',
      name: 'Gemini 4 Hydrogen',
      recommended: false,
      defaultEffort: 'Medium',
      efforts: [
        { label: 'Low', id: 'gemini-4-hydrogen-low' },
        { label: 'Medium', id: 'gemini-4-hydrogen-medium' },
        { label: 'High', id: 'gemini-4-hydrogen-high' },
        { label: 'Extra High', id: 'gemini-4-hydrogen-xhigh' }
      ]
    },
    {
      key: 'claude-opus-5-5',
      name: 'Claude Opus 5.5',
      recommended: false,
      defaultEffort: 'Medium',
      efforts: [
        { label: 'Low', id: 'claude-opus-5-5-low' },
        { label: 'Medium', id: 'claude-opus-5-5-medium' },
        { label: 'High', id: 'claude-opus-5-5-high' }
      ]
    },
    {
      key: 'claude-sonnet-5-5',
      name: 'Claude Sonnet 5.5',
      recommended: false,
      defaultEffort: 'Medium',
      efforts: [
        { label: 'Low', id: 'claude-sonnet-5-5-low' },
        { label: 'Medium', id: 'claude-sonnet-5-5-medium' },
        { label: 'High', id: 'claude-sonnet-5-5-high' }
      ]
    },
    {
      key: 'gpt-oss-120b',
      name: 'GPT-OSS 120B (Medium)',
      recommended: false,
      singleId: 'gpt-oss-120b-medium',
      efforts: []
    }
  ];

  const AG_OPEN_IN_TARGET_META = [
    { id: 'idea', name: 'IDEA' },
    { id: 'finder', name: 'Finder' },
    { id: 'zed', name: 'Zed' },
    { id: 'vscode', name: 'VS Code' },
    { id: 'cursor', name: 'Cursor' }
  ];

  function cleanupEnhancerSettingsDom() {
    try {
      for (const id of [
        'ag-settings-nav-divider',
        'ag-settings-nav-wrap',
        'ag-settings-pane',
        'ag-settings-model-menu',
        'ag-settings-effort-menu'
      ]) {
        const el = document.getElementById(id);
        if (el) el.remove();
      }
      document.querySelectorAll('[data-ag-enhancer-settings-open]').forEach((el) => {
        el.removeAttribute('data-ag-enhancer-settings-open');
      });
      document.querySelectorAll('[data-ag-settings-right-pane]').forEach((el) => {
        el.removeAttribute('data-ag-settings-right-pane');
      });
    } catch {}
  }

  function mountEnhancerSettingsUi() {
    if (IS_SWARM_PLUGIN_FRAME || !ENABLED) {
      cleanupEnhancerSettingsDom();
      return;
    }
    if (typeof document === 'undefined' || !document.body) return;

    (function initEnhancerSettingsUi() {
      const SUPPORTS_POPOVER =
        typeof HTMLElement !== 'undefined' && Object.hasOwn(HTMLElement.prototype, 'popover');
      const SUPPORTS_FOCUSGROUP =
        typeof HTMLElement !== 'undefined' && 'focusGroup' in HTMLElement.prototype;

      let disposed = false;
      let reqSeq = 0;
      const pendingReqs = new Map();
      let scanTimer = null;
      let statusPollTimer = null;
      let saveBadgeTimer = null;
      let hoverSwitchTimer = null;
      let pendingPaneRender = false;
      let hoveredFamilyKey = '';
      let editingIdeaPath = false;
      let invalidIdeaPath = false;
      let refreshingModels = false;
      let refreshingAll = false;
      let activeDlg = null;
      let activeSidebar = null;
      let boundSidebarClick = null;

      const bootUserCfg = boot.userConfig && typeof boot.userConfig === 'object' ? boot.userConfig : {};
      const bootOpenIn = bootUserCfg.openIn && typeof bootUserCfg.openIn === 'object' ? bootUserCfg.openIn : {};
      const uiState = {
        config: {
          telemetryLayout: bootUserCfg.telemetryLayout || boot.telemetryLayout || 'compact',
          telemetryCacheMode: bootUserCfg.telemetryCacheMode || boot.telemetryCacheMode || 'session',
          promptSuggestionModel: bootUserCfg.promptSuggestionModel || 'gemini-3.8-flash-low',
          modules: Object.assign({}, MODULES, bootUserCfg.modules || {}),
          openIn: {
            targets: Array.isArray(bootOpenIn.targets) ? bootOpenIn.targets.slice() : ['idea', 'finder'],
            ideaPath: typeof bootOpenIn.ideaPath === 'string' ? bootOpenIn.ideaPath : '',
            copyPath: bootOpenIn.copyPath !== false,
            customTargetsCount: Number(bootOpenIn.customTargetsCount || 0)
          }
        },
        openInDetectors: (window.__ag_settings_openin_detectors && Object.assign({}, window.__ag_settings_openin_detectors)) || {},
        agyStatus: (window.__ag_settings_agy_cache && Object.assign({}, window.__ag_settings_agy_cache)) || {
          available: true,
          running: false,
          starting: false,
          ready: false,
          warmed: false,
          activeModel: ''
        },
        families:
          Array.isArray(window.__ag_settings_models_cache) && window.__ag_settings_models_cache.length > 0
            ? window.__ag_settings_models_cache
            : AG_SETTINGS_FALLBACK_FAMILIES
      };

      function getShortVersionTag() {
        const m = String(PATCH_VERSION || '').match(/^(\d+\.\d+(?:\.\d+)?)/);
        return m ? 'v' + m[1] : 'v0.1.1';
      }

      function getDictCountLabel() {
        try {
          const n = typeof DICT === 'object' && DICT ? Object.keys(DICT).length : 0;
          if (n >= 1000) return Math.floor(n / 100) * 100 + '+';
        } catch {}
        return '4,000+';
      }

      function isZhUi() {
        return Boolean(uiState.config.modules.i18n);
      }

      function getStrings() {
        const dictCnt = getDictCountLabel();
        if (isZhUi()) {
          return {
            navTitle: 'Antigravity增强',
            pageTitle: 'Antigravity增强',
            manualRefreshLabel: '手动重载配置与界面',
            savedBadge: '已同步',
            refreshedBadge: '已刷新',
            subtitlePrefix: '纯本地运行、零外联：管理中文界面、状态栏、右键菜单与下一步预测，修改实时同步至 ',
            subtitleSuffix: '。',
            modI18n: '中文界面汉化',
            modI18nDesc: '内置 ' + dictCnt + ' 界面词条与 Shadow DOM 穿透，原地更新不影响交互，关闭即恢复英文',
            secStatusBar: '状态栏',
            modSessionStatus: '实时会话状态',
            modSessionStatusDesc: '仅读本地运行状态与日志，在底部状态栏显示四态指示灯（就绪 / 执行中 / 等待重试 / 异常）与异常详情',
            modUsageStats: '用量统计',
            modUsageStatsDesc: '仅读本地会话 SQLite，默认展开完整统计明细并复用官方模型配额视图，同时展示每轮回复尾部统计',
            layoutLbl: '底部状态栏密度',
            layoutDesc: '紧凑模式居中嵌在工具栏内；详细模式展开为底部居中独立行，补充 TTFT 与本步输出',
            layoutCompact: '紧凑',
            layoutDetailed: '详细',
            cacheLbl: '缓存命中率口径',
            cacheDesc: '选择状态栏展示整个会话的累计命中率，或最近单步命中率',
            cacheSession: '会话累计',
            cacheStep: '单步',
            secContextMenu: '右键菜单',
            modOpenIn: '右键打开文件引用',
            modOpenInDesc: '在回复中的文件路径上右键，直接用外部编辑器或 Finder 打开并跳转行号，不影响左键',
            openInTargetsLbl: '右键菜单目标',
            ideaPathAutoPrefix: 'IDEA 启动器：',
            ideaPathCustomPrefix: 'IDEA 自定义路径：',
            ideaPathMissing: '未自动检测到 IDEA，请配置路径或在 JetBrains Toolbox 开启 Shell Scripts',
            ideaPathCustomBtn: '自定义路径',
            ideaPathHideBtn: '收起',
            ideaPathPlaceholder: '/Applications/IntelliJ IDEA.app 或 idea CLI 路径',
            ideaPathSave: '保存',
            ideaPathReset: '自动检测',
            openInCustomNote: (n) => '另有 ' + n + ' 个自定义命令目标（来自 user/config.json，仅配置文件可编辑）',
            secNextPrompt: '下一步预测',
            secNextPromptHint: '默认关闭，按需开启',
            modSuggest: '输入框下一句预测',
            modSuggestDescPre: '回复结束后预测下一句指令，按 ',
            modSuggestDescMid: ' 或 ',
            modSuggestDescPost: ' 补全（开启后后台常驻 ',
            modSuggestDescEnd: ' 进程）',
            agyIdle: '未启动',
            agyWarming: '预热中…',
            agyReady: 'agy 就绪',
            agyMissing: '未检测到 agy',
            agyAuthRequired: 'agy 未登录',
            agyAuthHint: '请先在终端执行 agy 完成登录，然后点击顶部刷新按钮即可生效',
            agyError: 'agy 启动异常',
            suggestModelLbl: '预测模型',
            suggestModelDescPre: '由 ',
            suggestModelDescPost: ' 自动按模型与档位分组，推荐 Gemini 3.8 Flash Low',
            refreshModelsTitle: '重新拉取 agy models',
            menuModelsHdr: '模型',
            recommendedBadge: '推荐'
          };
        }
        return {
          navTitle: 'Antigravity Enhancer',
          pageTitle: 'Antigravity Enhancer',
          manualRefreshLabel: 'Reload config & runtime',
          savedBadge: 'Synced',
          refreshedBadge: 'Refreshed',
          subtitlePrefix: '100% local, zero outbound requests. Manage localization, status bar, context menu, and next-prompt suggestions; changes sync to ',
          subtitleSuffix: '.',
          modI18n: 'Chinese UI Localization',
          modI18nDesc: dictCnt + ' built-in entries with Shadow DOM support applied in place; disable to restore English',
          secStatusBar: 'Status Bar',
          modSessionStatus: 'Live Session Status',
          modSessionStatusDesc: 'Reads local runtime state & logs to show the 4-state bottom indicator (ready / running / retrying / error)',
          modUsageStats: 'Usage Stats',
          modUsageStatsDesc: 'Reads local SQLite to show speed/context/cache metrics, default-expanded breakdown with official model quota, and per-turn footers',
          layoutLbl: 'Status Bar Density',
          layoutDesc: 'Compact sits centered inline; Detailed expands to a centered bottom row with TTFT and step output',
          layoutCompact: 'Compact',
          layoutDetailed: 'Detailed',
          cacheLbl: 'Cache Hit Rate Scope',
          cacheDesc: 'Display cumulative session cache hit rate or last-step hit rate',
          cacheSession: 'Session',
          cacheStep: 'Step',
          secContextMenu: 'Context Menu',
          modOpenIn: 'Right-Click Open In',
          modOpenInDesc: 'Right-click file links/paths in replies to open in IDEA, Finder, or editors with line jumping; left-click untouched',
          openInTargetsLbl: 'Context Menu Targets',
          ideaPathAutoPrefix: 'IDEA launcher: ',
          ideaPathCustomPrefix: 'Custom IDEA path: ',
          ideaPathMissing: 'IDEA not auto-detected; set custom path or enable JetBrains Toolbox Shell Scripts',
          ideaPathCustomBtn: 'Custom path',
          ideaPathHideBtn: 'Hide',
          ideaPathPlaceholder: '/Applications/IntelliJ IDEA.app or idea CLI path',
          ideaPathSave: 'Save',
          ideaPathReset: 'Auto',
          openInCustomNote: (n) => '+' + n + ' custom command target(s) loaded from user/config.json (config-file only)',
          secNextPrompt: 'Next Prompt',
          secNextPromptHint: 'Off by default, opt-in',
          modSuggest: 'Prompt Suggestions',
          modSuggestDescPre: 'Predicts the next prompt after each turn; press ',
          modSuggestDescMid: ' or ',
          modSuggestDescPost: ' to accept (runs a background ',
          modSuggestDescEnd: ' worker when enabled)',
          agyIdle: 'Stopped',
          agyWarming: 'Warming up…',
          agyReady: 'agy Ready',
          agyMissing: 'agy not found',
          agyAuthRequired: 'Sign in to agy',
          agyAuthHint: 'Run agy in your terminal to sign in, then click the reload button above',
          agyError: 'agy error',
          suggestModelLbl: 'Suggestion Model',
          suggestModelDescPre: 'Grouped automatically from ',
          suggestModelDescPost: '; Gemini 3.8 Flash Low recommended',
          refreshModelsTitle: 'Refresh agy models',
          menuModelsHdr: 'Models',
          recommendedBadge: 'Rec'
        };
      }

      function escHtml(s) {
        return String(s || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
      }

      function findSelectedModelInfo(modelId) {
        const families = uiState.families || AG_SETTINGS_FALLBACK_FAMILIES;
        for (let i = 0; i < families.length; i++) {
          const fam = families[i];
          if (fam.singleId === modelId) {
            return { family: fam, effortLabel: '' };
          }
          if (Array.isArray(fam.efforts)) {
            for (let j = 0; j < fam.efforts.length; j++) {
              if (fam.efforts[j].id === modelId) {
                return { family: fam, effortLabel: fam.efforts[j].label };
              }
            }
          }
        }
        return {
          family: { key: '', name: modelId || 'Gemini 3.8 Flash', efforts: [] },
          effortLabel: ''
        };
      }

      function callDaemonBinding(bindingName, payloadObj, timeoutMs = 15000) {
        return new Promise((resolve) => {
          const fn = window[bindingName];
          if (typeof fn !== 'function') return resolve(null);
          reqSeq += 1;
          const reqId = `cfg-${Date.now()}-${reqSeq}`;
          const timer = setTimeout(() => {
            pendingReqs.delete(reqId);
            resolve(null);
          }, timeoutMs);
          pendingReqs.set(reqId, (res) => {
            clearTimeout(timer);
            resolve(res);
          });
          try {
            fn(JSON.stringify(Object.assign({ reqId }, payloadObj || {})));
          } catch {
            clearTimeout(timer);
            pendingReqs.delete(reqId);
            resolve(null);
          }
        });
      }

      window.__ag_on_settings_state = (reqId, payload) => {
        if (disposed) return;
        const cb = pendingReqs.get(reqId);
        if (cb) {
          pendingReqs.delete(reqId);
          cb(payload);
        }
      };

      function getWorkerStatusView(s) {
        const psOn = Boolean(uiState.config.modules && uiState.config.modules.promptSuggestions);
        if (!psOn) {
          return { status: 'idle', label: s.agyIdle, hint: '', hintTone: '' };
        }
        if (uiState.agyStatus.available === false) {
          return { status: 'missing', label: s.agyMissing, hint: '', hintTone: '' };
        }
        if (uiState.agyStatus.authRequired) {
          return { status: 'auth', label: s.agyAuthRequired, hint: s.agyAuthHint, hintTone: 'warn' };
        }
        if (uiState.agyStatus.warmed) {
          return { status: 'ready', label: s.agyReady, hint: '', hintTone: '' };
        }
        if (uiState.agyStatus.lastError && !uiState.agyStatus.running) {
          return {
            status: 'error',
            label: s.agyError,
            hint: String(uiState.agyStatus.lastError).slice(0, 140),
            hintTone: 'error'
          };
        }
        return { status: 'warming', label: s.agyWarming, hint: '', hintTone: '' };
      }

      function updateWorkerStatusDom() {
        const s = getStrings();
        const view = getWorkerStatusView(s);
        const pill = document.getElementById('ag-s-worker-pill');
        if (pill) {
          pill.setAttribute('data-status', view.status);
          const lbl = pill.querySelector('.ag-s-worker-label');
          if (lbl && lbl.textContent !== view.label) lbl.textContent = view.label;
        }
        const hintEl = document.getElementById('ag-s-worker-hint');
        if (hintEl) {
          if (view.hint) {
            hintEl.textContent = view.hint;
            hintEl.setAttribute('data-tone', view.hintTone || 'warn');
            hintEl.hidden = false;
          } else {
            hintEl.textContent = '';
            hintEl.hidden = true;
          }
        }
      }

      function applyRemoteState(res, flashSaved, { statusOnly = false } = {}) {
        if (!res || !res.ok) return;
        let familiesChanged = false;
        if (res.config) {
          const nextOpenIn = res.config.openIn && typeof res.config.openIn === 'object' ? res.config.openIn : uiState.config.openIn;
          uiState.config = {
            telemetryLayout: res.config.telemetryLayout || uiState.config.telemetryLayout,
            telemetryCacheMode: res.config.telemetryCacheMode || uiState.config.telemetryCacheMode,
            promptSuggestionModel: res.config.promptSuggestionModel || uiState.config.promptSuggestionModel,
            modules: Object.assign({}, uiState.config.modules, res.config.modules || {}),
            openIn: {
              targets: Array.isArray(nextOpenIn.targets) ? nextOpenIn.targets.slice() : uiState.config.openIn.targets,
              ideaPath: typeof nextOpenIn.ideaPath === 'string' ? nextOpenIn.ideaPath : uiState.config.openIn.ideaPath,
              copyPath: nextOpenIn.copyPath !== false,
              customTargetsCount: Number(nextOpenIn.customTargetsCount || 0)
            }
          };
        }
        if (res.openInDetectors && typeof res.openInDetectors === 'object') {
          uiState.openInDetectors = Object.assign({}, res.openInDetectors);
          window.__ag_settings_openin_detectors = Object.assign({}, res.openInDetectors);
        }
        if (res.agyStatus) {
          uiState.agyStatus = Object.assign({}, res.agyStatus);
          window.__ag_settings_agy_cache = Object.assign({}, res.agyStatus);
        }
        if (res.modelsInfo && Array.isArray(res.modelsInfo.families) && res.modelsInfo.families.length > 0) {
          const prevJson = JSON.stringify(uiState.families || []);
          const nextJson = JSON.stringify(res.modelsInfo.families);
          if (prevJson !== nextJson) familiesChanged = true;
          uiState.families = res.modelsInfo.families;
          window.__ag_settings_models_cache = res.modelsInfo.families;
        }
        if (flashSaved) {
          window.__ag_settings_saved_label = flashSaved === 'refreshed' ? 'refreshed' : 'saved';
          window.__ag_settings_saved_until = Date.now() + 1800;
        }
        const menuOpen = isPopoverOpen(document.getElementById('ag-settings-model-menu'));
        if (statusOnly && !flashSaved) {
          updateWorkerStatusDom();
        } else if (menuOpen) {
          // Never rebuild pane.innerHTML while the model picker dropdown is open,
          // otherwise destroying #ag-s-model-trigger immediately closes the menu.
          pendingPaneRender = true;
          updateWorkerStatusDom();
          if (familiesChanged) {
            renderModelMenuItems();
          }
        } else {
          pendingPaneRender = false;
          renderPane();
        }
        syncStatusPoller();
      }

      async function fetchSettingsState({ includeModels = false, refreshModels = false, forceReload = false, statusOnly = false } = {}) {
        if (forceReload) {
          refreshingAll = true;
          window.__ag_settings_saved_label = 'refreshed';
          window.__ag_settings_saved_until = Date.now() + 2400;
          const paneEl = document.getElementById('ag-settings-pane');
          if (paneEl) window.__ag_settings_scroll_top = paneEl.scrollTop;
          updateRefreshSpin();
        }
        if (refreshModels) {
          refreshingModels = true;
          updateRefreshSpin();
        }
        const res = await callDaemonBinding('__agGetSettingsState', { includeModels, refreshModels, forceReload });
        if (forceReload) {
          refreshingAll = false;
          updateRefreshSpin();
        }
        if (refreshModels) {
          refreshingModels = false;
          updateRefreshSpin();
        }
        if (!disposed && res) {
          applyRemoteState(res, forceReload ? 'refreshed' : false, { statusOnly });
        }
      }

      async function commitPatch(patch) {
        if (patch.modules) {
          Object.assign(uiState.config.modules, patch.modules);
          if (typeof patch.modules.sessionStatus === 'boolean' || typeof patch.modules.usageStats === 'boolean') {
            uiState.config.modules.metrics = Boolean(
              uiState.config.modules.sessionStatus !== false || uiState.config.modules.usageStats !== false
            );
          }
          if (patch.modules.promptSuggestions === false) {
            uiState.agyStatus = Object.assign({}, uiState.agyStatus, {
              running: false,
              ready: false,
              warmed: false,
              authRequired: false,
              lastError: ''
            });
          } else if (patch.modules.promptSuggestions === true && uiState.agyStatus.available) {
            uiState.agyStatus = Object.assign({}, uiState.agyStatus, {
              running: true,
              warmed: false,
              authRequired: false,
              lastError: ''
            });
          }
        }
        if (patch.telemetryLayout) uiState.config.telemetryLayout = patch.telemetryLayout;
        if (patch.telemetryCacheMode) uiState.config.telemetryCacheMode = patch.telemetryCacheMode;
        if (patch.promptSuggestionModel) {
          uiState.config.promptSuggestionModel = patch.promptSuggestionModel;
          if (uiState.config.modules.promptSuggestions && uiState.agyStatus.available) {
            uiState.agyStatus = Object.assign({}, uiState.agyStatus, {
              warmed: false,
              running: true,
              authRequired: false,
              lastError: ''
            });
          }
        }
        if (patch.openIn && typeof patch.openIn === 'object') {
          if (Array.isArray(patch.openIn.targets)) {
            uiState.config.openIn.targets = patch.openIn.targets.slice();
          }
          if (typeof patch.openIn.ideaPath === 'string') {
            uiState.config.openIn.ideaPath = patch.openIn.ideaPath;
          }
        }
        window.__ag_settings_saved_label = 'saved';
        window.__ag_settings_saved_until = Date.now() + 1800;
        const paneEl = document.getElementById('ag-settings-pane');
        if (paneEl) window.__ag_settings_scroll_top = paneEl.scrollTop;
        renderPane();
        syncStatusPoller();

        const res = await callDaemonBinding('__agUpdateSettings', { patch });
        if (!disposed && res) {
          applyRemoteState(res, true);
        }
      }

      function syncStatusPoller() {
        if (statusPollTimer) {
          clearInterval(statusPollTimer);
          statusPollTimer = null;
        }
        const terminalFailure = Boolean(
          uiState.agyStatus.available === false ||
            uiState.agyStatus.authRequired ||
            (uiState.agyStatus.lastError && !uiState.agyStatus.running)
        );
        const needPoll =
          Boolean(window.__ag_settings_tab_open) &&
          Boolean(activeDlg && activeDlg.isConnected) &&
          Boolean(uiState.config.modules.promptSuggestions) &&
          !terminalFailure &&
          !uiState.agyStatus.warmed;
        if (!needPoll) return;
        statusPollTimer = setInterval(() => {
          if (disposed || !window.__ag_settings_tab_open || !activeDlg || !activeDlg.isConnected) {
            syncStatusPoller();
            return;
          }
          if (isPopoverOpen(document.getElementById('ag-settings-model-menu'))) return;
          fetchSettingsState({ includeModels: false, refreshModels: false, statusOnly: true });
        }, 1500);
      }

      function updateRefreshSpin() {
        const icon = document.getElementById('ag-s-refresh-icon');
        if (icon) icon.classList.toggle('ag-s-spin', Boolean(refreshingModels));
        const hdrIcon = document.getElementById('ag-s-manual-refresh-icon');
        if (hdrIcon) hdrIcon.classList.toggle('ag-s-spin', Boolean(refreshingAll));
      }

      function hideModelMenus({ restoreFocus = false, fromPointer = false } = {}) {
        if (hoverSwitchTimer) {
          clearTimeout(hoverSwitchTimer);
          hoverSwitchTimer = null;
        }
        const sub = document.getElementById('ag-settings-effort-menu');
        const root = document.getElementById('ag-settings-model-menu');
        const trigger = document.getElementById('ag-s-model-trigger');
        if (sub) {
          if (SUPPORTS_POPOVER) {
            try {
              if (sub.matches(':popover-open')) sub.hidePopover();
            } catch {}
          } else {
            sub.hidden = true;
          }
        }
        if (root) {
          if (SUPPORTS_POPOVER) {
            try {
              if (root.matches(':popover-open')) root.hidePopover();
            } catch {}
          } else {
            root.hidden = true;
          }
        }
        if (trigger) {
          trigger.setAttribute('aria-expanded', 'false');
          if (restoreFocus) {
            try {
              trigger.focus({ focusVisible: !fromPointer });
            } catch {
              try { trigger.focus(); } catch {}
            }
          }
        }
        if (pendingPaneRender && !disposed) {
          pendingPaneRender = false;
          renderPane();
        }
      }

      function isPopoverOpen(el) {
        if (!el) return false;
        if (SUPPORTS_POPOVER) {
          try {
            return el.matches(':popover-open');
          } catch {
            return false;
          }
        }
        return !el.hidden;
      }

      function positionFixedOverlay(overlayEl, anchorEl, placement) {
        if (!overlayEl || !anchorEl) return;
        overlayEl.setAttribute('data-js-pos', '1');
        const ar = anchorEl.getBoundingClientRect();
        const vw = window.innerWidth || 1280;
        const vh = window.innerHeight || 800;
        const ow = overlayEl.offsetWidth || (placement === 'submenu' ? 172 : 272);
        const oh = overlayEl.offsetHeight || 220;
        let left;
        let top;
        if (placement === 'submenu') {
          const parentBox = (anchorEl.closest && anchorEl.closest('#ag-settings-model-menu')) || anchorEl;
          const pr = parentBox.getBoundingClientRect();
          left = pr.right + 6;
          if (left + ow > vw - 12) left = pr.left - ow - 6;
          if (left < 12) left = Math.max(12, vw - ow - 12);
          top = ar.top - 6;
          if (top + oh > vh - 12) top = vh - oh - 12;
          if (top < 12) top = 12;
        } else {
          left = ar.right - ow;
          if (left < 12) left = Math.max(12, ar.left);
          if (left + ow > vw - 12) left = Math.max(12, vw - ow - 12);
          top = ar.bottom + 6;
          if (top + oh > vh - 12 && ar.top - oh - 6 >= 12) {
            top = ar.top - oh - 6;
          } else if (top + oh > vh - 12) {
            top = Math.max(12, vh - oh - 12);
          }
        }
        overlayEl.style.left = Math.round(left) + 'px';
        overlayEl.style.top = Math.round(top) + 'px';
      }

      function openEffortSubmenu(fam, anchorBtn, { focusFirst = false } = {}) {
        const sub = document.getElementById('ag-settings-effort-menu');
        if (!sub) return;
        if (!fam || !Array.isArray(fam.efforts) || fam.efforts.length === 0) {
          if (isPopoverOpen(sub)) {
            if (SUPPORTS_POPOVER) {
              try { sub.hidePopover(); } catch {}
            } else {
              sub.hidden = true;
            }
          }
          return;
        }

        const listEl = sub.querySelector('.ag-s-menu-list');
        if (listEl) {
          const curId = uiState.config.promptSuggestionModel;
          listEl.innerHTML = fam.efforts
            .map((ef) => {
              const isSel = ef.id === curId;
              return (
                '<button type="button" class="ag-s-menu-row" role="menuitemradio" aria-checked="' +
                (isSel ? 'true' : 'false') +
                '" data-pick-effort="' +
                escHtml(ef.id) +
                '">' +
                '<span>' +
                escHtml(ef.label) +
                '</span>' +
                (isSel
                  ? '<svg class="ag-s-menu-row-check" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-6.5"/></svg>'
                  : '') +
                '</button>'
              );
            })
            .join('');
        }

        if (SUPPORTS_POPOVER) {
          try {
            if (!isPopoverOpen(sub)) sub.showPopover();
            positionFixedOverlay(sub, anchorBtn, 'submenu');
          } catch {}
        } else {
          sub.hidden = false;
          positionFixedOverlay(sub, anchorBtn, 'submenu');
        }

        if (focusFirst && listEl) {
          const firstBtn = listEl.querySelector('button[aria-checked="true"]') || listEl.querySelector('button');
          if (firstBtn) firstBtn.focus();
        }
      }

      function renderModelMenuItems() {
        const root = document.getElementById('ag-settings-model-menu');
        if (!root) return;
        const s = getStrings();
        const hdr = root.querySelector('.ag-s-menu-hdr');
        if (hdr) hdr.textContent = s.menuModelsHdr;

        const listEl = root.querySelector('.ag-s-menu-list');
        if (!listEl) return;
        const selInfo = findSelectedModelInfo(uiState.config.promptSuggestionModel);
        const families = uiState.families || AG_SETTINGS_FALLBACK_FAMILIES;

        listEl.innerHTML = families
          .map((fam) => {
            const isSelectedFam = selInfo.family.key === fam.key;
            const isHovered = hoveredFamilyKey === fam.key;
            const hasSub = Array.isArray(fam.efforts) && fam.efforts.length > 0;
            const displayEffort = isSelectedFam ? selInfo.effortLabel : fam.defaultEffort || '';
            const roleAttr = hasSub
              ? SUPPORTS_FOCUSGROUP
                ? ''
                : ' role="menuitem"'
              : ' role="menuitemradio" aria-checked="' + (isSelectedFam ? 'true' : 'false') + '"';

            return (
              '<button type="button" class="ag-s-menu-row"' +
              roleAttr +
              (hasSub ? ' aria-haspopup="menu" aria-expanded="' + (isHovered ? 'true' : 'false') + '"' : '') +
              ' data-fam-key="' +
              escHtml(fam.key) +
              '" data-selected="' +
              (isSelectedFam ? 'true' : 'false') +
              '" data-hovered="' +
              (isHovered ? 'true' : 'false') +
              '">' +
              '<span class="ag-s-menu-row-left">' +
              '<span class="ag-s-menu-row-name">' +
              escHtml(fam.name) +
              '</span>' +
              (displayEffort ? '<span class="ag-s-menu-row-effort">' + escHtml(displayEffort) + '</span>' : '') +
              (fam.recommended ? '<span class="ag-s-menu-badge">' + escHtml(s.recommendedBadge) + '</span>' : '') +
              '</span>' +
              '<span class="ag-s-menu-row-right" aria-hidden="true">' +
              (hasSub
                ? '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l4 4-4 4"/></svg>'
                : isSelectedFam
                ? '<svg class="ag-s-menu-row-check" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-6.5"/></svg>'
                : '') +
              '</span>' +
              '</button>'
            );
          })
          .join('');
      }

      function ensureModelPopovers() {
        const hostContainer = (activeDlg && activeDlg.isConnected ? activeDlg : document.body);
        let root = document.getElementById('ag-settings-model-menu');
        if (root) {
          if (hostContainer && root.parentNode !== hostContainer) {
            hostContainer.appendChild(root);
          }
          return root;
        }

        root = document.createElement('div');
        root.id = 'ag-settings-model-menu';
        if (SUPPORTS_POPOVER) {
          root.setAttribute('popover', 'manual');
        } else {
          root.hidden = true;
        }

        const fg = document.createElement('div');
        fg.setAttribute('focusgroup', 'menu nomemory');
        if (!SUPPORTS_FOCUSGROUP) fg.setAttribute('role', 'menu');
        fg.setAttribute('aria-labelledby', 'ag-s-model-trigger');

        const hdr = document.createElement('div');
        hdr.className = 'ag-s-menu-hdr';
        const list = document.createElement('div');
        list.className = 'ag-s-menu-list';

        const sub = document.createElement('div');
        sub.id = 'ag-settings-effort-menu';
        if (SUPPORTS_POPOVER) {
          sub.setAttribute('popover', 'manual');
        } else {
          sub.hidden = true;
        }
        const subFg = document.createElement('div');
        subFg.setAttribute('focusgroup', 'menu nomemory');
        if (!SUPPORTS_FOCUSGROUP) subFg.setAttribute('role', 'menu');
        subFg.setAttribute('aria-label', 'Thinking effort');
        subFg.innerHTML =
          '<div class="ag-s-menu-hdr">' +
          '<span>Thinking effort</span>' +
          '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">' +
          '<circle cx="8" cy="8" r="6"/><path d="M8 7v4M8 4.8h.01" stroke-linecap="round"/>' +
          '</svg>' +
          '</div>' +
          '<div class="ag-s-menu-list"></div>';
        sub.appendChild(subFg);

        fg.appendChild(hdr);
        fg.appendChild(list);
        fg.appendChild(sub);
        root.appendChild(fg);
        if (hostContainer) hostContainer.appendChild(root);

        root.addEventListener('toggle', (ev) => {
          const trigger = document.getElementById('ag-s-model-trigger');
          const open = ev.newState === 'open';
          if (trigger) trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
          if (!open && isPopoverOpen(sub)) {
            try { sub.hidePopover(); } catch {}
          }
        });

        sub.addEventListener('mouseenter', () => {
          if (hoverSwitchTimer) {
            clearTimeout(hoverSwitchTimer);
            hoverSwitchTimer = null;
          }
        });
        list.addEventListener('mouseover', (ev) => {
          const row = ev.target && ev.target.closest ? ev.target.closest('[data-fam-key]') : null;
          if (!row) return;
          const key = row.getAttribute('data-fam-key');
          if (!key) return;
          if (hoverSwitchTimer) {
            clearTimeout(hoverSwitchTimer);
            hoverSwitchTimer = null;
          }
          const applyHoverRow = () => {
            if (disposed || !isPopoverOpen(root)) return;
            if (key !== hoveredFamilyKey) {
              hoveredFamilyKey = key;
              list.querySelectorAll('[data-fam-key]').forEach((b) => {
                const isH = b.getAttribute('data-fam-key') === key;
                b.setAttribute('data-hovered', isH ? 'true' : 'false');
                if (b.hasAttribute('aria-expanded')) b.setAttribute('aria-expanded', isH ? 'true' : 'false');
              });
            }
            if (document.activeElement && document.activeElement !== row && list.contains(document.activeElement)) {
              try {
                row.focus({ focusVisible: false });
              } catch {
                try { row.focus(); } catch {}
              }
            }
            const fam = (uiState.families || AG_SETTINGS_FALLBACK_FAMILIES).find((f) => f.key === key);
            openEffortSubmenu(fam, row, { focusFirst: false });
          };
          if (key !== hoveredFamilyKey && isPopoverOpen(sub) && ev.isTrusted) {
            hoverSwitchTimer = setTimeout(() => {
              hoverSwitchTimer = null;
              applyHoverRow();
            }, 60);
          } else {
            applyHoverRow();
          }
        });

        list.addEventListener('click', (ev) => {
          const row = ev.target && ev.target.closest ? ev.target.closest('[data-fam-key]') : null;
          if (!row) return;
          const key = row.getAttribute('data-fam-key');
          const fam = (uiState.families || AG_SETTINGS_FALLBACK_FAMILIES).find((f) => f.key === key);
          if (!fam) return;
          if (fam.singleId) {
            hideModelMenus({ restoreFocus: true, fromPointer: ev.detail !== 0 });
            commitPatch({ promptSuggestionModel: fam.singleId });
          } else {
            hoveredFamilyKey = key;
            openEffortSubmenu(fam, row, { focusFirst: ev.detail === 0 });
          }
        });

        sub.addEventListener('click', (ev) => {
          const btn = ev.target && ev.target.closest ? ev.target.closest('[data-pick-effort]') : null;
          if (!btn) return;
          const id = btn.getAttribute('data-pick-effort');
          if (!id) return;
          hideModelMenus({ restoreFocus: true, fromPointer: ev.detail !== 0 });
          commitPatch({ promptSuggestionModel: id });
        });

        const handleMenuKeydown = (menuEl, isSub) => (ev) => {
          const items = Array.from(menuEl.querySelectorAll('.ag-s-menu-list > button'));
          if (items.length === 0) return;
          const idx = items.indexOf(document.activeElement);
          if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp' || ev.key === 'Home' || ev.key === 'End') {
            ev.preventDefault();
            ev.stopPropagation();
            const nextIdx =
              ev.key === 'Home'
                ? 0
                : ev.key === 'End'
                ? items.length - 1
                : idx < 0
                ? 0
                : (idx + (ev.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
            const nextBtn = items[nextIdx];
            nextBtn.focus();
            if (!isSub) {
              const key = nextBtn.getAttribute('data-fam-key');
              hoveredFamilyKey = key || '';
              const fam = (uiState.families || AG_SETTINGS_FALLBACK_FAMILIES).find((f) => f.key === key);
              openEffortSubmenu(fam, nextBtn, { focusFirst: false });
            }
          } else if (!isSub && ev.key === 'ArrowRight' && idx >= 0) {
            const key = items[idx].getAttribute('data-fam-key');
            const fam = (uiState.families || AG_SETTINGS_FALLBACK_FAMILIES).find((f) => f.key === key);
            if (fam && fam.efforts && fam.efforts.length > 0) {
              ev.preventDefault();
              ev.stopPropagation();
              openEffortSubmenu(fam, items[idx], { focusFirst: true });
            }
          } else if (isSub && (ev.key === 'ArrowLeft' || ev.key === 'Escape')) {
            ev.preventDefault();
            ev.stopPropagation();
            if (SUPPORTS_POPOVER) {
              try { sub.hidePopover(); } catch {}
            } else {
              sub.hidden = true;
            }
            const parentRow = list.querySelector('[data-fam-key="' + hoveredFamilyKey + '"]');
            if (parentRow) parentRow.focus();
          } else if (!isSub && ev.key === 'Escape') {
            ev.preventDefault();
            ev.stopPropagation();
            hideModelMenus({ restoreFocus: true, fromPointer: false });
          } else if (ev.key === 'Tab') {
            hideModelMenus({ restoreFocus: false });
          }
        };

        list.addEventListener('keydown', handleMenuKeydown(root, false));
        sub.addEventListener('keydown', handleMenuKeydown(sub, true));

        return root;
      }

      function toggleModelMenu(triggerBtn, fromKeyboard) {
        const root = ensureModelPopovers();
        if (isPopoverOpen(root)) {
          hideModelMenus({ restoreFocus: fromKeyboard, fromPointer: !fromKeyboard });
          return;
        }
        const selInfo = findSelectedModelInfo(uiState.config.promptSuggestionModel);
        hoveredFamilyKey = selInfo.family.key || (uiState.families[0] && uiState.families[0].key) || '';
        renderModelMenuItems();

        if (SUPPORTS_POPOVER) {
          try {
            root.showPopover();
            positionFixedOverlay(root, triggerBtn, 'root');
          } catch {}
        } else {
          root.hidden = false;
          positionFixedOverlay(root, triggerBtn, 'root');
        }
        triggerBtn.setAttribute('aria-expanded', 'true');

        const selectedRow = root.querySelector('[data-fam-key="' + hoveredFamilyKey + '"]');
        const selectedFam = (uiState.families || AG_SETTINGS_FALLBACK_FAMILIES).find((f) => f.key === hoveredFamilyKey);
        if (selectedRow && selectedFam && selectedFam.efforts && selectedFam.efforts.length > 0) {
          openEffortSubmenu(selectedFam, selectedRow, { focusFirst: false });
        }
        if (fromKeyboard) {
          const focusTarget = selectedRow || root.querySelector('.ag-s-menu-list > button');
          if (focusTarget) focusTarget.focus();
        }
      }

      function renderOpenInSubrow(s, openInCfg) {
        const enabledSet = new Set(Array.isArray(openInCfg.targets) ? openInCfg.targets : []);
        const detectors = uiState.openInDetectors || {};
        const chipsHtml = AG_OPEN_IN_TARGET_META.map((item) => {
          const on = enabledSet.has(item.id);
          const det = detectors[item.id];
          const ok = item.id === 'finder' ? true : Boolean(det && det.available);
          const titleAttr = det && det.path ? ' title="' + escHtml(det.path) + '"' : '';
          return (
            '<button type="button" class="ag-s-target-chip" data-openin-target="' +
            escHtml(item.id) +
            '" aria-pressed="' +
            (on ? 'true' : 'false') +
            '"' +
            titleAttr +
            '>' +
            '<span class="ag-s-target-dot" data-ok="' +
            (ok ? '1' : '0') +
            '"></span>' +
            '<span>' +
            escHtml(item.name) +
            '</span>' +
            '</button>'
          );
        }).join('');

        let ideaHtml = '';
        if (enabledSet.has('idea')) {
          const ideaDet = detectors.idea || null;
          const customPath = String(openInCfg.ideaPath || '').trim();
          const detectedPath = ideaDet && ideaDet.path ? String(ideaDet.path) : '';
          const missing = Boolean(ideaDet && !ideaDet.available && !customPath);
          const statusText = customPath
            ? s.ideaPathCustomPrefix + customPath
            : detectedPath
            ? s.ideaPathAutoPrefix + detectedPath
            : s.ideaPathMissing;

          ideaHtml =
            '<div class="ag-s-idea-bar">' +
            '<span class="ag-s-idea-status ag-s-mono" data-missing="' +
            (missing ? '1' : '0') +
            '" title="' +
            escHtml(statusText) +
            '">' +
            escHtml(statusText) +
            '</span>' +
            '<button type="button" id="ag-s-toggle-idea-path" class="ag-s-link-btn">' +
            escHtml(editingIdeaPath ? s.ideaPathHideBtn : s.ideaPathCustomBtn) +
            '</button>' +
            '</div>' +
            (editingIdeaPath
              ? '<div class="ag-s-idea-form">' +
                '<input type="text" id="ag-s-idea-input" class="ag-s-idea-input" value="' +
                escHtml(customPath) +
                '" placeholder="' +
                escHtml(s.ideaPathPlaceholder) +
                '" data-invalid="' +
                (invalidIdeaPath ? '1' : '0') +
                '" autocomplete="off" spellcheck="false" />' +
                '<button type="button" id="ag-s-idea-save" class="ag-s-btn-primary">' +
                escHtml(s.ideaPathSave) +
                '</button>' +
                (customPath
                  ? '<button type="button" id="ag-s-idea-reset" class="ag-s-btn-secondary">' +
                    escHtml(s.ideaPathReset) +
                    '</button>'
                  : '') +
                '</div>'
              : '');
        }

        const customNoteHtml =
          openInCfg.customTargetsCount > 0
            ? '<div class="ag-s-sub-desc">' + escHtml(s.openInCustomNote(openInCfg.customTargetsCount)) + '</div>'
            : '';

        return (
          '<div class="ag-s-openin-line">' +
          '<span class="ag-s-sub-label">' +
          escHtml(s.openInTargetsLbl) +
          '</span>' +
          '<div class="ag-s-openin-chips">' +
          chipsHtml +
          '</div>' +
          '</div>' +
          ideaHtml +
          customNoteHtml
        );
      }

      function renderPane() {
        const navBtn = document.getElementById('ag-settings-nav-btn');
        const s = getStrings();
        if (navBtn) {
          const lbl = navBtn.querySelector('.ag-s-nav-label');
          if (lbl) lbl.textContent = s.navTitle;
          const ver = navBtn.querySelector('.ag-s-nav-ver');
          if (ver) ver.textContent = getShortVersionTag();
        }

        const pane = document.getElementById('ag-settings-pane');
        if (!pane) return;

        const cfg = uiState.config;
        const mods = cfg.modules || {};
        const legacyMetricsOn = mods.metrics !== false;
        const sessionStatusOn = typeof mods.sessionStatus === 'boolean' ? mods.sessionStatus : legacyMetricsOn;
        const usageStatsOn = typeof mods.usageStats === 'boolean' ? mods.usageStats : legacyMetricsOn;
        const anyStatusBarOn = Boolean(sessionStatusOn || usageStatsOn);
        const openInOn = mods.openIn !== false;
        const psOn = Boolean(mods.promptSuggestions);
        const selInfo = findSelectedModelInfo(cfg.promptSuggestionModel);
        const savedActive = Boolean(window.__ag_settings_saved_until && Date.now() < window.__ag_settings_saved_until);

        const workerView = getWorkerStatusView(s);
        const workerStatus = workerView.status;
        const workerLabel = workerView.label;

        const prevScroll = pane.scrollTop || window.__ag_settings_scroll_top || 0;
        const savedLabel = window.__ag_settings_saved_label === 'refreshed' ? s.refreshedBadge : s.savedBadge;

        pane.innerHTML =
          '<div class="ag-s-header">' +
          '<div class="ag-s-title-row">' +
          '<div class="ag-s-title-left">' +
          '<h2 class="ag-s-title">' +
          escHtml(s.pageTitle) +
          '</h2>' +
          '<span class="ag-s-ver-badge">' +
          escHtml(getShortVersionTag()) +
          '</span>' +
          '<button type="button" id="ag-s-manual-refresh" class="ag-s-hdr-refresh" aria-label="' +
          escHtml(s.manualRefreshLabel) +
          '">' +
          '<svg id="ag-s-manual-refresh-icon" class="' +
          (refreshingAll ? 'ag-s-spin' : '') +
          '" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.5 8a5.5 5.5 0 1 1-1.4-3.67M13.5 2.5v2.8h-2.8"/></svg>' +
          '</button>' +
          '<span id="ag-s-hot-badge" class="ag-s-hot-badge"' +
          (savedActive ? '' : ' hidden') +
          '>' +
          escHtml(savedLabel) +
          '</span>' +
          '</div>' +
          '</div>' +
          '<p class="ag-s-subtitle">' +
          escHtml(s.subtitlePrefix) +
          '<span class="ag-s-mono">user/config.json</span>' +
          escHtml(s.subtitleSuffix) +
          '</p>' +
          '</div>' +
          '<div class="ag-s-sections">' +
          // Standalone Row: Chinese UI Localization
          '<div class="ag-s-card">' +
          '<div class="ag-s-row"><div class="ag-s-row-main">' +
          '<div class="ag-s-row-info"><label class="ag-s-row-label" for="ag-s-sw-i18n">' +
          escHtml(s.modI18n) +
          '</label><div class="ag-s-row-desc">' +
          escHtml(s.modI18nDesc) +
          '</div></div>' +
          '<input id="ag-s-sw-i18n" type="checkbox" switch role="switch" class="ag-s-switch" data-bind-mod="i18n" aria-label="' +
          escHtml(s.modI18n) +
          '" ' +
          (mods.i18n !== false ? 'checked' : '') +
          ' />' +
          '</div></div>' +
          '</div>' +
          // Section 1: Status Bar (Live Session Status + Usage Stats + Density + Cache Scope)
          '<div>' +
          '<div class="ag-s-section-head"><span class="ag-s-section-title">' +
          escHtml(s.secStatusBar) +
          '</span></div>' +
          '<div class="ag-s-card">' +
          '<div class="ag-s-row"><div class="ag-s-row-main">' +
          '<div class="ag-s-row-info"><label class="ag-s-row-label" for="ag-s-sw-session-status">' +
          escHtml(s.modSessionStatus) +
          '</label><div class="ag-s-row-desc">' +
          escHtml(s.modSessionStatusDesc) +
          '</div></div>' +
          '<input id="ag-s-sw-session-status" type="checkbox" switch role="switch" class="ag-s-switch" data-bind-mod="sessionStatus" aria-label="' +
          escHtml(s.modSessionStatus) +
          '" ' +
          (sessionStatusOn ? 'checked' : '') +
          ' />' +
          '</div></div>' +
          '<div class="ag-s-row"><div class="ag-s-row-main">' +
          '<div class="ag-s-row-info"><label class="ag-s-row-label" for="ag-s-sw-usage-stats">' +
          escHtml(s.modUsageStats) +
          '</label><div class="ag-s-row-desc">' +
          escHtml(s.modUsageStatsDesc) +
          '</div></div>' +
          '<input id="ag-s-sw-usage-stats" type="checkbox" switch role="switch" class="ag-s-switch" data-bind-mod="usageStats" aria-label="' +
          escHtml(s.modUsageStats) +
          '" ' +
          (usageStatsOn ? 'checked' : '') +
          ' />' +
          '</div></div>' +
          '<div class="ag-s-row"' +
          (anyStatusBarOn ? '' : ' hidden') +
          '><div class="ag-s-row-main">' +
          '<div class="ag-s-row-info"><div class="ag-s-row-label">' +
          escHtml(s.layoutLbl) +
          '</div><div class="ag-s-row-desc">' +
          escHtml(s.layoutDesc) +
          '</div></div>' +
          '<div class="ag-s-seg" role="group" aria-label="' +
          escHtml(s.layoutLbl) +
          '">' +
          '<button type="button" class="ag-s-seg-btn" data-seg="telemetryLayout" data-val="compact" aria-pressed="' +
          (cfg.telemetryLayout !== 'detailed' ? 'true' : 'false') +
          '">' +
          escHtml(s.layoutCompact) +
          '</button>' +
          '<button type="button" class="ag-s-seg-btn" data-seg="telemetryLayout" data-val="detailed" aria-pressed="' +
          (cfg.telemetryLayout === 'detailed' ? 'true' : 'false') +
          '">' +
          escHtml(s.layoutDetailed) +
          '</button>' +
          '</div>' +
          '</div></div>' +
          '<div class="ag-s-row"' +
          (usageStatsOn ? '' : ' hidden') +
          '><div class="ag-s-row-main">' +
          '<div class="ag-s-row-info"><div class="ag-s-row-label">' +
          escHtml(s.cacheLbl) +
          '</div><div class="ag-s-row-desc">' +
          escHtml(s.cacheDesc) +
          '</div></div>' +
          '<div class="ag-s-seg" role="group" aria-label="' +
          escHtml(s.cacheLbl) +
          '">' +
          '<button type="button" class="ag-s-seg-btn" data-seg="telemetryCacheMode" data-val="session" aria-pressed="' +
          (cfg.telemetryCacheMode !== 'step' ? 'true' : 'false') +
          '">' +
          escHtml(s.cacheSession) +
          '</button>' +
          '<button type="button" class="ag-s-seg-btn" data-seg="telemetryCacheMode" data-val="step" aria-pressed="' +
          (cfg.telemetryCacheMode === 'step' ? 'true' : 'false') +
          '">' +
          escHtml(s.cacheStep) +
          '</button>' +
          '</div>' +
          '</div></div>' +
          '</div>' +
          '</div>' +
          // Section 2: Context Menu (Open In + Targets)
          '<div>' +
          '<div class="ag-s-section-head"><span class="ag-s-section-title">' +
          escHtml(s.secContextMenu) +
          '</span></div>' +
          '<div class="ag-s-card">' +
          '<div class="ag-s-row">' +
          '<div class="ag-s-row-main">' +
          '<div class="ag-s-row-info"><label class="ag-s-row-label" for="ag-s-sw-openin">' +
          escHtml(s.modOpenIn) +
          '</label><div class="ag-s-row-desc">' +
          escHtml(s.modOpenInDesc) +
          '</div></div>' +
          '<input id="ag-s-sw-openin" type="checkbox" switch role="switch" class="ag-s-switch" data-bind-mod="openIn" aria-label="' +
          escHtml(s.modOpenIn) +
          '" ' +
          (openInOn ? 'checked' : '') +
          ' />' +
          '</div>' +
          '<div class="ag-s-subrow ag-s-subrow-stack"' +
          (openInOn ? '' : ' hidden') +
          '>' +
          renderOpenInSubrow(s, cfg.openIn) +
          '</div>' +
          '</div>' +
          '</div>' +
          '</div>' +
          // Section 3: Next Prompt (Prompt Suggestions + Model Picker)
          '<div>' +
          '<div class="ag-s-section-head">' +
          '<span class="ag-s-section-title">' +
          escHtml(s.secNextPrompt) +
          '</span>' +
          '<span class="ag-s-section-hint">' +
          escHtml(s.secNextPromptHint) +
          '</span>' +
          '</div>' +
          '<div class="ag-s-card">' +
          '<div class="ag-s-row">' +
          '<div class="ag-s-row-main">' +
          '<div class="ag-s-row-info">' +
          '<div class="ag-s-row-label-wrap">' +
          '<label class="ag-s-row-label" for="ag-s-sw-suggest">' +
          escHtml(s.modSuggest) +
          '</label>' +
          '<span id="ag-s-worker-pill" class="ag-s-worker-pill" data-status="' +
          workerStatus +
          '">' +
          '<span class="ag-s-worker-dot"></span>' +
          '<span class="ag-s-worker-label">' +
          escHtml(workerLabel) +
          '</span>' +
          '</span>' +
          '</div>' +
          '<div class="ag-s-row-desc">' +
          escHtml(s.modSuggestDescPre) +
          '<span class="ag-s-mono">Tab</span>' +
          escHtml(s.modSuggestDescMid) +
          '<span class="ag-s-mono">→</span>' +
          escHtml(s.modSuggestDescPost) +
          '<span class="ag-s-mono">agy</span>' +
          escHtml(s.modSuggestDescEnd) +
          '</div>' +
          '<div id="ag-s-worker-hint" class="ag-s-worker-hint" data-tone="' +
          escHtml(workerView.hintTone || 'warn') +
          '"' +
          (workerView.hint ? '' : ' hidden') +
          '>' +
          escHtml(workerView.hint) +
          '</div>' +
          '</div>' +
          '<input id="ag-s-sw-suggest" type="checkbox" switch role="switch" class="ag-s-switch" data-bind-mod="promptSuggestions" aria-label="' +
          escHtml(s.modSuggest) +
          '" ' +
          (psOn ? 'checked' : '') +
          ' />' +
          '</div>' +
          '<div class="ag-s-subrow"' +
          (psOn ? '' : ' hidden') +
          '>' +
          '<div>' +
          '<div class="ag-s-sub-label">' +
          escHtml(s.suggestModelLbl) +
          '</div>' +
          '<div class="ag-s-sub-desc">' +
          escHtml(s.suggestModelDescPre) +
          '<span class="ag-s-mono">agy models</span>' +
          escHtml(s.suggestModelDescPost) +
          '</div>' +
          '</div>' +
          '<div class="ag-s-picker-controls">' +
          '<button type="button" id="ag-s-model-trigger" class="ag-s-pill-trigger" aria-haspopup="menu" aria-expanded="false">' +
          '<span class="ag-s-trigger-text">' +
          '<span>' +
          escHtml(selInfo.family.name) +
          '</span>' +
          (selInfo.effortLabel ? '<span class="ag-s-trigger-effort">' + escHtml(selInfo.effortLabel) + '</span>' : '') +
          '</span>' +
          '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="opacity:0.6;flex-shrink:0"><path d="M4 6l4 4 4-4"/></svg>' +
          '</button>' +
          '<button type="button" id="ag-s-refresh-models" class="ag-s-icon-btn" aria-label="' +
          escHtml(s.refreshModelsTitle) +
          '">' +
          '<svg id="ag-s-refresh-icon" class="' +
          (refreshingModels ? 'ag-s-spin' : '') +
          '" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 8a5.5 5.5 0 1 1-1.4-3.67M13.5 2.5v2.8h-2.8"/></svg>' +
          '</button>' +
          '</div>' +
          '</div>' +
          '</div>' +
          '</div>' +
          '</div>' +
          '</div>';

        if (prevScroll > 0) pane.scrollTop = prevScroll;

        if (editingIdeaPath) {
          const inp = document.getElementById('ag-s-idea-input');
          if (inp) {
            inp.addEventListener('keydown', (ev) => {
              if (ev.key === 'Enter') {
                ev.preventDefault();
                submitIdeaPath(inp.value);
              } else if (ev.key === 'Escape') {
                ev.preventDefault();
                ev.stopPropagation();
                editingIdeaPath = false;
                invalidIdeaPath = false;
                renderPane();
              }
            });
          }
        }

        if (savedActive) {
          if (saveBadgeTimer) clearTimeout(saveBadgeTimer);
          const remain = Math.max(100, window.__ag_settings_saved_until - Date.now());
          saveBadgeTimer = setTimeout(() => {
            const b = document.getElementById('ag-s-hot-badge');
            if (b) b.hidden = true;
          }, remain);
        }

        if (isPopoverOpen(document.getElementById('ag-settings-model-menu'))) {
          renderModelMenuItems();
        }
      }

      function submitIdeaPath(rawVal) {
        const val = String(rawVal || '').trim();
        if (val && (!val.startsWith('/') || val.startsWith('//') || /[\0\r\n]/.test(val))) {
          invalidIdeaPath = true;
          const inp = document.getElementById('ag-s-idea-input');
          if (inp) {
            inp.setAttribute('data-invalid', '1');
            inp.focus();
          }
          return;
        }
        invalidIdeaPath = false;
        editingIdeaPath = false;
        commitPatch({ openIn: { ideaPath: val } });
      }

      function setEnhancerTabOpen(open) {
        window.__ag_settings_tab_open = Boolean(open);
        if (activeDlg) {
          if (open) {
            activeDlg.setAttribute('data-ag-enhancer-settings-open', '1');
          } else {
            activeDlg.removeAttribute('data-ag-enhancer-settings-open');
          }
        }
        if (open) {
          renderPane();
          fetchSettingsState({
            includeModels: !window.__ag_settings_models_cache,
            refreshModels: false
          });
          syncStatusPoller();
        } else {
          hideModelMenus({ restoreFocus: false });
          syncStatusPoller();
        }
      }

      function bindPaneEvents(pane) {
        pane.addEventListener('change', (ev) => {
          const sw = ev.target && ev.target.closest ? ev.target.closest('input.ag-s-switch[data-bind-mod]') : null;
          if (!sw) return;
          const mod = sw.getAttribute('data-bind-mod');
          if (!mod) return;
          const checked = Boolean(sw.checked);
          if (mod === 'promptSuggestions' && !checked) {
            hideModelMenus({ restoreFocus: false });
          }
          commitPatch({ modules: { [mod]: checked } });
        });

        pane.addEventListener('click', (ev) => {
          const manualRef = ev.target && ev.target.closest ? ev.target.closest('#ag-s-manual-refresh') : null;
          if (manualRef) {
            ev.preventDefault();
            ev.stopPropagation();
            fetchSettingsState({ includeModels: true, refreshModels: true, forceReload: true });
            return;
          }

          const targetChip = ev.target && ev.target.closest ? ev.target.closest('[data-openin-target]') : null;
          if (targetChip) {
            ev.preventDefault();
            ev.stopPropagation();
            const id = targetChip.getAttribute('data-openin-target');
            if (!id) return;
            const cur = Array.isArray(uiState.config.openIn.targets) ? uiState.config.openIn.targets.slice() : [];
            const idx = cur.indexOf(id);
            if (idx >= 0) {
              cur.splice(idx, 1);
            } else {
              // Keep canonical display order
              const order = AG_OPEN_IN_TARGET_META.map((m) => m.id);
              cur.push(id);
              cur.sort((a, b) => order.indexOf(a) - order.indexOf(b));
            }
            commitPatch({ openIn: { targets: cur } });
            return;
          }

          if (ev.target && ev.target.closest && ev.target.closest('#ag-s-toggle-idea-path')) {
            editingIdeaPath = !editingIdeaPath;
            invalidIdeaPath = false;
            renderPane();
            if (editingIdeaPath) {
              const inp = document.getElementById('ag-s-idea-input');
              if (inp) inp.focus();
            }
            return;
          }

          if (ev.target && ev.target.closest && ev.target.closest('#ag-s-idea-save')) {
            const inp = document.getElementById('ag-s-idea-input');
            submitIdeaPath(inp ? inp.value : '');
            return;
          }

          if (ev.target && ev.target.closest && ev.target.closest('#ag-s-idea-reset')) {
            submitIdeaPath('');
            return;
          }

          const trigger = ev.target && ev.target.closest ? ev.target.closest('#ag-s-model-trigger') : null;
          if (trigger) {
            ev.preventDefault();
            ev.stopPropagation();
            toggleModelMenu(trigger, ev.detail === 0);
            return;
          }

          const refBtn = ev.target && ev.target.closest ? ev.target.closest('#ag-s-refresh-models') : null;
          if (refBtn) {
            ev.preventDefault();
            ev.stopPropagation();
            fetchSettingsState({ includeModels: true, refreshModels: true });
            return;
          }

          const seg = ev.target && ev.target.closest ? ev.target.closest('.ag-s-seg-btn[data-seg]') : null;
          if (seg) {
            const field = seg.getAttribute('data-seg');
            const val = seg.getAttribute('data-val');
            if (field && val && uiState.config[field] !== val) {
              commitPatch({ [field]: val });
            }
          }
        });

        pane.addEventListener('keydown', (ev) => {
          const trigger = ev.target && ev.target.closest ? ev.target.closest('#ag-s-model-trigger') : null;
          if (trigger && ev.key === 'ArrowDown') {
            ev.preventDefault();
            ev.stopPropagation();
            const root = ensureModelPopovers();
            if (!isPopoverOpen(root)) {
              toggleModelMenu(trigger, true);
            } else {
              const first = root.querySelector('.ag-s-menu-list > button');
              if (first) first.focus();
            }
          }
        });
      }

      function tryMountInSettingsModal() {
        if (disposed) return;
        const sidebar = document.querySelector('[data-testid="settings-sidebar"]');
        const dlg = sidebar ? sidebar.closest('.settings-modal-container') || sidebar.closest('[role="dialog"]') : null;

        if (!dlg || !sidebar) {
          if (activeDlg) {
            activeDlg = null;
            if (activeSidebar && boundSidebarClick) {
              try { activeSidebar.removeEventListener('click', boundSidebarClick, true); } catch {}
            }
            activeSidebar = null;
            boundSidebarClick = null;
            window.__ag_settings_tab_open = false;
            window.__ag_settings_scroll_top = 0;
            hideModelMenus({ restoreFocus: false });
            syncStatusPoller();
          }
          return;
        }

        const listRoot = sidebar.firstElementChild;
        const firstNavGroup =
          listRoot &&
          (Array.from(listRoot.children).find((el) => el.querySelector && el.querySelector('[data-testid^="settings-nav-item-"]')) ||
            listRoot.children[1]);
        const splitRow = sidebar.closest('.relative.flex.w-full.h-full') || dlg.querySelector('.relative.flex.w-full.h-full');
        const rightPane = splitRow && splitRow.children && splitRow.children[1];
        if (!firstNavGroup || !rightPane) return;

        let justMounted = activeDlg !== dlg;
        activeDlg = dlg;
        rightPane.setAttribute('data-ag-settings-right-pane', '1');

        if (activeSidebar !== sidebar) {
          if (activeSidebar && boundSidebarClick) {
            try { activeSidebar.removeEventListener('click', boundSidebarClick, true); } catch {}
          }
          activeSidebar = sidebar;
          boundSidebarClick = (ev) => {
            const btn = ev.target && ev.target.closest ? ev.target.closest('button') : null;
            if (btn && btn.id !== 'ag-settings-nav-btn' && window.__ag_settings_tab_open) {
              setEnhancerTabOpen(false);
            }
          };
          sidebar.addEventListener('click', boundSidebarClick, true);
        }

        let divider = document.getElementById('ag-settings-nav-divider');
        if (!divider) {
          divider = document.createElement('div');
          divider.id = 'ag-settings-nav-divider';
        }
        if (divider.parentElement !== firstNavGroup) {
          firstNavGroup.appendChild(divider);
          justMounted = true;
        }

        let navWrap = document.getElementById('ag-settings-nav-wrap');
        if (!navWrap) {
          navWrap = document.createElement('div');
          navWrap.id = 'ag-settings-nav-wrap';
          navWrap.className = 'relative group/nav-item';
          const btn = document.createElement('button');
          btn.id = 'ag-settings-nav-btn';
          btn.type = 'button';
          btn.setAttribute('data-testid', 'settings-nav-item-Enhancer');
          btn.innerHTML =
            '<span class="ag-s-nav-left">' +
            '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.85;flex-shrink:0" aria-hidden="true">' +
            '<path d="M8 2.2l1.6 3.5 3.7.5-2.7 2.6.7 3.7L8 10.7l-3.3 1.8.7-3.7-2.7-2.6 3.7-.5L8 2.2Z"></path>' +
            '</svg>' +
            '<span class="ag-s-nav-label"></span>' +
            '</span>' +
            '<span class="ag-s-nav-ver"></span>';
          btn.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            setEnhancerTabOpen(true);
          });
          navWrap.appendChild(btn);
          justMounted = true;
        }
        if (navWrap.parentElement !== firstNavGroup) {
          firstNavGroup.appendChild(navWrap);
          justMounted = true;
        }

        let pane = document.getElementById('ag-settings-pane');
        if (!pane) {
          pane = document.createElement('div');
          pane.id = 'ag-settings-pane';
          bindPaneEvents(pane);
          justMounted = true;
        }
        if (pane.parentElement !== rightPane) {
          rightPane.appendChild(pane);
          justMounted = true;
        }

        if (justMounted) {
          renderPane();
          if (window.__ag_settings_tab_open) {
            activeDlg.setAttribute('data-ag-enhancer-settings-open', '1');
            fetchSettingsState({
              includeModels: !window.__ag_settings_models_cache,
              refreshModels: false
            });
            syncStatusPoller();
          }
        }
      }

      function scheduleScan(delayMs) {
        if (disposed || scanTimer) return;
        scanTimer = setTimeout(() => {
          scanTimer = null;
          tryMountInSettingsModal();
        }, delayMs);
      }

      const onDocMouseDown = (ev) => {
        if (disposed) return;
        const root = document.getElementById('ag-settings-model-menu');
        if (
          isPopoverOpen(root) &&
          ev.target &&
          ev.target.closest &&
          !ev.target.closest('#ag-settings-model-menu') &&
          !ev.target.closest('#ag-settings-effort-menu') &&
          !ev.target.closest('#ag-s-model-trigger')
        ) {
          hideModelMenus({ restoreFocus: false });
        }
      };

      const onDocKeyDown = (ev) => {
        if (disposed || ev.key !== 'Escape') return;
        const root = document.getElementById('ag-settings-model-menu');
        if (!isPopoverOpen(root)) return;
        const sub = document.getElementById('ag-settings-effort-menu');
        if (isPopoverOpen(sub) && ev.target && ev.target.closest && ev.target.closest('#ag-settings-effort-menu')) {
          ev.preventDefault();
          ev.stopPropagation();
          if (SUPPORTS_POPOVER) {
            try { sub.hidePopover(); } catch {}
          } else {
            sub.hidden = true;
          }
          const parentRow = root.querySelector('[data-fam-key="' + hoveredFamilyKey + '"]');
          if (parentRow) parentRow.focus();
          return;
        }
        ev.preventDefault();
        ev.stopPropagation();
        hideModelMenus({ restoreFocus: true, fromPointer: false });
      };

      const onDocClick = (ev) => {
        if (disposed) return;
        if (ev.target && ev.target.closest && ev.target.closest('[data-testid="settings-button"]')) {
          scheduleScan(40);
          setTimeout(() => { if (!disposed) tryMountInSettingsModal(); }, 160);
        }
      };

      const observer =
        typeof MutationObserver !== 'undefined'
          ? new MutationObserver(() => {
              if (activeDlg) {
                const navOk = document.getElementById('ag-settings-nav-wrap');
                const paneOk = document.getElementById('ag-settings-pane');
                if (!activeDlg.isConnected || !navOk || !navOk.isConnected || !paneOk || !paneOk.isConnected) {
                  scheduleScan(60);
                }
                return;
              }
              if (
                window.location.search.includes('settingsOpen=true') ||
                document.querySelector('[data-testid="settings-sidebar"]')
              ) {
                scheduleScan(80);
              }
            })
          : null;
      if (observer && document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
      }
      document.addEventListener('mousedown', onDocMouseDown, true);
      document.addEventListener('keydown', onDocKeyDown, true);
      document.addEventListener('click', onDocClick, true);

      tryMountInSettingsModal();

      if (Array.isArray(window.__ag_cleanup_fns)) {
        window.__ag_cleanup_fns.push(() => {
          disposed = true;
          if (scanTimer) clearTimeout(scanTimer);
          if (statusPollTimer) clearInterval(statusPollTimer);
          if (saveBadgeTimer) clearTimeout(saveBadgeTimer);
          if (hoverSwitchTimer) clearTimeout(hoverSwitchTimer);
          if (observer) observer.disconnect();
          document.removeEventListener('mousedown', onDocMouseDown, true);
          document.removeEventListener('keydown', onDocKeyDown, true);
          document.removeEventListener('click', onDocClick, true);
          if (activeSidebar && boundSidebarClick) {
            try { activeSidebar.removeEventListener('click', boundSidebarClick, true); } catch {}
          }
          hideModelMenus({ restoreFocus: false });
          [
            document.getElementById('ag-settings-model-menu'),
            document.getElementById('ag-settings-effort-menu')
          ].forEach((el) => { if (el) el.remove(); });
          cleanupEnhancerSettingsDom();
          try { delete window.__ag_on_settings_state; } catch { window.__ag_on_settings_state = null; }
        });
      }
    })();
  }
