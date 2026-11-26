/**
 * core/daemon/open-in.mjs — Right-Click "Open In" Configuration, Target Detection & Safe Process Spawner
 *
 * Security invariants:
 * - Zero shell interpolation: always invokes execFile(bin, argsArray).
 * - Target ID must match an enabled allowlisted target in active config.
 * - Custom command targets (type: "command") are read-only from user/config.json and
 *   cannot be created or modified from renderer UI patches.
 * - Paths must be local absolute POSIX paths without NUL/CR/LF and must exist on disk.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

export const OPEN_IN_PRESETS = Object.freeze([
  Object.freeze({
    id: 'zed',
    name: 'Zed',
    labelZh: '在 Zed 中打开',
    labelEn: 'Open in Zed',
    kind: 'zed',
    cliNames: Object.freeze(['zed']),
    extraCliPaths: Object.freeze(['/Applications/Zed.app/Contents/MacOS/cli']),
    appBundles: Object.freeze(['/Applications/Zed.app', 'Applications/Zed.app'])
  }),
  Object.freeze({
    id: 'vscode',
    name: 'VS Code',
    labelZh: '在 VS Code 中打开',
    labelEn: 'Open in VS Code',
    kind: 'vscode',
    cliNames: Object.freeze(['code']),
    extraCliPaths: Object.freeze(['/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code']),
    appBundles: Object.freeze(['/Applications/Visual Studio Code.app', 'Applications/Visual Studio Code.app'])
  }),
  Object.freeze({
    id: 'cursor',
    name: 'Cursor',
    labelZh: '在 Cursor 中打开',
    labelEn: 'Open in Cursor',
    kind: 'vscode',
    cliNames: Object.freeze(['cursor']),
    extraCliPaths: Object.freeze(['/Applications/Cursor.app/Contents/Resources/app/bin/cursor']),
    appBundles: Object.freeze(['/Applications/Cursor.app', 'Applications/Cursor.app'])
  })
]);

export const OPEN_IN_PRESET_MAP = new Map(OPEN_IN_PRESETS.map((p) => [p.id, p]));

export const OPEN_IN_BUILTIN_TARGETS = Object.freeze([
  Object.freeze({
    id: 'idea',
    name: 'IDEA',
    labelZh: '在 IDEA 中打开',
    labelEn: 'Open in IDEA',
    type: 'idea'
  }),
  Object.freeze({
    id: 'finder',
    name: 'Finder',
    labelZh: '在 Finder 中显示',
    labelEn: 'Reveal in Finder',
    type: 'finder'
  }),
  ...OPEN_IN_PRESETS.map((p) =>
    Object.freeze({
      id: p.id,
      name: p.name,
      labelZh: p.labelZh,
      labelEn: p.labelEn,
      type: 'preset'
    })
  )
]);

export const OPEN_IN_BUILTIN_MAP = new Map(OPEN_IN_BUILTIN_TARGETS.map((t) => [t.id, t]));
export const OPEN_IN_TARGET_IDS = Object.freeze(OPEN_IN_BUILTIN_TARGETS.map((t) => t.id));
export const DEFAULT_OPEN_IN_TARGETS = Object.freeze(['idea', 'finder']);

export const DEFAULT_OPEN_IN_CONFIG = Object.freeze({
  targets: DEFAULT_OPEN_IN_TARGETS,
  ideaPath: '',
  copyPath: true,
  debug: false,
  customTargets: Object.freeze([])
});

const IDEA_APP_BUNDLES = [
  '/Applications/IntelliJ IDEA.app',
  '/Applications/IntelliJ IDEA Ultimate.app',
  '/Applications/IntelliJ IDEA CE.app',
  '/Applications/IntelliJ IDEA Community Edition.app'
];

const HOME_IDEA_APP_BUNDLES = [
  'Applications/IntelliJ IDEA.app',
  'Applications/IntelliJ IDEA Ultimate.app',
  'Applications/IntelliJ IDEA CE.app',
  'Applications/IntelliJ IDEA Community Edition.app'
];

function isValidIdeaPath(raw) {
  if (typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  if (!trimmed) return true;
  if (trimmed.includes('\0') || trimmed.includes('\r') || trimmed.includes('\n')) return false;
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return false;
  return true;
}

function normalizeCustomTargets(rawList) {
  if (!Array.isArray(rawList)) return [];
  const out = [];
  const seen = new Set(OPEN_IN_TARGET_IDS);
  for (const item of rawList) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    if (item.enabled === false) continue;
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    const label = typeof item.label === 'string' ? item.label.trim() : '';
    const command = typeof item.command === 'string' ? item.command.trim() : '';
    if (!id || !label || !command || seen.has(id)) continue;
    const entry = {
      id,
      label,
      type: 'command',
      command
    };
    if (Array.isArray(item.args)) {
      entry.args = item.args.map((a) => String(a));
    }
    if (Array.isArray(item.argsNoLine)) {
      entry.argsNoLine = item.argsNoLine.map((a) => String(a));
    }
    seen.add(id);
    out.push(entry);
  }
  return out;
}

export function normalizeOpenInConfig(rawOpenIn = null) {
  const src = rawOpenIn && typeof rawOpenIn === 'object' && !Array.isArray(rawOpenIn) ? rawOpenIn : {};

  let targets;
  if (Array.isArray(src.targets)) {
    targets = [];
    const seen = new Set();
    for (const item of src.targets) {
      const id =
        typeof item === 'string'
          ? item.trim()
          : item && typeof item === 'object' && item.enabled !== false && typeof item.id === 'string'
          ? item.id.trim()
          : '';
      if (id && OPEN_IN_BUILTIN_MAP.has(id) && !seen.has(id)) {
        seen.add(id);
        targets.push(id);
      }
    }
  } else {
    targets = [...DEFAULT_OPEN_IN_TARGETS];
  }

  const rawIdeaPath = typeof src.ideaPath === 'string' ? src.ideaPath.trim() : '';
  const ideaPath = isValidIdeaPath(rawIdeaPath) ? rawIdeaPath : '';
  const copyPath = typeof src.copyPath === 'boolean' ? src.copyPath : true;
  const debug = Boolean(src.debug);

  const customFromObjects = Array.isArray(src.targets)
    ? src.targets.filter((item) => item && typeof item === 'object' && item.type === 'command')
    : [];
  const customTargets = normalizeCustomTargets([
    ...(Array.isArray(src.customTargets) ? src.customTargets : []),
    ...customFromObjects
  ]);

  return {
    targets,
    ideaPath,
    copyPath,
    debug,
    customTargets
  };
}

/**
 * Sanitizes renderer-originated openIn config updates.
 * Strictly ignores customTargets / arbitrary commands so renderer cannot inject executables.
 */
