/**
 * tests/manifest-hygiene.test.mjs — Core Manifest Integrity, i18n Dictionary & Zero-Outbound Repo Hygiene Tests
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyCoreIntegrity } from '../core/installer/manifest.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

function walkAllFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.DS_Store') {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkAllFiles(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

test('core/manifest.json matches every file under core/ with zero drift', () => {
  const res = verifyCoreIntegrity(ROOT_DIR);
  assert.equal(res.ok, true, `Core manifest drift detected: ${JSON.stringify(res.modified)}`);
});

test('core/i18n.json is valid JSON with expanded localization coverage and protected brand/model labels', () => {
  const dictPath = path.join(ROOT_DIR, 'core', 'i18n.json');
  const raw = fs.readFileSync(dictPath, 'utf8');
  const dict = JSON.parse(raw);
  const keys = Object.keys(dict);
  assert.ok(keys.length >= 5000, `Expected >= 5000 i18n entries, found ${keys.length}`);
  assert.equal(typeof dict['Settings'], 'string');
  for (const keepEn of [
    'Minimal',
    'Low',
    'Medium',
    'High',
    'Extra',
    'Extra High',
    'XHigh',
    'Max',
    'Orchestrator',
    'Orchestrator (Carbon)',
    'Orchestrator (Argon)',
    'Antigravity'
  ]) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(dict, keepEn),
      false,
      `Protected model/effort/brand label "${keepEn}" should stay untranslated`
    );
  }
});

test('Assembled runtime JS and CSS parts pass syntax validation without theme overrides', () => {
  const stylesDir = path.join(ROOT_DIR, 'core', 'styles');
  const runtimeDir = path.join(ROOT_DIR, 'core', 'runtime');
  const styleFiles = fs.readdirSync(stylesDir).filter((f) => f.endsWith('.css')).sort();
  const runtimeFiles = fs.readdirSync(runtimeDir).filter((f) => f.endsWith('.js')).sort();

  // Theme stylesheets & theme sync runtime must be absent
  for (const removed of ['00-base.css', '10-light-codex.css', '20-dark-codex.css']) {
    assert.equal(styleFiles.includes(removed), false, `Removed theme file ${removed} must not exist`);
  }
  assert.equal(runtimeFiles.includes('20-theme-sync.js'), false, '20-theme-sync.js must not exist');
  assert.equal(styleFiles.includes('42-open-in.css'), true, '42-open-in.css must exist');
  assert.equal(runtimeFiles.includes('65-open-in.js'), true, '65-open-in.js must exist');

  const css = styleFiles.map((f) => fs.readFileSync(path.join(stylesDir, f), 'utf8')).join('\n');
  const js = runtimeFiles.map((f) => fs.readFileSync(path.join(runtimeDir, f), 'utf8')).join('\n');

  assert.ok(css.includes('.ag-dot-slow'));
  assert.ok(css.includes('#ag-open-in-menu'));
  assert.ok(!css.includes('data-ag-preset'), 'CSS must not reference removed theme preset attribute');
  assert.ok(!css.includes('data-ag-theme-mode'), 'CSS must not depend on removed data-ag-theme-mode attribute');
  assert.ok(
    /\[data-testid="cascade-system-message-toolbar"\]\s*>\s*div:last-child[\s\S]*?justify-content:\s*flex-end/i.test(css),
    'Turn toolbar action buttons must stay right-aligned'
  );
  assert.ok(
    /\.ag-turn-metrics\s*\{[^}]*margin-right:\s*auto/i.test(css),
    'Per-turn metrics badge must push native copy/thumbs/time controls to the right edge'
  );

  assert.ok(!js.includes('codex-pure-white'));
  assert.ok(!js.includes('codex-dark'));
  assert.ok(js.includes('cascade-system-message-toolbar'));
  assert.ok(js.includes('#ag-enhancer-style') || js.includes("'ag-enhancer-style'"));
  assert.ok(js.includes('mountOpenIn'));

  execFileSync(process.execPath, ['--input-type=commonjs', '--check'], {
    input: 'const __AG_BOOT_PAYLOAD__ = {};\n' + js,
    stdio: ['pipe', 'pipe', 'pipe']
  });
});

test('Codebase enforces zero outbound network, zero SSH Remote, and zero updater/telemetry links', () => {
  assert.equal(fs.existsSync(path.join(ROOT_DIR, 'core', 'daemon', 'ssh-remote.mjs')), false);
  assert.equal(fs.existsSync(path.join(ROOT_DIR, 'core', 'daemon', 'updater.mjs')), false);

  const coreCodeFiles = walkAllFiles(path.join(ROOT_DIR, 'core')).filter(
    (f) => !f.endsWith('i18n.json') && !f.endsWith('manifest.json')
  );
  const allCodeFiles = [path.join(ROOT_DIR, 'install.mjs'), ...coreCodeFiles];
  const forbiddenEverywhere = [
    /\bfetch\s*\(/,
    /ssh-remote/i,
    /updater\.mjs/,
    /api\.github\.com/i,
    /raw\.githubusercontent\.com/i,
    /https?:\/\/x\.com/i,
    /__agOpenExternalUrl/,
    /__agCheckPluginUpdate/,
    /__agApplyPluginUpdate/,
    /ALLOWED_EXTERNAL_LINKS/,
    /codex-pure-white/,
    /codex-dark/
  ];
  const forbiddenInCore = [/sshHosts/, /themeVars/];

  const violations = [];
  for (const full of allCodeFiles) {
    const rel = path.relative(ROOT_DIR, full);
    const text = fs.readFileSync(full, 'utf8');
    const patterns = rel === 'install.mjs' ? forbiddenEverywhere : [...forbiddenEverywhere, ...forbiddenInCore];
    for (const pat of patterns) {
      if (pat.test(text)) {
        violations.push({ file: rel, pattern: String(pat) });
      }
    }
  }
  assert.deepEqual(violations, []);

  const readme = fs.readFileSync(path.join(ROOT_DIR, 'README.md'), 'utf8');
  assert.ok(readme.includes('https://github.com/Solonggg/antigravity-enhancer.git'));
  assert.ok(!readme.includes('<your-username>'));
});
