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
  isWindowsAbsolutePath,
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
      version: '0.1.1-test',
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
  assert.equal(typeof sandbox.__ag_open_in_icon_svg, 'function', '65-open-in.js should expose __ag_open_in_icon_svg');
  for (const id of ['idea', 'finder', 'vscode', 'cursor', 'zed', 'copy', 'command']) {
    const svg = sandbox.__ag_open_in_icon_svg(id);
    assert.ok(svg.startsWith('<svg ') && svg.endsWith('</svg>'), `icon for ${id} should be valid inline SVG`);
    assert.ok(!svg.includes('<defs'), `icon for ${id} should avoid <defs> IDs`);
  }

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

test('Windows Open-In path parsing, validation, editor detection, and safe command execution', async () => {
  // 1. Path parsing (Windows drive paths, file:///C:/... URIs, UNC/relative rejection)
  assert.equal(isWindowsAbsolutePath('C:\\Users\\dev\\App.tsx'), true);
  assert.equal(isWindowsAbsolutePath('D:/work/proj/main.rs'), true);
  assert.equal(isWindowsAbsolutePath('\\\\server\\share\\a.txt'), false);
  assert.equal(isWindowsAbsolutePath('C:relative.txt'), false);

  assert.deepEqual(parseFileTarget('C:\\Users\\dev\\src\\App.tsx:42:5'), {
    path: 'C:\\Users\\dev\\src\\App.tsx',
    line: 42,
    endLine: null,
    column: 5
  });
  assert.deepEqual(parseFileTarget('D:/work/README.md#L10-L20'), {
    path: 'D:/work/README.md',
    line: 10,
    endLine: 20,
    column: null
  });
  assert.deepEqual(parseFileTarget('file:///C:/Users/dev/My%20File.ts#L7C3'), {
    path: 'C:\\Users\\dev\\My File.ts',
    line: 7,
    endLine: null,
    column: 3
  });
  assert.deepEqual(parseFileTarget('file://localhost/c%3A/Users/dev/%E4%B8%AD%E6%96%87.java#L12'), {
    path: 'c:\\Users\\dev\\中文.java',
    line: 12,
    endLine: null,
    column: null
  });
  assert.deepEqual(parseFileTarget('C:\\123'), {
    path: 'C:\\123',
    line: null,
    endLine: null,
    column: null
  });

  for (const invalid of [
    '\\\\server\\share\\file.txt',
    'file://remote/C:/Users/dev/a.txt',
    'file:///C:/',
    'C:\\',
    'C:relative\\file.ts',
    'src\\relative\\file.ts:10'
  ]) {
    assert.equal(parseFileTarget(invalid), null, `Expected null for Windows invalid path: ${invalid}`);
  }

  assert.equal(formatDisplayTarget({ path: 'C:\\Users\\dev\\App.tsx', line: 42, endLine: null }), 'App.tsx:42');
  assert.equal(formatCopyPath({ path: 'C:\\Users\\dev\\App.tsx', line: 42 }), 'C:\\Users\\dev\\App.tsx:42');

  // 2. validateTargetPath normalizes Windows paths & rejects UNC / relative
  const winChecked = validateTargetPath('C:/Users/dev/src/../App.tsx', {
    statSyncFn: () => ({ isDirectory: () => false })
  });
  assert.deepEqual(winChecked, { ok: true, path: 'C:\\Users\\dev\\App.tsx', isDirectory: false });
  assert.equal(validateTargetPath('\\\\server\\share\\a.txt').ok, false);
  assert.equal(validateTargetPath('C:relative.txt').ok, false);

  // 3. ideaPath config & menu descriptors on win32
  const winCfg = normalizeOpenInConfig({
    targets: ['idea', 'finder', 'vscode', 'cursor', 'zed'],
    ideaPath: 'C:\\Program Files\\JetBrains\\IntelliJ IDEA 2025.1\\bin\\idea64.exe'
  });
  assert.equal(winCfg.ideaPath, 'C:\\Program Files\\JetBrains\\IntelliJ IDEA 2025.1\\bin\\idea64.exe');
  const winDesc = getOpenInMenuDescriptors(winCfg, { platform: 'win32' });
  const explorerDesc = winDesc.targets.find((t) => t.id === 'finder');
  assert.equal(explorerDesc.labelZh, '在资源管理器中显示');
  assert.equal(explorerDesc.labelEn, 'Reveal in Explorer');

  // 4. Windows editor detection (Toolbox idea.cmd, Program Files idea64.exe, VS Code sibling Code.exe, Cursor, Zed)
  const homeDir = 'C:\\Users\\tester';
  const env = {
    LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local',
    ProgramFiles: 'C:\\Program Files',
    'ProgramFiles(x86)': 'C:\\Program Files (x86)',
    ComSpec: 'C:\\Windows\\System32\\cmd.exe'
  };
  const ideaPfExe = 'C:\\Program Files\\JetBrains\\IntelliJ IDEA 2025.2\\bin\\idea64.exe';
  const toolboxIdeaCmd = 'C:\\Users\\tester\\AppData\\Local\\JetBrains\\Toolbox\\scripts\\idea.cmd';
  const codeCmd = 'C:\\Users\\tester\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code.cmd';
  const codeExe = 'C:\\Users\\tester\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe';
  const cursorExe = 'C:\\Users\\tester\\AppData\\Local\\Programs\\cursor\\Cursor.exe';
  const zedExe = 'C:\\Users\\tester\\AppData\\Local\\Programs\\Zed\\bin\\zed.exe';

  const readdirSyncFn = (dir) =>
    dir === 'C:\\Program Files\\JetBrains' ? ['IntelliJ IDEA 2024.3', 'IntelliJ IDEA 2025.2'] : [];

  assert.equal(
    resolveIdeaLauncher({
      platform: 'win32',
      homeDir,
      env,
      envPath: '',
      readdirSyncFn,
      existsSyncFn: (p) => p === ideaPfExe
    }),
    ideaPfExe
  );

  // When code.cmd is on PATH and sibling Code.exe exists, prefer native Code.exe
  assert.deepEqual(
    resolvePresetLauncher('vscode', {
      platform: 'win32',
      homeDir,
      env,
      envPath: 'C:\\Users\\tester\\AppData\\Local\\Programs\\Microsoft VS Code\\bin',
      existsSyncFn: (p) => p === codeCmd || p === codeExe
    }),
    { bin: codeExe, appBundle: null, isCliScript: false }
  );

  const detected = detectOpenInTargets(
    {},
    {
      platform: 'win32',
      homeDir,
      env,
      envPath: '',
      readdirSyncFn,
      existsSyncFn: (p) => p === toolboxIdeaCmd || p === codeExe || p === cursorExe || p === zedExe
    }
  );
  assert.equal(detected.idea.available, true);
  assert.equal(detected.idea.path, toolboxIdeaCmd);
  assert.equal(detected.finder.available, true);
  assert.equal(detected.finder.path, 'explorer.exe');
  assert.equal(detected.vscode.available, true);
  assert.equal(detected.vscode.path, codeExe);
  assert.equal(detected.cursor.available, true);
  assert.equal(detected.cursor.path, cursorExe);
  assert.equal(detected.zed.available, true);
  assert.equal(detected.zed.path, zedExe);

  // 5. Safe Windows execution: explorer.exe (spaces + benign exit code 1), .exe direct, .cmd via ComSpec + metachar block
  const calls = [];
  const execFileFn = (cmd, args, opts, cb) => {
    calls.push({ cmd, args, opts });
    if (cmd === 'explorer.exe') {
      const err = new Error('Command failed');
      err.code = 1;
      err.killed = false;
      cb(err, '', '');
      return;
    }
    cb(null, '', '');
  };
  const openInCfg = { targets: ['idea', 'finder', 'vscode', 'zed'], copyPath: true };

  // Explorer with spaces uses /select,"..." + windowsVerbatimArguments and tolerates exit code 1
  const okExplorer = await executeOpenAction(
    { targetId: 'finder', path: 'C:/Users/tester/My Project/App.tsx' },
    openInCfg,
    {
      platform: 'win32',
      homeDir,
      env,
      execFileFn,
      statSyncFn: () => ({ isDirectory: () => false })
    }
  );
  assert.equal(okExplorer.ok, true);
  assert.equal(calls[0].cmd, 'explorer.exe');
  assert.deepEqual(calls[0].args, ['/select,"C:\\Users\\tester\\My Project\\App.tsx"']);
  assert.equal(calls[0].opts.windowsHide, true);
  assert.equal(calls[0].opts.windowsVerbatimArguments, true);

  // Native .exe (VS Code) runs directly without cmd.exe even with special chars
  const okCode = await executeOpenAction(
    { targetId: 'vscode', path: 'C:\\Users\\tester\\R&D\\App.tsx', line: 15, column: 2 },
    openInCfg,
    {
      platform: 'win32',
      homeDir,
      env,
      envPath: '',
      execFileFn,
      existsSyncFn: (p) => p === codeExe,
      statSyncFn: () => ({ isDirectory: () => false })
    }
  );
  assert.equal(okCode.ok, true);
  assert.equal(calls[1].cmd, codeExe);
  assert.deepEqual(calls[1].args, ['--goto', 'C:\\Users\\tester\\R&D\\App.tsx:15:2']);
  assert.equal(calls[1].opts.windowsHide, true);

  // Batch .cmd (Toolbox idea.cmd) invokes ComSpec /d /s /c safely for normal paths
  const okCmd = await executeOpenAction(
    { targetId: 'idea', path: 'C:\\Users\\tester\\My Project\\Main.java', line: 9, column: 4 },
    openInCfg,
    {
      platform: 'win32',
      homeDir,
      env,
      envPath: '',
      execFileFn,
      existsSyncFn: (p) => p === toolboxIdeaCmd,
      statSyncFn: () => ({ isDirectory: () => false })
    }
  );
  assert.equal(okCmd.ok, true);
  assert.equal(calls[2].cmd, env.ComSpec);
  assert.equal(calls[2].args[0], '/d');
  assert.equal(calls[2].args[1], '/s');
  assert.equal(calls[2].args[2], '/c');
  assert.ok(calls[2].args[3].includes(toolboxIdeaCmd));
  assert.ok(calls[2].args[3].includes('C:\\Users\\tester\\My Project\\Main.java'));
  assert.equal(calls[2].opts.windowsHide, true);
  assert.equal(calls[2].opts.windowsVerbatimArguments, true);

  // Batch .cmd MUST reject cmd.exe shell metacharacters (&, |, %, etc.)
  const blockedCmd = await executeOpenAction(
    { targetId: 'idea', path: 'C:\\Users\\tester\\a&calc.exe\\Main.java', line: 9 },
    openInCfg,
    {
      platform: 'win32',
      homeDir,
      env,
      envPath: '',
      execFileFn,
      existsSyncFn: (p) => p === toolboxIdeaCmd,
      statSyncFn: () => ({ isDirectory: () => false })
    }
  );
  assert.equal(blockedCmd.ok, false);
  assert.equal(calls.length, 3, 'unsafe metacharacters must never invoke cmd.exe');
});

