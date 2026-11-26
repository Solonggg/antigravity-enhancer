/**
 * core/daemon/paths.mjs — Cross-Platform Channel Discovery & Dynamic Bundle Builder
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DEFAULT_ALLOWED_ORIGINS, extractJsoncNumberProperty, stripUtf8Bom } from '../shared.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ROOT_DIR = path.resolve(__dirname, '../..');
export const CORE_DIR = path.join(ROOT_DIR, 'core');
export const STYLES_DIR = path.join(CORE_DIR, 'styles');
export const RUNTIME_DIR = path.join(CORE_DIR, 'runtime');
export const USER_DIR = path.join(ROOT_DIR, 'user');
export const BASE_VERSION = '0.1.1';

let openInHelpers = {
  normalizeOpenInConfig: (raw) => ({
    targets: Array.isArray(raw?.targets) ? raw.targets : ['idea', 'finder'],
    ideaPath: typeof raw?.ideaPath === 'string' ? raw.ideaPath.trim() : '',
    copyPath: raw?.copyPath !== false,
    debug: Boolean(raw?.debug),
    customTargets: []
  }),
  sanitizeOpenInPatch: (cur) => ({
    targets: Array.isArray(cur?.targets) ? cur.targets : ['idea', 'finder'],
    ideaPath: typeof cur?.ideaPath === 'string' ? cur.ideaPath.trim() : '',
    copyPath: cur?.copyPath !== false
  }),
  getOpenInMenuDescriptors: () => ({ copyPath: true, debug: false, targets: [] }),
  detectOpenInTargets: () => ({})
};
if (fs.existsSync(path.join(__dirname, 'open-in.mjs'))) {
  try {
    const mod = await import('./open-in.mjs');
    openInHelpers = {
      normalizeOpenInConfig: mod.normalizeOpenInConfig,
      sanitizeOpenInPatch: mod.sanitizeOpenInPatch,
      getOpenInMenuDescriptors: mod.getOpenInMenuDescriptors,
      detectOpenInTargets: mod.detectOpenInTargets
    };
  } catch {}
}

export function parseDaemonCliArgs(argv = process.argv.slice(2)) {
  const hasFlag = (f) => argv.some((a) => a === f || a.startsWith(f + '='));
  const getArg = (flag, fallback = null) => {
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === flag && i + 1 < argv.length) return argv[i + 1];
      if (argv[i].startsWith(flag + '=')) return argv[i].slice(flag.length + 1);
    }
    return fallback;
  };
  return {
    safeMode: hasFlag('--safe-mode'),
    runOnce: hasFlag('--once'),
    cliChannel: getArg('--channel', null),
    portFile: getArg('--port-file', ''),
    conversationsDir: getArg('--conversations-dir', '')
  };
}

export function readJsonSafe(filePath, fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(stripUtf8Bom(fs.readFileSync(filePath, 'utf8')));
  } catch {
    return fallback;
  }
}

export function readTextSafe(filePath, fallback = '') {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return fallback;
  }
}

export function getFileMtimeSig(filePath) {
  try {
    const st = fs.statSync(filePath, { throwIfNoEntry: false });
    return st ? `${st.mtimeMs}:${st.size}` : '0:0';
  } catch {
    return '0:0';
  }
}

export function listSortedFiles(dirPath, ext) {
  try {
    if (!fs.existsSync(dirPath)) return [];
    return fs
      .readdirSync(dirPath)
      .filter((name) => name.endsWith(ext))
      .sort((a, b) => a.localeCompare(b))
      .map((name) => path.join(dirPath, name));
  } catch {
    return [];
  }
}

export function normalizeOverrideDict(rawObj) {
  if (!rawObj || typeof rawObj !== 'object') return {};
  const source = rawObj.exact && typeof rawObj.exact === 'object' ? rawObj.exact : rawObj;
  const clean = {};
  for (const [k, v] of Object.entries(source)) {
    if (k.startsWith('_')) continue;
    if (typeof v === 'string') {
      clean[k] = v;
    }
  }
  return clean;
}

export function resolveChannelPaths(singleChannel = 'stable', userCfg = {}, cliOpts = {}) {
  const home = os.homedir();
  const isInsiders = singleChannel === 'insiders';
  const appDirName = isInsiders ? 'Antigravity - Insiders' : 'Antigravity';
  const geminiSubDir = isInsiders ? '.gemini/antigravity-insiders' : '.gemini/antigravity';

  let defaultPortFile;
  if (process.platform === 'darwin') {
    defaultPortFile = path.join(home, 'Library', 'Application Support', appDirName, 'DevToolsActivePort');
  } else if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    defaultPortFile = path.join(appData, appDirName, 'DevToolsActivePort');
  } else {
    const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
    defaultPortFile = path.join(xdgConfig, appDirName, 'DevToolsActivePort');
  }

  const defaultConvDir = path.join(home, geminiSubDir, 'conversations');
  const dotDir = path.join(home, isInsiders ? '.antigravity-insiders' : '.antigravity');
  const argvPath = path.join(dotDir, 'argv.json');
  let fallbackPort = isInsiders ? 9223 : 9222;
  try {
    if (fs.existsSync(argvPath)) {
      const parsedPort = extractJsoncNumberProperty(fs.readFileSync(argvPath, 'utf8'), 'remote-debugging-port');
      if (parsedPort && parsedPort > 0) fallbackPort = parsedPort;
    }
  } catch {}

  const portFile = cliOpts.portFile || userCfg.portFile || defaultPortFile;
  const lsLogFile =
    process.platform === 'darwin'
      ? path.join(home, 'Library', 'Logs', appDirName, 'language_server.log')
      : path.join(path.dirname(defaultPortFile), 'logs', 'language_server.log');
  const channelInstalled =
    fs.existsSync(portFile) || fs.existsSync(path.dirname(defaultPortFile)) || fs.existsSync(dotDir);

  return {
    channel: singleChannel,
    portFile,
    lsLogFile,
    fallbackPort: Number(userCfg.fallbackPort) > 0 ? Number(userCfg.fallbackPort) : fallbackPort,
    channelInstalled,
    conversationsDir: cliOpts.conversationsDir || userCfg.conversationsDir || defaultConvDir
  };
}

export function resolveActiveChannelEndpoints(channelMode = 'auto', userCfg = {}, cliOpts = {}) {
  const explicitPortFile = cliOpts.portFile || userCfg.portFile || '';
  if (explicitPortFile) {
    const ch = channelMode === 'insiders' ? 'insiders' : 'stable';
    return [resolveChannelPaths(ch, userCfg, cliOpts)];
  }
  if (channelMode === 'stable' || channelMode === 'insiders') {
    return [resolveChannelPaths(channelMode, userCfg, cliOpts)];
  }
  return [
    resolveChannelPaths('stable', userCfg, cliOpts),
    resolveChannelPaths('insiders', userCfg, cliOpts)
  ];
}

const EDITABLE_MODULE_KEYS = new Set([
  'i18n',
  'metrics',
  'sessionStatus',
  'usageStats',
  'openIn',
  'promptSuggestions',
  'deadlockHealer',
  'zoomShortcuts',
  'cdpAutoRelaunch',
  'customCss',
  'customJs'
]);
const VALID_SUGGEST_MODEL_RE = /^[a-zA-Z0-9._:/-]{2,80}$/;

export function sanitizeConfigPatch(currentCfg, patch) {
  const base = currentCfg && typeof currentCfg === 'object' ? JSON.parse(JSON.stringify(currentCfg)) : {};
  if (!patch || typeof patch !== 'object') return base;

  if (patch.modules && typeof patch.modules === 'object') {
    const nextModules = base.modules && typeof base.modules === 'object' ? { ...base.modules } : {};
    const prevLegacy = nextModules.metrics !== false;
    const hasSessionPatch = typeof patch.modules.sessionStatus === 'boolean';
    const hasUsagePatch = typeof patch.modules.usageStats === 'boolean';
    const hasLegacyPatch = typeof patch.modules.metrics === 'boolean';
    for (const [k, v] of Object.entries(patch.modules)) {
      if (EDITABLE_MODULE_KEYS.has(k) && typeof v === 'boolean') {
        nextModules[k] = v;
      }
    }
    if (hasLegacyPatch && !hasSessionPatch && !hasUsagePatch) {
      nextModules.sessionStatus = patch.modules.metrics;
      nextModules.usageStats = patch.modules.metrics;
    } else if (hasSessionPatch || hasUsagePatch) {
      const effSession = typeof nextModules.sessionStatus === 'boolean' ? nextModules.sessionStatus : prevLegacy;
      const effUsage = typeof nextModules.usageStats === 'boolean' ? nextModules.usageStats : prevLegacy;
      nextModules.sessionStatus = effSession;
      nextModules.usageStats = effUsage;
      nextModules.metrics = Boolean(effSession || effUsage);
    }
    base.modules = nextModules;
  }

  if (patch.telemetryLayout === 'compact' || patch.telemetryLayout === 'detailed') {
    base.telemetryLayout = patch.telemetryLayout;
  }
  if (patch.telemetryCacheMode === 'session' || patch.telemetryCacheMode === 'step') {
    base.telemetryCacheMode = patch.telemetryCacheMode;
  }
  if (typeof patch.promptSuggestionModel === 'string') {
    const m = patch.promptSuggestionModel.trim();
    if (m && !m.startsWith('-') && VALID_SUGGEST_MODEL_RE.test(m)) {
      base.promptSuggestionModel = m;
    }
  }
  if (patch.openIn && typeof patch.openIn === 'object' && !Array.isArray(patch.openIn)) {
    base.openIn = openInHelpers.sanitizeOpenInPatch(base.openIn, patch.openIn);
  }

  return base;
}

export function createBundleController({ safeMode = false, cliChannel = null, hasSqlite = false, cliOpts = {} } = {}) {
  let cachedBundleSig = '';
  let cachedInjectScript = '';
  let cachedPatchVersion = '';
  let activeConfig = {
    enabled: true,
    channel: 'auto',
    telemetryLayout: 'compact',
    telemetryCacheMode: 'session',
    contextLimit: 'auto',
    manualContextLimit: 0,
    fallbackContextLimit: 256000,
    promptSuggestionModel: 'gemini-3.8-flash-low',
    modules: {
      i18n: true,
      metrics: Boolean(hasSqlite),
      sessionStatus: true,
      usageStats: Boolean(hasSqlite),
      openIn: true,
      promptSuggestions: false,
      deadlockHealer: true,
      zoomShortcuts: true,
      cdpAutoRelaunch: true,
      customCss: true,
      customJs: true
    },
    openIn: openInHelpers.normalizeOpenInConfig(null),
    selectors: {},
    allowedOrigins: DEFAULT_ALLOWED_ORIGINS,
    endpoints: []
  };

  function rebuildBundleIfNeeded(force = false) {
    const styleFiles = listSortedFiles(STYLES_DIR, '.css');
    const runtimeFiles = listSortedFiles(RUNTIME_DIR, '.js');
    const coreFiles = [...styleFiles, path.join(CORE_DIR, 'i18n.json'), ...runtimeFiles];
    const userFiles = safeMode
      ? []
      : [
          path.join(USER_DIR, 'config.json'),
          path.join(USER_DIR, 'custom.css'),
          path.join(USER_DIR, 'i18n.override.json'),
          path.join(USER_DIR, 'custom.js')
        ];

    const sig =
      coreFiles.map(getFileMtimeSig).join('|') +
      '|' +
      userFiles.map(getFileMtimeSig).join('|') +
      `|safe:${safeMode}|cli:${cliChannel || ''}|sqlite:${hasSqlite}`;

    if (!force && sig === cachedBundleSig && cachedInjectScript) {
      return false;
    }

    const userCfg = safeMode ? {} : readJsonSafe(path.join(USER_DIR, 'config.json'), {});
    const enabled = safeMode ? true : userCfg.enabled !== false;
    const channel = cliChannel || userCfg.channel || 'auto';
    const telemetryLayout = userCfg.telemetryLayout === 'detailed' ? 'detailed' : 'compact';
    const telemetryCacheMode = userCfg.telemetryCacheMode === 'step' ? 'step' : 'session';

    const rawContextLimit = userCfg.contextLimit;
    const isAutoLimit =
      rawContextLimit === undefined ||
      rawContextLimit === null ||
      String(rawContextLimit).trim() === '' ||
      String(rawContextLimit).trim().toLowerCase() === 'auto';
    const manualContextLimit = !isAutoLimit && Number(rawContextLimit) > 0 ? Number(rawContextLimit) : 0;
    const fallbackContextLimit =
      Number(userCfg.fallbackContextLimit) > 0 ? Number(userCfg.fallbackContextLimit) : 256000;
    const contextLimit = manualContextLimit > 0 ? manualContextLimit : 'auto';

    const rawModules = Object.assign({}, userCfg.features || {}, userCfg.modules || {});
    if (typeof rawModules.metricsCapsule === 'boolean' && typeof rawModules.metrics !== 'boolean') {
      rawModules.metrics = rawModules.metricsCapsule;
    }
    const legacyMetrics = rawModules.metrics !== false;
    const modules = {
      i18n: rawModules.i18n !== false,
      sessionStatus: typeof rawModules.sessionStatus === 'boolean' ? rawModules.sessionStatus : legacyMetrics,
      usageStats: typeof rawModules.usageStats === 'boolean' ? rawModules.usageStats : legacyMetrics,
      metrics: false,
      openIn: rawModules.openIn !== false,
      promptSuggestions: rawModules.promptSuggestions === true,
      deadlockHealer: rawModules.deadlockHealer !== false,
      zoomShortcuts: rawModules.zoomShortcuts !== false,
      cdpAutoRelaunch: rawModules.cdpAutoRelaunch !== false,
      customCss: rawModules.customCss !== false,
      customJs: rawModules.customJs !== false
    };

    const hasI18nFiles =
      fs.existsSync(path.join(CORE_DIR, 'i18n.json')) &&
      fs.existsSync(path.join(RUNTIME_DIR, '60-i18n-engine.js'));
    const hasTelemetryUiFile = fs.existsSync(path.join(RUNTIME_DIR, '50-telemetry-ui.js'));
    const hasMetricsFiles =
      hasTelemetryUiFile &&
      fs.existsSync(path.join(CORE_DIR, 'daemon', 'sqlite-metrics.mjs'));
    const hasOpenInFiles =
      fs.existsSync(path.join(RUNTIME_DIR, '65-open-in.js')) &&
      fs.existsSync(path.join(CORE_DIR, 'daemon', 'open-in.mjs'));
    const hasPromptSuggestFiles =
      fs.existsSync(path.join(RUNTIME_DIR, '70-prompt-suggestions.js')) &&
      fs.existsSync(path.join(CORE_DIR, 'daemon', 'prompt-suggest.mjs'));
    const hasGuardsFile = fs.existsSync(path.join(RUNTIME_DIR, '10-guards.js'));

    if (!hasI18nFiles) modules.i18n = false;
    if (!hasTelemetryUiFile) {
      modules.sessionStatus = false;
      modules.usageStats = false;
    } else if (!hasSqlite || !hasMetricsFiles) {
      modules.usageStats = false;
    }
    modules.metrics = Boolean(modules.sessionStatus || modules.usageStats);
    if (!hasOpenInFiles) modules.openIn = false;
    if (!hasPromptSuggestFiles) modules.promptSuggestions = false;
    if (!hasGuardsFile) {
      modules.deadlockHealer = false;
      modules.zoomShortcuts = false;
    }

    const openIn = openInHelpers.normalizeOpenInConfig(safeMode ? null : userCfg.openIn);
    const openInDetectors = openInHelpers.detectOpenInTargets(openIn, { platform: process.platform });
    const rawOpenInDescriptors = openInHelpers.getOpenInMenuDescriptors(openIn, { platform: process.platform });
    const openInDescriptors = {
      ...rawOpenInDescriptors,
      targets: (rawOpenInDescriptors.targets || []).filter((t) => {
        if (t.type === 'command' || t.id === 'finder') return true;
        const det = openInDetectors && openInDetectors[t.id];
        return det ? Boolean(det.available) : true;
      })
    };
    const endpoints = resolveActiveChannelEndpoints(channel, userCfg, cliOpts);

    const normalizedSelectors = Object.assign({}, userCfg.selectors || {});
    if (
      normalizedSelectors.branchPillInBox &&
      !String(normalizedSelectors.branchPillInBox).includes('project-branch-picker')
    ) {
      delete normalizedSelectors.branchPillInBox;
    }
    if (normalizedSelectors.homeGreeting && !String(normalizedSelectors.homeGreeting).includes('home-splash-content')) {
      delete normalizedSelectors.homeGreeting;
    }
    if (
      typeof normalizedSelectors.excludeI18n === 'string' &&
      normalizedSelectors.excludeI18n.trim() &&
      !normalizedSelectors.excludeI18n.includes('.monaco-editor')
    ) {
      normalizedSelectors.excludeI18n +=
        ', .monaco-editor, .monaco-diff-editor, .xterm, [data-markdown-root], [data-testid="user-message-content"], .agy-user-bubble, [class*="onyx-key"]';
    }

    const rawPromptModel = typeof userCfg.promptSuggestionModel === 'string' ? userCfg.promptSuggestionModel.trim() : '';
    const promptSuggestionModel =
      rawPromptModel && !rawPromptModel.startsWith('-') && /^[a-zA-Z0-9._:/-]+$/.test(rawPromptModel)
        ? rawPromptModel
        : 'gemini-3.8-flash-low';

    activeConfig = {
      enabled,
      channel,
      telemetryLayout,
      telemetryCacheMode,
      contextLimit,
      manualContextLimit,
      fallbackContextLimit,
      promptSuggestionModel,
      modules,
      openIn,
      selectors: normalizedSelectors,
      allowedOrigins: Array.isArray(userCfg.allowedOrigins) ? userCfg.allowedOrigins : DEFAULT_ALLOWED_ORIGINS,
      endpoints
    };

    const activeStyleFiles = styleFiles.filter((filePath) => {
      const base = path.basename(filePath);
      if (base === '30-telemetry.css') return Boolean(modules.metrics);
      if (base === '40-prompt-suggestions.css') return Boolean(modules.promptSuggestions);
      if (base === '42-open-in.css') return Boolean(modules.openIn);
      if (base === '45-settings-ui.css') return Boolean(enabled);
      return Boolean(enabled);
    });
    const baseCss = activeStyleFiles.map((f) => readTextSafe(f, '')).join('\n\n');
    const customCss = !safeMode && modules.customCss ? readTextSafe(path.join(USER_DIR, 'custom.css'), '') : '';
    const baseDict = modules.i18n ? readJsonSafe(path.join(CORE_DIR, 'i18n.json'), {}) : {};
    const rawOverrideDict =
      modules.i18n && !safeMode ? readJsonSafe(path.join(USER_DIR, 'i18n.override.json'), {}) : {};
    const mergedDict = modules.i18n ? Object.assign({}, baseDict, normalizeOverrideDict(rawOverrideDict)) : {};
    const customJs = !safeMode && modules.customJs ? readTextSafe(path.join(USER_DIR, 'custom.js'), '') : '';
    const runtimeTemplate = runtimeFiles.map((f) => readTextSafe(f, '')).join('\n');

    const hash = crypto
      .createHash('sha256')
      .update(String(enabled))
      .update(runtimeTemplate)
      .update(baseCss)
      .update(customCss)
      .update(JSON.stringify(mergedDict))
      .update(customJs)
      .update(
        JSON.stringify({
          telemetryLayout,
          telemetryCacheMode,
          promptSuggestionModel,
          modules,
          openIn: openInDescriptors,
          ideaPath: openIn.ideaPath,
          selectors: activeConfig.selectors
        })
      )
      .digest('hex')
      .slice(0, 8);

    const channelTag = channel === 'insiders' ? 'insiders' : 'stable';
    cachedPatchVersion = `${BASE_VERSION}-${channelTag}-${hash}`;

    const bootPayload = {
      version: cachedPatchVersion,
      platform: process.platform,
      enabled,
      telemetryLayout,
      telemetryCacheMode,
      cssText: baseCss,
      customCss,
      i18nDict: mergedDict,
      modules,
      openIn: openInDescriptors,
      openInDetectors,
      selectors: activeConfig.selectors,
      userConfig: {
        enabled,
        channel,
        telemetryLayout,
        telemetryCacheMode,
        contextLimit,
        promptSuggestionModel,
        modules,
        openIn: {
          targets: openIn.targets,
          ideaPath: openIn.ideaPath,
          copyPath: openIn.copyPath,
          customTargetsCount: openIn.customTargets.length
        }
      },
      customJs
    };

    cachedInjectScript = runtimeTemplate.replace(
      '})(__AG_BOOT_PAYLOAD__);',
      () => `})(${JSON.stringify(bootPayload)});`
    );
    cachedBundleSig = sig;
    return true;
  }

  function updateUserConfig(patch) {
    if (safeMode) return { ok: false, error: 'safeMode enabled' };
    const cfgPath = path.join(USER_DIR, 'config.json');
    try {
      fs.mkdirSync(USER_DIR, { recursive: true });
      const current = readJsonSafe(cfgPath, {});
      const next = sanitizeConfigPatch(current, patch);
      const serialized = JSON.stringify(next, null, 2) + '\n';
      const tmpPath = `${cfgPath}.tmp.${process.pid}.${Date.now()}`;
      fs.writeFileSync(tmpPath, serialized, 'utf8');
      try {
        fs.renameSync(tmpPath, cfgPath);
      } catch {
        fs.writeFileSync(cfgPath, serialized, 'utf8');
        try {
          fs.unlinkSync(tmpPath);
        } catch {}
      }
      cachedBundleSig = '';
      rebuildBundleIfNeeded();
      return { ok: true, config: activeConfig };
    } catch (err) {
      return { ok: false, error: err?.message || String(err || 'write failed') };
    }
  }

  return {
    rebuildBundleIfNeeded,
    updateUserConfig,
    getState: () => ({
      activeConfig,
      cachedInjectScript,
      cachedPatchVersion
    })
  };
}