export function sanitizeOpenInPatch(currentOpenIn, patchOpenIn) {
  const base = normalizeOpenInConfig(currentOpenIn);
  const next = {
    targets: base.targets.slice(),
    ideaPath: base.ideaPath,
    copyPath: base.copyPath
  };
  if (base.debug) next.debug = true;
  if (base.customTargets.length > 0) {
    next.customTargets = base.customTargets.map((t) => ({ ...t }));
  }

  if (!patchOpenIn || typeof patchOpenIn !== 'object' || Array.isArray(patchOpenIn)) {
    return next;
  }

  if (Array.isArray(patchOpenIn.targets)) {
    const clean = [];
    const seen = new Set();
    for (const rawId of patchOpenIn.targets) {
      const id = typeof rawId === 'string' ? rawId.trim() : '';
      if (id && OPEN_IN_BUILTIN_MAP.has(id) && !seen.has(id)) {
        seen.add(id);
        clean.push(id);
      }
    }
    next.targets = clean;
  }

  if (typeof patchOpenIn.ideaPath === 'string') {
    const trimmed = patchOpenIn.ideaPath.trim();
    if (isValidIdeaPath(trimmed)) {
      next.ideaPath = trimmed;
    }
  }

  if (typeof patchOpenIn.copyPath === 'boolean') {
    next.copyPath = patchOpenIn.copyPath;
  }

  return next;
}

