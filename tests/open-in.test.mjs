/**
 * tests/open-in.test.mjs — Simplified Right-Click "Open In" Parser, Launcher, Security & Runtime Helper Tests
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import {
  OPEN_IN_TARGET_IDS,
  normalizeOpenInConfig,
  sanitizeOpenInPatch,
  getOpenInMenuDescriptors,
  resolveIdeaLauncher,
  resolvePresetLauncher,
  detectOpenInTargets,
  sanitizePositiveInt,
  validateTargetPath,
  buildOpenCommand,
  executeOpenAction,
  parseFileTarget,
  formatDisplayTarget,
  formatCopyPath
} from '../core/daemon/open-in.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

test('parseFileTarget parses file:// URIs, POSIX paths, UTF-8 spaces, and rejects non-file schemes', () => {
  assert.deepEqual(
    parseFileTarget('file:///Users/dev/project/README.md#L10'),
    { path: '/Users/dev/project/README.md', line: 10, endLine: null, column: null }
  );
  assert.deepEqual(
    parseFileTarget('file:///Users/dev/project/README.md#L10-L25'),
    { path: '/Users/dev/project/README.md', line: 10, endLine: 25, column: null }
  );
  assert.deepEqual(
    parseFileTarget('file:///Users/dev/project/README.md#L10C4-L20C8'),
    { path: '/Users/dev/project/README.md', line: 10, endLine: 20, column: 4 }
  );
  assert.deepEqual(
    parseFileTarget('file://localhost/Users/dev/%E4%B8%AD%E6%96%87%20%E7%9B%AE%E5%BD%95/App.java#L8'),
    { path: '/Users/dev/中文 目录/App.java', line: 8, endLine: null, column: null }
  );
  assert.deepEqual(
    parseFileTarget('/Users/dev/src/App.tsx:42:12'),
    { path: '/Users/dev/src/App.tsx', line: 42, endLine: null, column: 12 }
  );
  assert.deepEqual(
    parseFileTarget('file:///Users/dev/App.tsx#L0'),
    { path: '/Users/dev/App.tsx', line: null, endLine: null, column: null }
  );

  for (const invalid of [
    '',
    null,
    'https://github.com/org/repo',
    'javascript:alert(1)',
    'jetbrains://idea/navigate/reference?path=README.md',
    'file://remote-host/Users/dev/a.txt',
    'file:///',
    '/',
    '//network/share/file.txt',
    'src/relative/path.js:10'
  ]) {
    assert.equal(parseFileTarget(invalid), null, `Expected null for: ${String(invalid)}`);
  }

  assert.equal(formatDisplayTarget({ path: '/Users/dev/README.md', line: 10, endLine: 20 }), 'README.md:10-20');
  assert.equal(formatDisplayTarget({ path: '/Users/dev/README.md', line: 10, endLine: null }), 'README.md:10');
  assert.equal(formatCopyPath({ path: '/Users/dev/README.md', line: 10 }), '/Users/dev/README.md:10');
  assert.equal(formatCopyPath({ path: '/Users/dev/README.md', line: null }), '/Users/dev/README.md');
});

test('normalizeOpenInConfig & sanitizeOpenInPatch enforce simplified 5-target allowlist and block customTargets injection', () => {
  assert.deepEqual(OPEN_IN_TARGET_IDS, ['idea', 'finder', 'zed', 'vscode', 'cursor']);

  const defaults = normalizeOpenInConfig(null);
  assert.deepEqual(defaults.targets, ['idea', 'finder']);
  assert.equal(defaults.copyPath, true);
  assert.deepEqual(defaults.customTargets, []);

  // Existing config with config-file-only customTargets
  const withCustom = normalizeOpenInConfig({
    targets: ['idea', 'zed', 'webstorm', 'unknown'],
    ideaPath: '/opt/homebrew/bin/idea',
    customTargets: [
      { id: 'subl', label: 'Sublime', command: 'subl', args: ['{path}:{line}'] },
      { id: 'idea', label: 'Shadow built-in', command: 'evil' }
    ]
  });
  assert.deepEqual(withCustom.targets, ['idea', 'zed']);
  assert.equal(withCustom.customTargets.length, 1);
  assert.equal(withCustom.customTargets[0].id, 'subl');

  // Renderer patch cannot overwrite/inject customTargets or invalid ideaPath
  const patched = sanitizeOpenInPatch(withCustom, {
    targets: ['finder', 'vscode', 'cursor', 'webstorm', 'evil'],
    ideaPath: 'relative/not/allowed',
    customTargets: [{ id: 'pwn', label: 'Pwn', command: '/bin/sh', args: ['-c', 'whoami'] }]
  });
  assert.deepEqual(patched.targets, ['finder', 'vscode', 'cursor']);
  assert.equal(patched.ideaPath, '/opt/homebrew/bin/idea', 'invalid ideaPath must be ignored');
  assert.equal(patched.customTargets.length, 1);
  assert.equal(patched.customTargets[0].id, 'subl', 'existing config-file customTargets preserved untouched');

  const clearedIdea = sanitizeOpenInPatch(patched, { ideaPath: '' });
  assert.equal(clearedIdea.ideaPath, '');

  const desc = getOpenInMenuDescriptors(withCustom, { platform: 'darwin' });
  assert.deepEqual(
    desc.targets.map((t) => t.id),
    ['idea', 'zed', 'subl']
  );
  assert.equal(desc.targets[0].labelZh, '在 IDEA 中打开');
  assert.equal(desc.targets[0].labelEn, 'Open in IDEA');
});

test('resolveIdeaLauncher, resolvePresetLauncher, and detectOpenInTargets detect simplified core editors accurately', () => {
  const homeDir = '/Users/tester';
  const toolboxBin = path.join(homeDir, 'Library/Application Support/JetBrains/Toolbox/scripts/idea');
  const appBin = '/Applications/IntelliJ IDEA.app/Contents/MacOS/idea';
  const zedCli = '/opt/homebrew/bin/zed';
  const cursorAppBin = '/Applications/Cursor.app/Contents/Resources/app/bin/cursor';

  assert.equal(
    resolveIdeaLauncher({
      ideaPath: '/Applications/IntelliJ IDEA.app',
      homeDir,
      existsSyncFn: (p) => p === appBin
    }),
    appBin
  );
  assert.equal(
    resolveIdeaLauncher({
      homeDir,
      existsSyncFn: (p) => p === toolboxBin || p === appBin
    }),
    toolboxBin
  );

  const existsSyncFn = (p) => p === zedCli || p === cursorAppBin;
  assert.deepEqual(resolvePresetLauncher('zed', { homeDir, envPath: '', existsSyncFn }), {
    bin: zedCli,
    appBundle: null,
    isCliScript: true
  });
  assert.deepEqual(resolvePresetLauncher('cursor', { homeDir, envPath: '', existsSyncFn }), {
    bin: cursorAppBin,
    appBundle: null,
    isCliScript: false
  });
  assert.deepEqual(resolvePresetLauncher('webstorm', { homeDir, envPath: '', existsSyncFn }), {
    bin: null,
    appBundle: null,
    isCliScript: false
  });

  const detected = detectOpenInTargets({}, { homeDir, envPath: '', existsSyncFn, platform: 'darwin' });
  assert.equal(detected.idea.available, false);
  assert.equal(detected.finder.available, true);
  assert.equal(detected.zed.available, true);
  assert.equal(detected.cursor.available, true);
  assert.equal(detected.vscode.available, false);
});

test('validateTargetPath, buildOpenCommand, and executeOpenAction prevent shell injection and honor target allowlist', async () => {
  assert.equal(sanitizePositiveInt('42'), 42);
  assert.equal(sanitizePositiveInt(0), null);
  assert.equal(validateTargetPath('').ok, false);
  assert.equal(validateTargetPath('relative/a.js').ok, false);
  assert.equal(validateTargetPath('/Users/a\0b.txt').ok, false);
  assert.equal(validateTargetPath('//server/share').ok, false);

  const calls = [];
  const execFileFn = (cmd, args, opts, cb) => {
    calls.push({ cmd, args, opts });
    cb(null, '', '');
  };
  const homeDir = '/Users/tester';
  const toolboxBin = path.join(homeDir, 'Library/Application Support/JetBrains/Toolbox/scripts/idea');
  const appBundle = '/Applications/IntelliJ IDEA.app';
  const zedCli = '/opt/homebrew/bin/zed';
  const openInCfg = {
    targets: ['idea', 'finder', 'zed'],
    ideaPath: '',
    copyPath: true
  };

  // Unenabled target (cursor) is rejected
  const blocked = await executeOpenAction(
    { targetId: 'cursor', path: '/Users/tester/a.ts' },
    openInCfg,
    { execFileFn, statSyncFn: () => ({ isDirectory: () => false }) }
  );
  assert.equal(blocked.ok, false);
  assert.equal(calls.length, 0);

  // Shell metacharacters stay discrete in argv array (no shell interpolation)
  const trickyPath = '/Users/tester/space "$(whoami)"/中文.java';
  const okIdea = await executeOpenAction(
    { targetId: 'idea', path: trickyPath, line: '23', column: 5 },
    openInCfg,
    {
      execFileFn,
      homeDir,
      platform: 'darwin',
      existsSyncFn: (p) => p === toolboxBin || p === appBundle,
      statSyncFn: () => ({ isDirectory: () => false })
    }
  );
  assert.equal(okIdea.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].cmd, toolboxBin);
  assert.deepEqual(calls[0].args, ['--line', '23', '--column', '5', trickyPath]);
  assert.deepEqual(calls[1], { cmd: 'open', args: ['-a', appBundle], opts: { timeout: 5000 } });

  // Zed passes path:line:col
  const okZed = await executeOpenAction(
    { targetId: 'zed', path: '/Users/tester/main.rs', line: 9, column: 2 },
    openInCfg,
    {
      execFileFn,
      homeDir,
      platform: 'darwin',
      existsSyncFn: (p) => p === zedCli,
      statSyncFn: () => ({ isDirectory: () => false })
    }
  );
  assert.equal(okZed.ok, true);
  assert.deepEqual(calls[2].args, ['/Users/tester/main.rs:9:2']);

  // Cross-platform Finder fallback
  assert.deepEqual(
    buildOpenCommand(
      { id: 'finder', type: 'finder' },
      { path: '/home/dev/proj/a.txt', isDirectory: false },
      { platform: 'linux' }
    ),
    { ok: true, command: 'xdg-open', args: ['/home/dev/proj'], isCliScript: false }
  );
});

test('65-open-in.js runtime extracts file targets from attributes, React props, text, and selection', () => {
  const code = ['00-head.js', '65-open-in.js', '90-tail.js']
    .map((f) => fs.readFileSync(path.join(ROOT_DIR, 'core', 'runtime', f), 'utf8'))
    .join('\n');

  const headChildren = [];
  const headEl = { appendChild(el) { el.parentNode = headEl; headChildren.push(el); } };
  const fakeDoc = {
    head: headEl,
    body: {
      nodeType: 1,
      tagName: 'BODY',
      classList: { contains: () => false },
      getAttribute: () => null,
      appendChild() {}
    },
    documentElement: {
      classList: { contains: () => true },
      setAttribute() {},
      removeAttribute() {}
    },
    getElementById: (id) => headChildren.find((e) => e.id === id) || null,
    createElement: (tag) => ({
      tagName: tag.toUpperCase(),
      id: '',
      textContent: '',
      style: {},
      setAttribute() {},
      removeAttribute() {},
      remove() {}
    }),
    getElementsByTagName: (t) => (t === 'head' ? [headEl] : []),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {}
  };

  const sandbox = {
    URL,
    location: { pathname: '/', href: 'http://127.0.0.1/', search: '' },
    navigator: { platform: 'MacIntel' },
    addEventListener() {},
    removeEventListener() {},
    document: fakeDoc,
    __AG_BOOT_PAYLOAD__: {
      version: '1.0.0-test',
      platform: 'darwin',
      enabled: true,
      cssText: '',
      customCss: '',
      i18nDict: {},
      modules: { i18n: false, metrics: false, openIn: true, promptSuggestions: false, deadlockHealer: false, zoomShortcuts: false },
      openIn: { targets: [{ id: 'idea', labelZh: '在 IDEA 中打开', labelEn: 'Open in IDEA', type: 'idea' }], copyPath: true },
      selectors: {},
      userConfig: {},
      customJs: ''
    }
  };
  sandbox.window = sandbox;
  sandbox.top = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`const __AG_BOOT_PAYLOAD__ = globalThis.__AG_BOOT_PAYLOAD__;\n${code}`, sandbox);

  const helpers = sandbox.__agOpenInHelpers;
  assert.ok(helpers, '__agOpenInHelpers must be mounted when openIn is enabled');

  // 1. Anchor href + anchor text line enrichment
  const anchorEl = {
    tagName: 'A',
    textContent: 'README.md:42',
    getAttribute: (k) => (k === 'href' ? 'file:///Users/dev/README.md' : null),
    parentElement: null
  };
  assert.deepEqual({ ...helpers.extractFileTargetFromElement(anchorEl, '') }, {
    path: '/Users/dev/README.md',
    line: 42,
    endLine: null,
    column: null
  });

  // 2. React props object with filePath + line
  const reactChip = {
    tagName: 'SPAN',
    textContent: 'App.tsx',
    getAttribute: () => null,
    __reactProps$abc: { filePath: '/Users/dev/src/App.tsx', startLine: 18 },
    parentElement: null
  };
  assert.deepEqual({ ...helpers.extractFileTargetFromElement(reactChip, '') }, {
    path: '/Users/dev/src/App.tsx',
    line: 18,
    endLine: null,
    column: null
  });

  // 3. Selection fallback
  const plainSpan = { tagName: 'SPAN', textContent: 'hello', getAttribute: () => null, parentElement: null };
  assert.deepEqual({ ...helpers.extractFileTargetFromElement(plainSpan, 'See `/Users/dev/a/b.ts:99` please') }, {
    path: '/Users/dev/a/b.ts',
    line: 99,
    endLine: null,
    column: null
  });

  assert.equal(helpers.isDarkThemeActive(fakeDoc, sandbox), true);
});
