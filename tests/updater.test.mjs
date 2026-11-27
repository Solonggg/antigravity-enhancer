/**
 * tests/updater.test.mjs — Online GitHub Update Check, SHA-256 Verification, Hot-Update & Version Sync Tests
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  UPDATE_REPO,
  assertAllowedUpdateUrl,
  assertSafeCoreRelPath,
  parseSemver,
  compareSemver,
  diffManifestUpdates,
  checkForUpdates,
  applyHotUpdate,
  stripInternalUpdatePayload
} from '../core/daemon/updater.mjs';
import { readLocalBaseVersion } from '../core/daemon/paths.mjs';
import { buildManifest, verifyCoreIntegrity } from '../core/installer/manifest.mjs';

function sha256Text(text) {
  return crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}

function makeMockResponse(body, { status = 200, url = '' } = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    async arrayBuffer() {
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    }
  };
}

function createFakeInstallDir({ version = '0.2.0', coreFiles = {}, userFiles = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-updater-test-'));
  fs.mkdirSync(path.join(dir, 'core'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'user'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'antigravity-enhancer', version, type: 'module' }, null, 2) + '\n',
    'utf8'
  );
  fs.writeFileSync(path.join(dir, 'install.mjs'), '// antigravity-enhancer installer v' + version + '\n', 'utf8');

  for (const [rel, content] of Object.entries(coreFiles)) {
    const full = path.join(dir, 'core', rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  }
  for (const [rel, content] of Object.entries(userFiles)) {
    const full = path.join(dir, 'user', rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  }
  buildManifest(dir);
  return dir;
}

test('parseSemver and compareSemver handle release tags, channel hashes, and prereleases', () => {
  assert.deepEqual(parseSemver('v0.2.0-stable-96190548'), { major: 0, minor: 2, patch: 0, prerelease: [] });
  assert.deepEqual(parseSemver('1.3.4-beta.2'), { major: 1, minor: 3, patch: 4, prerelease: ['beta', '2'] });

  assert.equal(compareSemver('0.2.0', '0.1.1'), 1);
  assert.equal(compareSemver('0.2.0', '0.2.0-stable-abcdef12'), 0);
  assert.equal(compareSemver('0.2.1', '0.2.0'), 1);
  assert.equal(compareSemver('0.2.0', '0.2.1'), -1);
  assert.equal(compareSemver('0.2.0', '0.2.0-rc.1'), 1);
  assert.equal(compareSemver('0.2.0-rc.2', '0.2.0-rc.1'), 1);
  assert.equal(compareSemver('1.0.0', '0.9.99'), 1);
});

test('assertAllowedUpdateUrl and assertSafeCoreRelPath block non-pinned hosts and path traversal', () => {
  assert.doesNotThrow(() =>
    assertAllowedUpdateUrl(`https://raw.githubusercontent.com/${UPDATE_REPO}/main/core/manifest.json`)
  );
  assert.doesNotThrow(() =>
    assertAllowedUpdateUrl(`https://api.github.com/repos/${UPDATE_REPO}/commits/main`)
  );

  assert.throws(() => assertAllowedUpdateUrl(`http://raw.githubusercontent.com/${UPDATE_REPO}/main/core/manifest.json`), /HTTPS/);
  assert.throws(() => assertAllowedUpdateUrl('https://evil.example.com/core/manifest.json'), /host/);
  assert.throws(() => assertAllowedUpdateUrl('https://raw.githubusercontent.com/OtherUser/antigravity-enhancer/main/core/manifest.json'), /path/);
  assert.throws(() => assertAllowedUpdateUrl('https://api.github.com/repos/OtherUser/antigravity-enhancer/commits/main'), /path/);

  assert.equal(assertSafeCoreRelPath('daemon/updater.mjs'), 'daemon/updater.mjs');
  assert.throws(() => assertSafeCoreRelPath('../user/config.json'), /traversal/i);
  assert.throws(() => assertSafeCoreRelPath('/etc/passwd'), /Unsafe/);
  assert.throws(() => assertSafeCoreRelPath('daemon\\evil.mjs'), /Unsafe/);
  assert.throws(() => assertSafeCoreRelPath('manifest.json'), /Unsafe/);
});

test('diffManifestUpdates distinguishes new_version, hotfix, ahead, up_to_date, and respects minimal pruned features', () => {
  const baseFile = 'console.log("base");\n';
  const openInFile = 'console.log("openin");\n';
  const localManifest = {
    name: 'antigravity-enhancer',
    version: '0.2.0',
    files: {
      'daemon.mjs': { sha256: sha256Text(baseFile), bytes: Buffer.byteLength(baseFile) },
      'runtime/00-head.js': { sha256: sha256Text(baseFile), bytes: Buffer.byteLength(baseFile) }
    }
  };
  const remoteSameHotfix = {
    name: 'antigravity-enhancer',
    version: '0.2.0',
    files: {
      'daemon.mjs': { sha256: sha256Text(baseFile + '// fix\n'), bytes: Buffer.byteLength(baseFile + '// fix\n') },
      'runtime/00-head.js': { sha256: sha256Text(baseFile), bytes: Buffer.byteLength(baseFile) },
      // openIn group is completely absent locally -> should be skipped as pruned
      'daemon/open-in.mjs': { sha256: sha256Text(openInFile), bytes: Buffer.byteLength(openInFile) },
      'runtime/65-open-in.js': { sha256: sha256Text(openInFile), bytes: Buffer.byteLength(openInFile) },
      'styles/42-open-in.css': { sha256: sha256Text(openInFile), bytes: Buffer.byteLength(openInFile) }
    }
  };

  const hotfixDiff = diffManifestUpdates(localManifest, remoteSameHotfix, { localVersion: '0.2.0' });
  assert.equal(hotfixDiff.updateAvailable, true);
  assert.equal(hotfixDiff.reason, 'hotfix');
  assert.deepEqual(hotfixDiff.changedFiles, ['daemon.mjs']);
  assert.deepEqual(hotfixDiff.skippedPruned, ['daemon/open-in.mjs', 'runtime/65-open-in.js', 'styles/42-open-in.css']);

  const aheadDiff = diffManifestUpdates(localManifest, { ...localManifest, version: '0.1.9' }, { localVersion: '0.2.0' });
  assert.equal(aheadDiff.updateAvailable, false);
  assert.equal(aheadDiff.reason, 'ahead');

  const upToDateDiff = diffManifestUpdates(localManifest, localManifest, { localVersion: '0.2.0' });
  assert.equal(upToDateDiff.updateAvailable, false);
  assert.equal(upToDateDiff.reason, 'up_to_date');
});

test('checkForUpdates pins commit SHA when GitHub API succeeds and falls back to main when API returns 403', async () => {
  const dir = createFakeInstallDir({
    version: '0.2.0',
    coreFiles: {
      'daemon.mjs': 'console.log("v0.2.0");\n',
      'runtime/00-head.js': 'const V = "0.2.0";\n'
    }
  });
  try {
    const newDaemon = 'console.log("v0.3.0");\n';
    const remoteManifest = {
      name: 'antigravity-enhancer',
      version: '0.3.0',
      files: {
        'daemon.mjs': { sha256: sha256Text(newDaemon), bytes: Buffer.byteLength(newDaemon) },
        'runtime/00-head.js': { sha256: sha256Text('const V = "0.2.0";\n'), bytes: Buffer.byteLength('const V = "0.2.0";\n') }
      }
    };

    const commitSha = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
    const requestedUrls = [];
    const fetchWithApi = async (url) => {
      requestedUrls.push(url);
      if (url.includes('api.github.com')) {
        return makeMockResponse({
          sha: commitSha,
          commit: { message: 'feat: release 0.3.0\n\nbody', committer: { date: '2026-11-27T10:00:00Z' } }
        }, { url });
      }
      if (url.includes(`/${commitSha}/core/manifest.json`)) {
        return makeMockResponse(remoteManifest, { url });
      }
      return makeMockResponse('not found', { status: 404, url });
    };

    const res = await checkForUpdates({ rootDir: dir, fetchImpl: fetchWithApi });
    assert.equal(res.ok, true);
    assert.equal(res.updateAvailable, true);
    assert.equal(res.reason, 'new_version');
    assert.equal(res.localVersion, '0.2.0');
    assert.equal(res.remoteVersion, '0.3.0');
    assert.equal(res.commitSha, 'a1b2c3d');
    assert.equal(res.commitMessage, 'feat: release 0.3.0');
    assert.deepEqual(res.changedFiles, ['daemon.mjs']);
    assert.ok(requestedUrls.some((u) => u.includes(`/${commitSha}/core/manifest.json`)));

    const stripped = stripInternalUpdatePayload(res);
    assert.equal(stripped.remoteManifest, undefined);
    assert.equal(stripped.remoteVersion, '0.3.0');

    // Fallback when GitHub API returns 403 rate limit
    const fallbackUrls = [];
    const fetchRateLimited = async (url) => {
      fallbackUrls.push(url);
      if (url.includes('api.github.com')) {
        return makeMockResponse({ message: 'API rate limit exceeded' }, { status: 403, url });
      }
      if (url.includes('/main/core/manifest.json')) {
        return makeMockResponse(remoteManifest, { url });
      }
      return makeMockResponse('not found', { status: 404, url });
    };
    const resFallback = await checkForUpdates({ rootDir: dir, fetchImpl: fetchRateLimited });
    assert.equal(resFallback.ok, true);
    assert.equal(resFallback.updateAvailable, true);
    assert.equal(resFallback.ref, 'main');
    assert.equal(resFallback.commitSha, '');
    assert.ok(fallbackUrls.some((u) => u.includes('/main/core/manifest.json')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('applyHotUpdate downloads only changed files, verifies SHA-256, backs up core.prev, preserves user/*, and calls restart hook', async () => {
  const unchangedText = 'const KEEP = true;\n';
  const oldDaemonText = 'console.log("old-daemon");\n';
  const oldRemovedText = 'console.log("obsolete");\n';
  const userCfgText = JSON.stringify({ enabled: true, modules: { i18n: true } }, null, 2) + '\n';
  const userCssText = '/* my custom css */\n';

  const dir = createFakeInstallDir({
    version: '0.2.0',
    coreFiles: {
      'daemon.mjs': oldDaemonText,
      'runtime/00-head.js': unchangedText,
      'runtime/old-unused.js': oldRemovedText
    },
    userFiles: {
      'config.json': userCfgText,
      'custom.css': userCssText
    }
  });

  try {
    const newDaemonText = 'console.log("new-daemon-0.2.1");\n';
    const newFeatureText = 'export const added = 1;\n';
    const remoteManifest = {
      name: 'antigravity-enhancer',
      version: '0.2.1',
      minNodeVersion: '22.13.0',
      fullMetricsNodeVersion: '22.13.0',
      files: {
        'daemon.mjs': { sha256: sha256Text(newDaemonText), bytes: Buffer.byteLength(newDaemonText) },
        'runtime/00-head.js': { sha256: sha256Text(unchangedText), bytes: Buffer.byteLength(unchangedText) },
        'daemon/new-helper.mjs': { sha256: sha256Text(newFeatureText), bytes: Buffer.byteLength(newFeatureText) }
      }
    };
    const remoteFiles = {
      'core/manifest.json': JSON.stringify(remoteManifest, null, 2) + '\n',
      'core/daemon.mjs': newDaemonText,
      'core/daemon/new-helper.mjs': newFeatureText,
      'package.json': JSON.stringify({ name: 'antigravity-enhancer', version: '0.2.1', type: 'module' }, null, 2) + '\n',
      'install.mjs': '// antigravity-enhancer installer v0.2.1\n'
    };

    const fetchedPaths = [];
    const mockFetch = async (url) => {
      if (url.includes('api.github.com')) {
        return makeMockResponse({ status: 403 }, { status: 403, url });
      }
      const m = url.match(/raw\.githubusercontent\.com\/Solonggg\/antigravity-enhancer\/main\/([^?]+)/);
      const rel = m ? m[1] : '';
      fetchedPaths.push(rel);
      if (Object.prototype.hasOwnProperty.call(remoteFiles, rel)) {
        return makeMockResponse(remoteFiles[rel], { url });
      }
      return makeMockResponse('not found', { status: 404, url });
    };

    let restartCalledWith = null;
    const res = await applyHotUpdate({
      rootDir: dir,
      fetchImpl: mockFetch,
      onScheduleRestart: (info) => {
        restartCalledWith = info;
      }
    });

    assert.equal(res.ok, true, `Expected update ok, got: ${JSON.stringify(res)}`);
    assert.equal(res.updated, true);
    assert.equal(res.fromVersion, '0.2.0');
    assert.equal(res.toVersion, '0.2.1');
    assert.equal(res.daemonFilesChanged, true);
    assert.deepEqual(res.updatedFiles, ['daemon.mjs', 'daemon/new-helper.mjs']);
    assert.deepEqual(res.removedFiles, ['runtime/old-unused.js']);
    assert.ok(!fetchedPaths.includes('core/runtime/00-head.js'), 'unchanged core file must not be re-downloaded');

    // Verify files applied cleanly and old removed file deleted
    assert.equal(fs.readFileSync(path.join(dir, 'core', 'daemon.mjs'), 'utf8'), newDaemonText);
    assert.equal(fs.readFileSync(path.join(dir, 'core', 'daemon', 'new-helper.mjs'), 'utf8'), newFeatureText);
    assert.equal(fs.existsSync(path.join(dir, 'core', 'runtime', 'old-unused.js')), false);
    assert.equal(readLocalBaseVersion(dir), '0.2.1');

    // Verify core integrity passes cleanly post-update
    const integrity = verifyCoreIntegrity(dir);
    assert.equal(integrity.ok, true, `Post-update integrity failed: ${JSON.stringify(integrity.modified)}`);

    // Verify backup & rollback source created
    assert.ok(fs.existsSync(path.join(dir, 'core.prev', 'daemon.mjs')));
    assert.equal(fs.readFileSync(path.join(dir, 'core.prev', 'daemon.mjs'), 'utf8'), oldDaemonText);
    assert.ok(res.backupDir && fs.existsSync(path.join(res.backupDir, 'daemon.mjs')));

    // Verify user/* untouched byte-for-byte
    assert.equal(fs.readFileSync(path.join(dir, 'user', 'config.json'), 'utf8'), userCfgText);
    assert.equal(fs.readFileSync(path.join(dir, 'user', 'custom.css'), 'utf8'), userCssText);

    // Verify restart hook invoked
    assert.deepEqual(restartCalledWith, {
      rootDir: dir,
      fromVersion: '0.2.0',
      toVersion: '0.2.1',
      daemonFilesChanged: true
    });

    // Running applyHotUpdate again should report upToDate without modifying backups or restarting
    let secondRestart = false;
    const res2 = await applyHotUpdate({
      rootDir: dir,
      fetchImpl: mockFetch,
      onScheduleRestart: () => {
        secondRestart = true;
      }
    });
    assert.equal(res2.ok, true);
    assert.equal(res2.updated, false);
    assert.equal(res2.upToDate, true);
    assert.equal(secondRestart, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('applyHotUpdate aborts with zero changes when downloaded file fails SHA-256 verification', async () => {
  const originalDaemon = 'console.log("safe-original");\n';
  const dir = createFakeInstallDir({
    version: '0.2.0',
    coreFiles: { 'daemon.mjs': originalDaemon }
  });
  try {
    const expectedNew = 'console.log("expected-0.2.5");\n';
    const tamperedNew = 'console.log("TAMPERED-0.2.5");\n';
    const remoteManifest = {
      name: 'antigravity-enhancer',
      version: '0.2.5',
      files: {
        'daemon.mjs': { sha256: sha256Text(expectedNew), bytes: Buffer.byteLength(expectedNew) }
      }
    };
    const mockFetch = async (url) => {
      if (url.includes('api.github.com')) return makeMockResponse({}, { status: 403, url });
      if (url.includes('core/manifest.json')) return makeMockResponse(remoteManifest, { url });
      if (url.includes('core/daemon.mjs')) return makeMockResponse(tamperedNew, { url });
      if (url.includes('package.json')) return makeMockResponse({ name: 'antigravity-enhancer', version: '0.2.5' }, { url });
      return makeMockResponse('not found', { status: 404, url });
    };

    const res = await applyHotUpdate({ rootDir: dir, fetchImpl: mockFetch });
    assert.equal(res.ok, false);
    assert.equal(res.updated, false);
    assert.match(res.error, /SHA-256 verification failed/);
    assert.equal(fs.readFileSync(path.join(dir, 'core', 'daemon.mjs'), 'utf8'), originalDaemon);
    assert.equal(readLocalBaseVersion(dir), '0.2.0');
    assert.equal(fs.existsSync(path.join(dir, 'core.prev')), false, 'must not create backup or mutate dir on failed staging');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