export function resolveActiveOpenInTargets(openInConfig, { platform = process.platform } = {}) {
  const cfg = normalizeOpenInConfig(openInConfig);
  const out = [];
  for (const id of cfg.targets) {
    const meta = OPEN_IN_BUILTIN_MAP.get(id);
    if (!meta) continue;
    const isNonMacFinder = meta.id === 'finder' && platform !== 'darwin';
    out.push({
      id: meta.id,
      name: meta.name,
      labelZh: isNonMacFinder ? '在文件管理器中显示' : meta.labelZh,
      labelEn: isNonMacFinder ? 'Reveal in File Manager' : meta.labelEn,
      type: meta.type
    });
  }
  for (const custom of cfg.customTargets) {
    out.push({
      id: custom.id,
      name: custom.label,
      labelZh: custom.label,
      labelEn: custom.label,
      type: 'command',
      command: custom.command,
      args: custom.args,
      argsNoLine: custom.argsNoLine
    });
  }
  return out;
}

export function getOpenInMenuDescriptors(openInConfig, { platform = process.platform } = {}) {
  const cfg = normalizeOpenInConfig(openInConfig);
  const targets = resolveActiveOpenInTargets(cfg, { platform }).map((t) => ({
    id: t.id,
    labelZh: t.labelZh,
    labelEn: t.labelEn,
    type: t.type
  }));
  return {
    copyPath: cfg.copyPath !== false,
    debug: Boolean(cfg.debug),
    targets
  };
}

export function resolveIdeaAppBundle({ existsSyncFn = fs.existsSync, homeDir = os.homedir() } = {}) {
  const candidates = [
    ...IDEA_APP_BUNDLES,
    ...HOME_IDEA_APP_BUNDLES.map((rel) => path.join(homeDir, rel))
  ];
  for (const bundlePath of candidates) {
    if (existsSyncFn(bundlePath)) return bundlePath;
  }
  return null;
}

function collectCliCandidates(cliNames, envPath) {
  const candidates = [];
  for (const name of cliNames) {
    for (const fixed of [`/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`]) {
      if (!candidates.includes(fixed)) candidates.push(fixed);
    }
    if (envPath) {
      for (const dir of envPath.split(path.delimiter)) {
        const trimmed = dir.trim();
        if (!trimmed) continue;
        const candidate = path.join(trimmed, name);
        if (!candidates.includes(candidate)) candidates.push(candidate);
      }
    }
  }
  return candidates;
}

export function resolveIdeaLauncher({
  ideaPath = '',
  existsSyncFn = fs.existsSync,
  homeDir = os.homedir(),
  envPath = process.env.PATH || ''
} = {}) {
  const configured = typeof ideaPath === 'string' ? ideaPath.trim() : '';
  if (configured) {
    if (configured.endsWith('.app')) {
      const inner = path.join(configured, 'Contents', 'MacOS', 'idea');
      if (existsSyncFn(inner)) return inner;
    }
    if (existsSyncFn(configured)) {
      return configured;
    }
  }

  const toolboxScript = path.join(
    homeDir,
    'Library',
    'Application Support',
    'JetBrains',
    'Toolbox',
    'scripts',
    'idea'
  );
  if (existsSyncFn(toolboxScript)) return toolboxScript;

  for (const cliPath of collectCliCandidates(['idea'], envPath)) {
    if (existsSyncFn(cliPath)) return cliPath;
  }

  const bundleBinaries = [
    ...IDEA_APP_BUNDLES.map((b) => path.join(b, 'Contents', 'MacOS', 'idea')),
    ...HOME_IDEA_APP_BUNDLES.map((rel) => path.join(homeDir, rel, 'Contents', 'MacOS', 'idea'))
  ];
  for (const binPath of bundleBinaries) {
    if (existsSyncFn(binPath)) return binPath;
  }

  return null;
}

