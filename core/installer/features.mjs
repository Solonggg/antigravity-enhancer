/**
 * core/installer/features.mjs — Selective Feature Profiles & Sparse Checkout Paths
 */

export const BASE_SPARSE_PATHS = Object.freeze([
  '/install.mjs',
  '/package.json',
  '/SKILL.md',
  '/LICENSE',
  '/user/config.json',
  '/user/custom.css',
  '/user/custom.js',
  '/core/daemon.mjs',
  '/core/shared.mjs',
  '/core/manifest.json',
  '/core/installer',
  '/core/daemon/paths.mjs',
  '/core/daemon/cdp-bridge.mjs',
  '/core/daemon/cdp-relaunch.mjs',
  '/core/styles/45-settings-ui.css',
  '/core/runtime/00-head.js',
  '/core/runtime/75-settings-ui.js',
  '/core/runtime/90-tail.js'
]);

export const FEATURE_GROUPS = Object.freeze({
  i18n: {
    id: 'i18n',
    label: '中文界面本地化（含 Shadow DOM 穿透与动态文案）',
    configKeys: ['i18n'],
    sparsePaths: [
      '/core/i18n.json',
      '/core/runtime/60-i18n-engine.js',
      '/user/i18n.override.json'
    ],
    coreRelPaths: [
      'i18n.json',
      'runtime/60-i18n-engine.js'
    ],
    aliases: ['i18n', 'zh', 'cn', 'chinese', 'locale', 'l10n', 'translate']
  },
  metrics: {
    id: 'metrics',
    label: '纯本地实时会话状态指示、一/二级用量面板与每轮尾部统计',
    configKeys: ['metrics'],
    sparsePaths: [
      '/core/styles/30-telemetry.css',
      '/core/runtime/30-antigravity-probe.js',
      '/core/runtime/40-status-machine.js',
      '/core/runtime/50-telemetry-ui.js',
      '/core/daemon/ls-log.mjs',
      '/core/daemon/protobuf.mjs',
      '/core/daemon/sqlite-metrics.mjs',
      '/core/daemon/telemetry-renderer.mjs'
    ],
    coreRelPaths: [
      'styles/30-telemetry.css',
      'runtime/30-antigravity-probe.js',
      'runtime/40-status-machine.js',
      'runtime/50-telemetry-ui.js',
      'daemon/ls-log.mjs',
      'daemon/protobuf.mjs',
      'daemon/sqlite-metrics.mjs',
      'daemon/telemetry-renderer.mjs'
    ],
    aliases: ['metrics', 'status', 'stats', 'panel', 'metricscapsule']
  },
  openIn: {
    id: 'openIn',
    label: '右键打开文件引用（IDEA / Finder / Zed / VS Code / Cursor）',
    configKeys: ['openIn'],
    sparsePaths: [
      '/core/styles/42-open-in.css',
      '/core/runtime/65-open-in.js',
      '/core/daemon/open-in.mjs'
    ],
    coreRelPaths: [
      'styles/42-open-in.css',
      'runtime/65-open-in.js',
      'daemon/open-in.mjs'
    ],
    aliases: ['openin', 'open-in', 'open', 'contextmenu', 'rightclick', 'idea', 'finder']
  },
  fixes: {
    id: 'fixes',
    label: '设置死锁修复与 Cmd/Ctrl + -/=/0 界面缩放快捷键',
    configKeys: ['deadlockHealer', 'zoomShortcuts'],
    sparsePaths: ['/core/runtime/10-guards.js'],
    coreRelPaths: ['runtime/10-guards.js'],
    aliases: ['fixes', 'fix', 'guards', 'deadlock', 'deadlockhealer', 'zoom', 'zoomshortcuts']
  },
  suggest: {
    id: 'suggest',
    label: '输入框下一句预测（Ghost Text + Tab 补全，默认关闭）',
    defaultEnabled: false,
    configKeys: ['promptSuggestions'],
    sparsePaths: [
      '/core/styles/40-prompt-suggestions.css',
      '/core/runtime/70-prompt-suggestions.js',
      '/core/daemon/prompt-suggest.mjs'
    ],
    coreRelPaths: [
      'styles/40-prompt-suggestions.css',
      'runtime/70-prompt-suggestions.js',
      'daemon/prompt-suggest.mjs'
    ],
    aliases: ['suggest', 'suggestions', 'promptsuggestions', 'prompt-suggestions', 'ghost', 'ghosttext']
  }
});

const ALIAS_TO_FEATURE = (() => {
  const map = new Map();
  for (const [id, meta] of Object.entries(FEATURE_GROUPS)) {
    map.set(id.toLowerCase(), id);
    for (const alias of meta.aliases) {
      map.set(alias.toLowerCase(), id);
    }
  }
  return map;
})();

function parseFeatureTokenList(raw) {
  const tokens = String(raw || '')
    .split(/[\s,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.length === 0) {
    throw new Error('Empty feature list. Expected one or more of: i18n, metrics, openIn, fixes, suggest, all');
  }
  const ids = [];
  for (const tok of tokens) {
    if (tok === 'all' || tok === 'full') {
      return Object.keys(FEATURE_GROUPS);
    }
    const resolved = ALIAS_TO_FEATURE.get(tok);
    if (!resolved) {
      throw new Error(`Unknown feature "${tok}". Valid options: i18n, metrics, openIn, fixes, suggest, all`);
    }
    if (!ids.includes(resolved)) ids.push(resolved);
  }
  return ids;
}

export function parseFeatureSelection({ onlyArg = null, withoutArg = null } = {}) {
  const hasOnly = onlyArg !== null && onlyArg !== undefined && String(onlyArg).trim() !== '';
  const hasWithout = withoutArg !== null && withoutArg !== undefined && String(withoutArg).trim() !== '';
  const selected = {};
  for (const [id, meta] of Object.entries(FEATURE_GROUPS)) {
    selected[id] = meta.defaultEnabled !== false;
  }

  if (hasOnly) {
    for (const k of Object.keys(selected)) selected[k] = false;
    for (const id of parseFeatureTokenList(onlyArg)) {
      selected[id] = true;
    }
  }
  if (hasWithout) {
    for (const id of parseFeatureTokenList(withoutArg)) {
      selected[id] = false;
    }
  }

  const modulesPatch = {};
  for (const [id, meta] of Object.entries(FEATURE_GROUPS)) {
    const enabled = Boolean(selected[id]);
    for (const cfgKey of meta.configKeys) {
      modulesPatch[cfgKey] = enabled;
    }
  }

  return {
    explicit: hasOnly || hasWithout,
    selected,
    modulesPatch
  };
}

export function getSparseCheckoutPaths(
  selected = { i18n: true, metrics: true, openIn: true, fixes: true, suggest: false }
) {
  const out = [...BASE_SPARSE_PATHS];
  for (const [id, meta] of Object.entries(FEATURE_GROUPS)) {
    if (selected[id]) {
      for (const p of meta.sparsePaths) {
        if (!out.includes(p)) out.push(p);
      }
    }
  }
  return out;
}

export function getExcludedCoreRelPaths(selected) {
  const excluded = [];
  for (const [id, meta] of Object.entries(FEATURE_GROUPS)) {
    if (!selected[id]) {
      excluded.push(...meta.coreRelPaths);
    }
  }
  return excluded;
}