test('65-open-in.js runtime extracts Windows paths and renders Windows Explorer icon on win32', () => {
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
      classList: { contains: () => false },
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
    navigator: { platform: 'Win32' },
    addEventListener() {},
    removeEventListener() {},
    document: fakeDoc,
    __AG_BOOT_PAYLOAD__: {
      version: '0.1.1-test',
      platform: 'win32',
      enabled: true,
      cssText: '',
      customCss: '',
      i18nDict: {},
      modules: { i18n: false, metrics: false, openIn: true, promptSuggestions: false, deadlockHealer: false, zoomShortcuts: false },
      openIn: { targets: [{ id: 'finder', labelZh: '在资源管理器中显示', labelEn: 'Reveal in Explorer', type: 'finder' }], copyPath: true },
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
  assert.ok(helpers);

  // Windows Explorer yellow folder SVG (distinct from macOS Finder blue face)
  const explorerSvg = sandbox.__ag_open_in_icon_svg('finder');
  assert.ok(explorerSvg.startsWith('<svg ') && explorerSvg.endsWith('</svg>'));
  assert.ok(explorerSvg.includes('#F9CA4B'), 'win32 finder icon should render Windows Explorer folder');
  assert.ok(!explorerSvg.includes('<defs'));

  // 1. file:///C:/... anchor with line enrichment
  const anchorEl = {
    tagName: 'A',
    textContent: 'App.tsx:28',
    getAttribute: (k) => (k === 'href' ? 'file:///C:/Users/dev/My%20Proj/App.tsx' : null),
    parentElement: null
  };
  assert.deepEqual({ ...helpers.extractFileTargetFromElement(anchorEl, '') }, {
    path: 'C:\\Users\\dev\\My Proj\\App.tsx',
    line: 28,
    endLine: null,
    column: null
  });

  // 2. React props with Windows backslash path
  const reactChip = {
    tagName: 'SPAN',
    textContent: 'Main.java',
    getAttribute: () => null,
    __reactProps$win: { fsPath: 'D:\\workspace\\demo\\Main.java', line: 77 },
    parentElement: null
  };
  assert.deepEqual({ ...helpers.extractFileTargetFromElement(reactChip, '') }, {
    path: 'D:\\workspace\\demo\\Main.java',
    line: 77,
    endLine: null,
    column: null
  });

  // 3. Free text & selection extraction for Windows paths
  const codeEl = {
    tagName: 'CODE',
    textContent: 'C:\\Program Files\\My App\\index.js:12:4',
    getAttribute: () => null,
    parentElement: null
  };
  assert.deepEqual({ ...helpers.extractFileTargetFromElement(codeEl, '') }, {
    path: 'C:\\Program Files\\My App\\index.js',
    line: 12,
    endLine: null,
    column: 4
  });

  const plainSpan = { tagName: 'SPAN', textContent: 'hello', getAttribute: () => null, parentElement: null };
  assert.deepEqual(
    { ...helpers.extractFileTargetFromElement(plainSpan, 'Look at `D:\\repo\\src\\app.ts:99` please') },
    {
      path: 'D:\\repo\\src\\app.ts',
      line: 99,
      endLine: null,
      column: null
    }
  );
  assert.equal(helpers.formatDisplayTarget({ path: 'D:\\repo\\src\\app.ts', line: 99, endLine: null }), 'app.ts:99');
});