export function resolvePresetAppBundle(
  presetId,
  { existsSyncFn = fs.existsSync, homeDir = os.homedir() } = {}
) {
  const preset = OPEN_IN_PRESET_MAP.get(presetId);
  if (!preset || !Array.isArray(preset.appBundles)) return null;
  for (const rawBundle of preset.appBundles) {
    const candidate = rawBundle.startsWith('/') ? rawBundle : path.join(homeDir, rawBundle);
    if (existsSyncFn(candidate)) return candidate;
  }
  return null;
}

export function resolvePresetLauncher(
  presetId,
  {
    existsSyncFn = fs.existsSync,
    homeDir = os.homedir(),
    envPath = process.env.PATH || ''
  } = {}
) {
  const preset = OPEN_IN_PRESET_MAP.get(presetId);
  if (!preset) {
    return { bin: null, appBundle: null, isCliScript: false };
  }

  const appBundle = resolvePresetAppBundle(presetId, { existsSyncFn, homeDir });

  for (const cliPath of collectCliCandidates(preset.cliNames || [], envPath)) {
    if (existsSyncFn(cliPath)) {
      return { bin: cliPath, appBundle, isCliScript: true };
    }
  }

  if (Array.isArray(preset.extraCliPaths)) {
    for (const extra of preset.extraCliPaths) {
      if (existsSyncFn(extra)) {
        return { bin: extra, appBundle, isCliScript: false };
      }
    }
  }

  return { bin: null, appBundle, isCliScript: false };
}

export function detectOpenInTargets(openInConfig = {}, opts = {}) {
  const cfg = normalizeOpenInConfig(openInConfig);
  const platform = opts.platform || process.platform;
  const ideaBin = resolveIdeaLauncher({
    ideaPath: cfg.ideaPath || '',
    existsSyncFn: opts.existsSyncFn,
    homeDir: opts.homeDir,
    envPath: opts.envPath
  });
  const ideaBundle = resolveIdeaAppBundle({
    existsSyncFn: opts.existsSyncFn,
    homeDir: opts.homeDir
  });

  const targets = {
    idea: {
      available: Boolean(ideaBin),
      path: ideaBin || null,
      appBundle: ideaBundle || null
    },
    finder: {
      available: platform === 'darwin' || platform === 'win32' || platform === 'linux',
      path: platform === 'darwin' ? '/usr/bin/open' : null
    }
  };

  for (const preset of OPEN_IN_PRESETS) {
    const resolved = resolvePresetLauncher(preset.id, opts);
    targets[preset.id] = {
      available: Boolean(resolved.bin),
      path: resolved.bin || null,
      appBundle: resolved.appBundle || null
    };
  }

  return targets;
}

export function sanitizePositiveInt(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isSafeInteger(num) || num < 1) return null;
  return num;
}

export function validateTargetPath(rawPath, { statSyncFn = fs.statSync } = {}) {
  if (typeof rawPath !== 'string' || rawPath.length === 0) {
    return { ok: false, error: '路径不能为空' };
  }
  if (rawPath.includes('\0') || rawPath.includes('\r') || rawPath.includes('\n')) {
    return { ok: false, error: '路径包含非法字符' };
  }
  if (!rawPath.startsWith('/') || rawPath.startsWith('//')) {
    return { ok: false, error: '仅支持本地绝对路径' };
  }

  const normalized = path.posix.normalize(rawPath);
  if (!normalized.startsWith('/')) {
    return { ok: false, error: '仅支持本地绝对路径' };
  }

  let st;
  try {
    st = statSyncFn(normalized);
  } catch {
    return { ok: false, error: `文件或目录不存在: ${normalized}` };
  }
  if (!st) {
    return { ok: false, error: `文件或目录不存在: ${normalized}` };
  }

  return {
    ok: true,
    path: normalized,
    isDirectory: typeof st.isDirectory === 'function' ? Boolean(st.isDirectory()) : false
  };
}

