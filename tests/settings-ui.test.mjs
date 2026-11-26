/**
 * tests/settings-ui.test.mjs — Settings UI Model Grouping, Config Patch Sanitization & Localization Engine Tests
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import {
  deriveEffortFromModelId,
  parseAgyModelsOutput
} from '../core/daemon/prompt-suggest.mjs';
import { sanitizeConfigPatch } from '../core/daemon/paths.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

const SAMPLE_AGY_MODELS_RAW = [
  '\x1b[?25l⠋ Loading models...\r⠙ Loading models...\r\x1b[2K\x1b[?25h',
  'gemini-4-neon-low              Gemini 4 Neon (Low)',
  'gemini-4-neon-medium           Gemini 4 Neon (Medium)',
  'gemini-4-neon-high             Gemini 4 Neon (High)',
  'gemini-4-neon-xhigh            Gemini 4 Neon (XHigh)',
  'gemini-pro-orchestrator-neon   Orchestrator (Neon)',
  'gemini-3.8-flash-high          Gemini 3.8 Flash (High)',
  'gemini-3.8-flash-low           Gemini 3.8 Flash (Low)',
  'gemini-3.8-flash-medium        Gemini 3.8 Flash (Medium)',
  'gpt-oss-120b-medium            GPT-OSS 120B (Medium)',
  'claude-sonnet-5-5-medium       Claude Sonnet 5.5 (Medium)',
  'claude-sonnet-5-5-low          Claude Sonnet 5.5 (Low)'
].join('\n');

test('parseAgyModelsOutput strips ANSI/spinner frames, groups by base model, sorts efforts, and pins Gemini 3.8 Flash', () => {
  const families = parseAgyModelsOutput(SAMPLE_AGY_MODELS_RAW);
  assert.equal(families.length, 4, 'Orchestrator should be filtered out, leaving 4 model families');

  assert.equal(families[0].name, 'Gemini 3.8 Flash');
  assert.equal(families[0].recommended, true);
  assert.equal(families[0].defaultEffort, 'Low');
  assert.deepEqual(
    families[0].efforts.map((e) => [e.label, e.id]),
    [
      ['Low', 'gemini-3.8-flash-low'],
      ['Medium', 'gemini-3.8-flash-medium'],
      ['High', 'gemini-3.8-flash-high']
    ]
  );

  const neon = families.find((f) => f.name === 'Gemini 4 Neon');
  assert.ok(neon);
  assert.deepEqual(
    neon.efforts.map((e) => e.label),
    ['Low', 'Medium', 'High', 'Extra High']
  );

  const oss = families.find((f) => f.key === 'gpt-oss-120b');
  assert.ok(oss);
  assert.equal(oss.singleId, 'gpt-oss-120b-medium');
  assert.equal(oss.name, 'GPT-OSS 120B (Medium)');
  assert.deepEqual(oss.efforts, []);

  assert.deepEqual(parseAgyModelsOutput(''), []);
});

test('deriveEffortFromModelId maps model ID suffixes to valid agy --effort flags', () => {
  assert.equal(deriveEffortFromModelId('gemini-3.8-flash-low'), 'low');
  assert.equal(deriveEffortFromModelId('gemini-4-neon-medium'), 'medium');
  assert.equal(deriveEffortFromModelId('claude-opus-5-5-high'), 'high');
  assert.equal(deriveEffortFromModelId('gemini-4-neon-xhigh'), 'xhigh');
  assert.equal(deriveEffortFromModelId('custom-model-max'), 'max');
  assert.equal(deriveEffortFromModelId('unknown-model'), 'low');
});

test('sanitizeConfigPatch validates whitelisted fields, sanitizes openIn, and blocks removed/unsafe keys', () => {
  const baseCfg = {
    enabled: true,
    telemetryLayout: 'compact',
    telemetryCacheMode: 'session',
    promptSuggestionModel: 'gemini-3.8-flash-low',
    modules: {
      i18n: true,
      metrics: true,
      openIn: true,
      promptSuggestions: false
    },
    openIn: {
      targets: ['idea', 'finder'],
      ideaPath: '',
      copyPath: true,
      customTargets: [{ id: 'custom-subl', label: 'Sublime', type: 'command', command: 'subl', args: ['{path}'] }]
    }
  };

  const next = sanitizeConfigPatch(baseCfg, {
    telemetryLayout: 'detailed',
    telemetryCacheMode: 'invalid-mode',
    promptSuggestionModel: 'gemini-4-neon-xhigh',
    sshHosts: ['node032'],
    modules: {
      promptSuggestions: true,
      openIn: false,
      theme: true,
      sshRemote: true,
      i18n: 0,
      injectedUnknownModule: true
    },
    openIn: {
      targets: ['idea', 'zed', 'cursor', 'webstorm'],
      ideaPath: '/Applications/IntelliJ IDEA.app',
      customTargets: [{ id: 'evil', label: 'Evil', command: '/bin/sh' }]
    }
  });

  assert.equal(next.telemetryLayout, 'detailed');
  assert.equal(next.telemetryCacheMode, 'session', 'invalid cache mode should be ignored');
  assert.equal(next.promptSuggestionModel, 'gemini-4-neon-xhigh');
  assert.equal(next.sshHosts, undefined, 'removed sshHosts must be ignored');
  assert.equal(next.modules.promptSuggestions, true);
  assert.equal(next.modules.openIn, false);
  assert.equal(next.modules.i18n, true, 'non-boolean module values should be ignored');
  assert.equal(next.modules.theme, undefined, 'removed theme module must be ignored');
  assert.equal(next.modules.sshRemote, undefined, 'removed sshRemote module must be ignored');
  assert.equal(next.modules.injectedUnknownModule, undefined);
  assert.deepEqual(next.openIn.targets, ['idea', 'zed', 'cursor']);
  assert.equal(next.openIn.ideaPath, '/Applications/IntelliJ IDEA.app');
  assert.deepEqual(next.openIn.customTargets, baseCfg.openIn.customTargets);

  const rejected = sanitizeConfigPatch(next, {
    promptSuggestionModel: '--evil; rm -rf /',
    openIn: { ideaPath: 'relative/bad' }
  });
  assert.equal(rejected.promptSuggestionModel, 'gemini-4-neon-xhigh');
  assert.equal(rejected.openIn.ideaPath, '/Applications/IntelliJ IDEA.app');
});

test('60-i18n-engine translates dynamic quota-exhausted banners while preserving model names', () => {
  const i18nDict = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'core', 'i18n.json'), 'utf8'));
  const code = ['00-head.js', '60-i18n-engine.js', '90-tail.js']
    .map((f) => fs.readFileSync(path.join(ROOT_DIR, 'core', 'runtime', f), 'utf8'))
    .join('\n');

  const textNodes = [
    "Your plan's baseline quota will refresh on 11/23/2026, 3:00:00 PM. To continue using this model now, enable AI Credit overages.",
    "You need at least 50 AI Credits to send messages. To continue using Gemini 4 Neon now, purchase more AI Credits. Your plan's baseline quota will refresh on 23.11.2026, 15:00:00.",
    'Your quota for Gemini 4 Neon will reset on 11/23/2026, 3:00:00 PM. Switch to another available model to continue.',
    'Your quota for this model has been reached. Switch to another available model to continue.',
    'Too many requests, please try again in a bit!',
    'See plans'
  ].map((s) => ({
    nodeType: 3,
    nodeValue: s,
    parentElement: {
      tagName: 'SPAN',
      closest: () => null,
      getAttribute: () => null,
      hasAttribute: () => false,
      querySelectorAll: () => []
    }
  }));

  let walkIdx = -1;
  const headChildren = [];
  const headEl = { appendChild(el) { el.parentNode = headEl; headChildren.push(el); } };
  const fakeDoc = {
    head: headEl,
    body: {
      nodeType: 1,
      tagName: 'BODY',
      classList: { contains: () => false },
      style: { removeProperty() {} },
      closest: () => null,
      matches: () => false,
      hasAttribute: () => false,
      getAttribute: () => null,
      querySelectorAll: () => []
    },
    hidden: false,
    documentElement: { style: { removeProperty() {} }, setAttribute() {}, getAttribute: () => null, removeAttribute() {} },
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
    createTreeWalker: () => ({
      currentNode: null,
      nextNode() {
        walkIdx += 1;
        if (walkIdx >= textNodes.length) return false;
        this.currentNode = textNodes[walkIdx];
        return true;
      }
    }),
    addEventListener() {},
    removeEventListener() {}
  };

  const sandbox = {
    location: { pathname: '/', href: 'http://127.0.0.1/', search: '' },
    navigator: { platform: 'MacIntel', onLine: true },
    history: { pushState() {}, replaceState() {} },
    addEventListener() {},
    removeEventListener() {},
    setInterval: () => 1,
    clearInterval() {},
    setTimeout: () => 1,
    clearTimeout() {},
    requestAnimationFrame: () => 1,
    document: fakeDoc,
    NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3 },
    MutationObserver: class { observe() {} disconnect() {} },
    __AG_BOOT_PAYLOAD__: {
      version: '1.0.0-test',
      platform: 'darwin',
      enabled: true,
      cssText: '',
      customCss: '',
      i18nDict,
      modules: { i18n: true, metrics: false, openIn: false, promptSuggestions: false, deadlockHealer: false, zoomShortcuts: false },
      selectors: {},
      userConfig: { modules: { i18n: true } },
      customJs: ''
    }
  };
  sandbox.window = sandbox;
  sandbox.top = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`const __AG_BOOT_PAYLOAD__ = globalThis.__AG_BOOT_PAYLOAD__;\n${code}`, sandbox);

  assert.equal(
    textNodes[0].nodeValue,
    '当前方案的基础配额将于 11/23/2026, 3:00:00 PM 刷新。如需立即继续使用该模型，请开启 AI 点数超额抵扣。'
  );
  assert.equal(
    textNodes[1].nodeValue,
    '发送消息需要至少 50 AI 点数。如需立即继续使用 Gemini 4 Neon，请购买更多 AI 点数。当前方案的基础配额将于 23.11.2026, 15:00:00 刷新。'
  );
  assert.equal(
    textNodes[2].nodeValue,
    'Gemini 4 Neon 的配额将于 11/23/2026, 3:00:00 PM 重置。请切换至其他可用模型继续。'
  );
  assert.equal(
    textNodes[3].nodeValue,
    '该模型的配额已用尽。请切换至其他可用模型继续。'
  );
  assert.equal(textNodes[4].nodeValue, '请求过于频繁，请稍后再试！');
  assert.equal(textNodes[5].nodeValue, '查看套餐');
});

test('60-i18n-engine handles Antigravity 2.35.1 labels, newly added rules, shortcut suffixes, permission choices, and Shadow DOM', () => {
  const i18nDict = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'core', 'i18n.json'), 'utf8'));
  const code = ['00-head.js', '60-i18n-engine.js', '90-tail.js']
    .map((f) => fs.readFileSync(path.join(ROOT_DIR, 'core', 'runtime', f), 'utf8'))
    .join('\n');

  const mkEl = (attrs = {}, extra = {}) => {
    const map = new Map(Object.entries(attrs));
    return {
      nodeType: 1,
      tagName: 'BUTTON',
      closest: () => null,
      matches: () => false,
      getAttribute: (k) => (map.has(k) ? map.get(k) : null),
      setAttribute: (k, v) => map.set(k, String(v)),
      removeAttribute: (k) => map.delete(k),
      hasAttribute: (k) => map.has(k),
      querySelectorAll: () => [],
      ...extra
    };
  };

  const shadowTextNode = {
    nodeType: 3,
    nodeValue: 'Agent Settings',
    parentElement: mkEl()
  };
  const shadowRoot = {
    nodeType: 11,
    host: mkEl(),
    querySelectorAll: () => [],
    _nodes: [shadowTextNode]
  };
  const shadowHost = mkEl({}, { shadowRoot });

  const textNodes = [
    'Prevent sleep',
    'Keep in menu bar',
    'Enable notifications for agent',
    'Enable AI credit overages',
    'Open links in',
    'Delete all Remote Agents data',
    'This computer',
    'Thinking for 3s',
    'Your plan: Google AI Ultra',
    'Input Box',
    'Choose which key sends a message in the chat composer.',
    'Quote',
    'Low',
    'Extra High',
    "Yes, and always allow 'npm test' in this project",
    'Show 5 more results...',
    'Marked 3 conversations as read',
    'Model unavailable, retrying in 4s (attempt 2/5)',
    'No MCP Servers'
  ].map((s) => ({
    nodeType: 3,
    nodeValue: s,
    parentElement: mkEl()
  }));

  const attrEls = [
    mkEl({ 'aria-label': 'Model, current: Gemini 4 Neon Extra High, Model cannot be changed while the agent is running' }),
    mkEl({ 'aria-label': 'Permission mode: Turbo (Permissions cannot be changed while the agent is running)' }),
    mkEl({ placeholder: 'Search shortcuts...' }),
    mkEl({ 'aria-label': 'Where the agent runs, current: This computer' }),
    mkEl({ title: 'Settings (Cmd+,)' })
  ];
  const allWalkNodes = [shadowHost, ...attrEls, ...textNodes];

  const headChildren = [];
  const headEl = { appendChild(el) { el.parentNode = headEl; headChildren.push(el); } };
  const fakeDoc = {
    head: headEl,
    body: {
      nodeType: 1,
      tagName: 'BODY',
      classList: { contains: () => false },
      style: { removeProperty() {} },
      closest: () => null,
      matches: () => false,
      hasAttribute: () => false,
      getAttribute: () => null,
      querySelectorAll: () => []
    },
    hidden: false,
    documentElement: { style: { removeProperty() {} }, setAttribute() {}, getAttribute: () => null, removeAttribute() {} },
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
    createTreeWalker: (root, _what, filter) => {
      const list = root === shadowRoot ? shadowRoot._nodes : allWalkNodes;
      let idx = -1;
      return {
        currentNode: null,
        nextNode() {
          while (idx + 1 < list.length) {
            idx += 1;
            const n = list[idx];
            const verdict = filter && filter.acceptNode ? filter.acceptNode(n) : 1;
            if (verdict === 1) {
              this.currentNode = n;
              return true;
            }
          }
          return false;
        }
      };
    },
    addEventListener() {},
    removeEventListener() {}
  };

  const sandbox = {
    location: { pathname: '/', href: 'http://127.0.0.1/', search: '' },
    navigator: { platform: 'MacIntel', onLine: true },
    history: { pushState() {}, replaceState() {} },
    addEventListener() {},
    removeEventListener() {},
    setInterval: () => 1,
    clearInterval() {},
    setTimeout: () => 1,
    clearTimeout() {},
    requestAnimationFrame: () => 1,
    document: fakeDoc,
    NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3 },
    MutationObserver: class { observe() {} disconnect() {} },
    __AG_BOOT_PAYLOAD__: {
      version: '1.0.0-test',
      platform: 'darwin',
      enabled: true,
      cssText: '',
      customCss: '',
      i18nDict,
      modules: { i18n: true, metrics: false, openIn: false, promptSuggestions: false, deadlockHealer: false, zoomShortcuts: false },
      selectors: {},
      userConfig: { modules: { i18n: true } },
      customJs: ''
    }
  };
  sandbox.window = sandbox;
  sandbox.top = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`const __AG_BOOT_PAYLOAD__ = globalThis.__AG_BOOT_PAYLOAD__;\n${code}`, sandbox);

  assert.equal(textNodes[0].nodeValue, '防止电脑休眠');
  assert.equal(textNodes[1].nodeValue, '保持在系统菜单栏');
  assert.equal(textNodes[2].nodeValue, '启用智能体系统通知');
  assert.equal(textNodes[3].nodeValue, '启用 AI 点数超额抵扣');
  assert.equal(textNodes[4].nodeValue, '默认打开链接方式');
  assert.equal(textNodes[5].nodeValue, '删除所有远程智能体数据');
  assert.equal(textNodes[6].nodeValue, '本机');
  assert.equal(textNodes[7].nodeValue, '正在思考 3s');
  assert.equal(textNodes[8].nodeValue, '当前套餐：Google AI Ultra');
  assert.equal(textNodes[9].nodeValue, '输入框');
  assert.equal(textNodes[10].nodeValue, '选择在聊天输入框中发送消息的快捷键。');
  assert.equal(textNodes[11].nodeValue, '引用');
  assert.equal(textNodes[12].nodeValue, 'Low');
  assert.equal(textNodes[13].nodeValue, 'Extra High');
  assert.equal(textNodes[14].nodeValue, "是，且在此项目中始终允许运行 'npm test'");
  assert.equal(textNodes[15].nodeValue, '显示另外 5 个结果...');
  assert.equal(textNodes[16].nodeValue, '已将 3 个会话标记为已读');
  assert.equal(textNodes[17].nodeValue, '模型暂不可用，4 秒后重试（第 2/5 次尝试）');
  assert.equal(textNodes[18].nodeValue, '暂无 MCP 服务器');
  assert.equal(shadowTextNode.nodeValue, '智能体设置', 'Shadow DOM text nodes must be translated');

  assert.equal(
    attrEls[0].getAttribute('aria-label'),
    '模型，当前：Gemini 4 Neon Extra High（智能体运行期间无法切换模型）'
  );
  assert.equal(
    attrEls[1].getAttribute('aria-label'),
    '权限模式：全自动放行 (Turbo)（智能体运行期间无法更改权限）'
  );
  assert.equal(attrEls[2].getAttribute('placeholder'), '搜索快捷键...');
  assert.equal(attrEls[3].getAttribute('aria-label'), '智能体运行位置，当前：本机');
  assert.equal(attrEls[4].getAttribute('title'), '系统设置 (Cmd+,)');

  // Disabling i18n cleanly restores both light DOM and Shadow DOM back to English
  sandbox.__AG_BOOT_PAYLOAD__.modules.i18n = false;
  vm.runInContext(`const __AG_BOOT_PAYLOAD__2 = globalThis.__AG_BOOT_PAYLOAD__;\n${code.replace('})(__AG_BOOT_PAYLOAD__);', '})(__AG_BOOT_PAYLOAD__2);')}`, sandbox);
  assert.equal(textNodes[0].nodeValue, 'Prevent sleep');
  assert.equal(shadowTextNode.nodeValue, 'Agent Settings', 'Shadow DOM text nodes must restore when i18n disabled');
});

test('75-settings-ui uses manual popovers inside settings dialog, updates worker status in place, and defers rerender while menu is open', () => {
  const src = fs.readFileSync(path.join(ROOT_DIR, 'core', 'runtime', '75-settings-ui.js'), 'utf8');

  // Popovers must use manual mode (never auto light-dismiss fighting Radix Dialog)
  assert.ok(src.includes("root.setAttribute('popover', 'manual')"), 'root model menu must use popover="manual"');
  assert.ok(src.includes("sub.setAttribute('popover', 'manual')"), 'effort submenu must use popover="manual"');
  assert.ok(!src.includes("setAttribute('popover', 'auto')"), 'must not use popover="auto"');

  // Popovers must mount inside activeDlg so Radix FocusScope treats clicks as inside the dialog
  assert.ok(
    src.includes('const hostContainer = (activeDlg && activeDlg.isConnected ? activeDlg : document.body);'),
    'model popovers should mount inside activeDlg when available'
  );

  // Status polling must update DOM in-place without rebuilding pane.innerHTML, and defer renderPane while menu is open
  assert.ok(src.includes('function updateWorkerStatusDom()'), 'must provide in-place updateWorkerStatusDom()');
  assert.ok(src.includes('statusOnly: true'), 'poller must request statusOnly updates');
  assert.ok(src.includes('pendingPaneRender = true'), 'must defer renderPane while model menu is open');
  assert.ok(src.includes('uiState.agyStatus.authRequired'), 'must surface agy authRequired status in UI');
  assert.ok(src.includes('agy 未登录'), 'must include Chinese auth-required badge label');
});