function substituteTemplate(template, vars) {
  return String(template)
    .replaceAll('{path}', vars.path)
    .replaceAll('{line}', vars.line ? String(vars.line) : '')
    .replaceAll('{column}', vars.column ? String(vars.column) : '');
}

export function buildOpenCommand(
  targetConfig,
  { path: targetPath, line = null, column = null, isDirectory = false },
  {
    ideaPath = '',
    existsSyncFn = fs.existsSync,
    homeDir = os.homedir(),
    envPath = process.env.PATH || '',
    platform = process.platform
  } = {}
) {
  if (!targetConfig || typeof targetConfig !== 'object') {
    return { ok: false, error: '无效的打开目标配置' };
  }

  if (targetConfig.type === 'finder') {
    if (platform === 'darwin') {
      return { ok: true, command: 'open', args: ['-R', targetPath], isCliScript: false };
    }
    if (platform === 'win32') {
      return { ok: true, command: 'explorer.exe', args: [`/select,${targetPath}`], isCliScript: false };
    }
    const dirTarget = isDirectory ? targetPath : path.posix.dirname(targetPath);
    return { ok: true, command: 'xdg-open', args: [dirTarget], isCliScript: false };
  }

  if (targetConfig.type === 'idea') {
    const ideaBin = resolveIdeaLauncher({ ideaPath, existsSyncFn, homeDir, envPath });
    if (!ideaBin) {
      return {
        ok: false,
        error: '未找到 IntelliJ IDEA 启动器，请在设置中配置 ideaPath 或在 JetBrains Toolbox 开启 Shell Scripts'
      };
    }

    const args = [];
    if (!isDirectory && line) {
      args.push('--line', String(line));
      if (column) args.push('--column', String(column));
    }
    args.push(targetPath);

    const isCliScript = !ideaBin.includes('.app/Contents/MacOS/');
    return { ok: true, command: ideaBin, args, isCliScript };
  }

  if (targetConfig.type === 'preset') {
    const preset = OPEN_IN_PRESET_MAP.get(targetConfig.id);
    if (!preset) {
      return { ok: false, error: `未知的预设编辑器: ${targetConfig.id}` };
    }
    const resolved = resolvePresetLauncher(targetConfig.id, { existsSyncFn, homeDir, envPath });
    if (!resolved.bin) {
      return {
        ok: false,
        error: `未找到 ${preset.name} 启动器，请确认已安装 ${preset.name} 并配置命令行启动器`
      };
    }

    let args;
    if (preset.kind === 'vscode') {
      if (!isDirectory && line) {
        const loc = column ? `${targetPath}:${line}:${column}` : `${targetPath}:${line}`;
        args = ['--goto', loc];
      } else {
        args = [targetPath];
      }
    } else if (preset.kind === 'zed') {
      if (!isDirectory && line) {
        args = [column ? `${targetPath}:${line}:${column}` : `${targetPath}:${line}`];
      } else {
        args = [targetPath];
      }
    } else {
      args = [targetPath];
    }

    return {
      ok: true,
      command: resolved.bin,
      args,
      isCliScript: resolved.isCliScript,
      appBundle: resolved.appBundle
    };
  }

  if (targetConfig.type === 'command') {
    const cmd = typeof targetConfig.command === 'string' ? targetConfig.command.trim() : '';
    if (!cmd) {
      return { ok: false, error: `自定义目标 "${targetConfig.id}" 缺少 command` };
    }

    let rawArgs;
    if (!isDirectory && line && Array.isArray(targetConfig.args) && targetConfig.args.length > 0) {
      rawArgs = targetConfig.args;
    } else if (Array.isArray(targetConfig.argsNoLine) && targetConfig.argsNoLine.length > 0) {
      rawArgs = targetConfig.argsNoLine;
    } else if (Array.isArray(targetConfig.args) && targetConfig.args.length > 0) {
      rawArgs = targetConfig.args;
    } else {
      rawArgs = ['{path}'];
    }

    const vars = { path: targetPath, line, column };
    const args = rawArgs.map((item) => substituteTemplate(item, vars));
    return { ok: true, command: cmd, args, isCliScript: false };
  }

  return { ok: false, error: `不支持的目标类型: ${targetConfig.type}` };
}

function runExecFile(execFileFn, command, args, options) {
  return new Promise((resolve) => {
    try {
      execFileFn(command, args, options, (err, stdout, stderr) => {
        if (err) {
          resolve({
            ok: false,
            error: err.message || String(err),
            stderr: stderr ? String(stderr) : ''
          });
          return;
        }
        resolve({
          ok: true,
          stdout: stdout ? String(stdout) : '',
          stderr: stderr ? String(stderr) : ''
        });
      });
    } catch (err) {
      resolve({ ok: false, error: err?.message || String(err) });
    }
  });
}

export async function executeOpenAction(
  payload,
  openInConfig,
  {
    execFileFn = execFile,
    existsSyncFn = fs.existsSync,
    statSyncFn = fs.statSync,
    homeDir = os.homedir(),
    envPath = process.env.PATH || '',
    platform = process.platform
  } = {}
) {
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: '无效的调用参数' };
  }

  const cfg = normalizeOpenInConfig(openInConfig);
  const targetId = typeof payload.targetId === 'string' ? payload.targetId.trim() : '';
  const activeTargets = resolveActiveOpenInTargets(cfg, { platform });
  const targetConfig = activeTargets.find((t) => t.id === targetId);
  if (!targetConfig) {
    return { ok: false, error: `未授权或未启用的目标: ${targetId}` };
  }

  const pathCheck = validateTargetPath(payload.path, { statSyncFn });
  if (!pathCheck.ok) {
    return { ok: false, error: pathCheck.error };
  }

  const line = sanitizePositiveInt(payload.line);
  const column = line ? sanitizePositiveInt(payload.column) : null;

  const built = buildOpenCommand(
    targetConfig,
    {
      path: pathCheck.path,
      line,
      column,
      isDirectory: pathCheck.isDirectory
    },
    {
      ideaPath: cfg.ideaPath || '',
      existsSyncFn,
      homeDir,
      envPath,
      platform
    }
  );
  if (!built.ok) {
    return { ok: false, error: built.error };
  }

  const execRes = await runExecFile(execFileFn, built.command, built.args, { timeout: 10000 });
  if (!execRes.ok) {
    return {
      ok: false,
      command: built.command,
      args: built.args,
      error: execRes.error
    };
  }

  if (targetConfig.type === 'idea' && platform === 'darwin' && built.isCliScript) {
    const appBundle = resolveIdeaAppBundle({ existsSyncFn, homeDir });
    if (appBundle) {
      await runExecFile(execFileFn, 'open', ['-a', appBundle], { timeout: 5000 });
    }
  }

  return {
    ok: true,
    command: built.command,
    args: built.args
  };
}

function toPositiveInt(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const num = Number(raw);
  if (!Number.isSafeInteger(num) || num < 1) return null;
  return num;
}

function decodePathSafe(rawPath) {
  try {
    return decodeURIComponent(rawPath);
  } catch {
    return null;
  }
}

function parseLocationHash(hash) {
  if (!hash || typeof hash !== 'string') {
    return { line: null, endLine: null, column: null, matched: false };
  }
  const trimmed = hash.trim();
  if (!trimmed.startsWith('#')) {
    return { line: null, endLine: null, column: null, matched: false };
  }

  let m = trimmed.match(/^#L?(\d+)(?:C|:)(\d+)(?:-L?(\d+)(?:(?:C|:)\d+)?)?$/i);
  if (m) {
    const line = toPositiveInt(m[1]);
    const column = line ? toPositiveInt(m[2]) : null;
    const endLine = line ? toPositiveInt(m[3]) : null;
    return { line, endLine, column, matched: true };
  }

  m = trimmed.match(/^#L?(\d+)-L?(\d+)$/i);
  if (m) {
    const line = toPositiveInt(m[1]);
    const endLine = line ? toPositiveInt(m[2]) : null;
    return { line, endLine, column: null, matched: true };
  }

  m = trimmed.match(/^#L?(\d+)$/i);
  if (m) {
    const line = toPositiveInt(m[1]);
    return { line, endLine: null, column: null, matched: true };
  }

  return { line: null, endLine: null, column: null, matched: false };
}

function splitPathTrailingLocation(rawPath) {
  let cleanPath = rawPath;
  const hashIdx = cleanPath.indexOf('#');
  if (hashIdx > 0) {
    const loc = parseLocationHash(cleanPath.slice(hashIdx));
    if (loc.matched) {
      return {
        path: cleanPath.slice(0, hashIdx),
        line: loc.line,
        endLine: loc.endLine,
        column: loc.column
      };
    }
  }

  let m = cleanPath.match(/^(\/.+?):(\d+):(\d+)$/);
  if (m) {
    const line = toPositiveInt(m[2]);
    const column = line ? toPositiveInt(m[3]) : null;
    return { path: m[1], line, endLine: null, column };
  }

  m = cleanPath.match(/^(\/.+?):(\d+)$/);
  if (m) {
    return { path: m[1], line: toPositiveInt(m[2]), endLine: null, column: null };
  }

  return { path: cleanPath, line: null, endLine: null, column: null };
}

function isValidLocalPosixPath(p) {
  if (!p || typeof p !== 'string') return false;
  if (!p.startsWith('/') || p.startsWith('//')) return false;
  if (p.length <= 1) return false;
  if (p.includes('\0') || p.includes('\r') || p.includes('\n')) return false;
  return true;
}

export function parseFileTarget(rawInput) {
  if (typeof rawInput !== 'string') return null;
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  const schemeMatch = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (schemeMatch) {
    if (schemeMatch[1].toLowerCase() !== 'file') return null;
    let urlObj;
    try {
      urlObj = new URL(trimmed);
    } catch {
      return null;
    }
    if (urlObj.protocol !== 'file:') return null;
    if (urlObj.hostname && urlObj.hostname.toLowerCase() !== 'localhost') return null;

    const decoded = decodePathSafe(urlObj.pathname);
    if (!decoded) return null;

    const hashLoc = parseLocationHash(urlObj.hash);
    if (hashLoc.matched) {
      if (!isValidLocalPosixPath(decoded)) return null;
      return {
        path: decoded,
        line: hashLoc.line,
        endLine: hashLoc.endLine,
        column: hashLoc.column
      };
    }

    const split = splitPathTrailingLocation(decoded);
    if (!isValidLocalPosixPath(split.path)) return null;
    return {
      path: split.path,
      line: split.line,
      endLine: split.endLine,
      column: split.column
    };
  }

  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return null;
  const split = splitPathTrailingLocation(trimmed);
  if (!isValidLocalPosixPath(split.path)) return null;
  return {
    path: split.path,
    line: split.line,
    endLine: split.endLine,
    column: split.column
  };
}

export function formatDisplayTarget(target) {
  if (!target || typeof target.path !== 'string' || !target.path) return '';
  const segments = target.path.split('/').filter(Boolean);
  const name = segments.length > 0 ? segments[segments.length - 1] : target.path;
  if (target.line && target.endLine && target.endLine > target.line) {
    return `${name}:${target.line}-${target.endLine}`;
  }
  if (target.line) return `${name}:${target.line}`;
  return name;
}

export function formatCopyPath(target) {
  if (!target || typeof target.path !== 'string' || !target.path) return '';
  return target.line ? `${target.path}:${target.line}` : target.path;
}
