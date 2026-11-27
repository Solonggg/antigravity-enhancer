/**
 * core/daemon/updater.mjs — Cross-Platform GitHub Online Update Checker & Verified Hot-Updater
 *
 * Strictly pinned to https://github.com/Solonggg/antigravity-enhancer (main branch).
 * Zero external npm dependencies; works on macOS, Windows, and Linux without requiring git/tar/unzip.
 * Verifies every downloaded core/* file against remote core/manifest.json SHA-256 before swapping,
 * backs up core/ to backups/<stamp>/ and core.prev/, preserves user/* untouched, and triggers a
 * seamless detached daemon restart so the live Antigravity window hot-reloads without restarting.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ROOT_DIR, readLocalBaseVersion } from './paths.mjs';
import { stripUtf8Bom } from '../shared.mjs';
import { buildManifest, sha256File, verifyCoreIntegrity } from '../installer/manifest.mjs';
import { FEATURE_GROUPS } from '../installer/features.mjs';
import { SERVICE_IDS } from '../installer/service.mjs';

export const UPDATE_REPO = 'Solonggg/antigravity-enhancer';
export const UPDATE_BRANCH = 'main';
export const UPDATE_REPO_URL = `https://github.com/${UPDATE_REPO}`;
export const ALLOWED_UPDATE_HOSTS = Object.freeze(['raw.githubusercontent.com', 'api.github.com']);
export const ROOT_SYNC_FILES = Object.freeze(['package.json', 'install.mjs', 'README.md', 'SKILL.md', 'LICENSE']);
const REQUIRED_ROOT_FILES = new Set(['package.json', 'install.mjs']);

let updateInFlight = false;

export function assertAllowedUpdateUrl(urlStr) {
  let u;
  try {
    u = new URL(String(urlStr || ''));
  } catch {
    throw new Error(`Invalid update URL: ${urlStr}`);
  }
  if (u.protocol !== 'https:') {
    throw new Error(`Blocked non-HTTPS update URL: ${urlStr}`);
  }
  if (!ALLOWED_UPDATE_HOSTS.includes(u.hostname)) {
    throw new Error(`Blocked disallowed update host: ${u.hostname}`);
  }
  if (u.hostname === 'raw.githubusercontent.com') {
    const prefix = `/${UPDATE_REPO}/`;
    if (!u.pathname.startsWith(prefix)) {
      throw new Error(`Blocked disallowed raw repo path: ${u.pathname}`);
    }
  } else if (u.hostname === 'api.github.com') {
    const prefix = `/repos/${UPDATE_REPO}/`;
    if (!u.pathname.startsWith(prefix)) {
      throw new Error(`Blocked disallowed GitHub API path: ${u.pathname}`);
    }
  }
  return u;
}

export function assertSafeCoreRelPath(rel) {
  if (typeof rel !== 'string' || !rel || rel.length > 240) {
    throw new Error(`Invalid core relative path: ${String(rel)}`);
  }
  if (
    rel.startsWith('/') ||
    rel.startsWith('\\') ||
    rel.includes('\\') ||
    rel.includes('\0') ||
    rel.includes(':') ||
    rel === 'manifest.json'
  ) {
    throw new Error(`Unsafe core relative path: ${rel}`);
  }
  const parts = rel.split('/');
  for (const part of parts) {
    if (!part || part === '.' || part === '..') {
      throw new Error(`Path traversal segment in core path: ${rel}`);
    }
  }
  return rel;
}

export function parseSemver(raw) {
  const cleaned = String(raw || '')
    .trim()
    .replace(/^v/i, '')
    .replace(/-(?:stable|insiders)-[0-9a-f]+$/i, '')
    .replace(/-test$/i, '');
  const m = cleaned.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ? m[4].split('.') : []
  };
}

export function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  if (pa.major !== pb.major) return pa.major > pb.major ? 1 : -1;
  if (pa.minor !== pb.minor) return pa.minor > pb.minor ? 1 : -1;
  if (pa.patch !== pb.patch) return pa.patch > pb.patch ? 1 : -1;
  const aPre = pa.prerelease;
  const bPre = pb.prerelease;
  if (aPre.length === 0 && bPre.length === 0) return 0;
  if (aPre.length === 0) return 1;
  if (bPre.length === 0) return -1;
  const len = Math.max(aPre.length, bPre.length);
  for (let i = 0; i < len; i++) {
    if (i >= aPre.length) return -1;
    if (i >= bPre.length) return 1;
    const x = aPre[i];
    const y = bPre[i];
    if (x === y) continue;
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) return Number(x) > Number(y) ? 1 : -1;
    if (xNum) return -1;
    if (yNum) return 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

function sha256Buffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const item of fs.readdirSync(src)) {
    const s = path.join(src, item);
    const d = path.join(dest, item);
    const st = fs.statSync(s);
    if (st.isDirectory()) {
      copyDirRecursive(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

export function getLocalVersionInfo(rootDir = ROOT_DIR) {
  const manifestPath = path.join(rootDir, 'core', 'manifest.json');
  let manifest = null;
  try {
    if (fs.existsSync(manifestPath)) {
      manifest = JSON.parse(stripUtf8Bom(fs.readFileSync(manifestPath, 'utf8')));
    }
  } catch {}
  const version = readLocalBaseVersion(rootDir);
  return {
    rootDir,
    version,
    manifest
  };
}

function detectPrunedRelPaths(localManifest, rootDir) {
  const pruned = new Set();
  const localFiles = localManifest?.files && typeof localManifest.files === 'object' ? localManifest.files : null;
  if (!localFiles) return pruned;

  for (const meta of Object.values(FEATURE_GROUPS)) {
    const rels = Array.isArray(meta.coreRelPaths) ? meta.coreRelPaths : [];
    if (rels.length === 0) continue;
    const anyInManifest = rels.some((r) => Object.prototype.hasOwnProperty.call(localFiles, r));
    const anyOnDisk = rootDir ? rels.some((r) => fs.existsSync(path.join(rootDir, 'core', r))) : false;
    if (!anyInManifest && !anyOnDisk) {
      for (const r of rels) pruned.add(r);
    }
  }
  return pruned;
}

export function diffManifestUpdates(
  localManifest,
  remoteManifest,
  { rootDir = null, localVersion = null, excludedRelPaths = null } = {}
) {
  if (!remoteManifest || typeof remoteManifest !== 'object' || typeof remoteManifest.version !== 'string') {
    throw new Error('Invalid remote manifest: missing version');
  }
  if (!remoteManifest.files || typeof remoteManifest.files !== 'object' || Object.keys(remoteManifest.files).length === 0) {
    throw new Error('Invalid remote manifest: missing files map');
  }

  const effLocalVersion = localVersion || localManifest?.version || '0.0.0';
  const prunedSet = Array.isArray(excludedRelPaths)
    ? new Set(excludedRelPaths)
    : detectPrunedRelPaths(localManifest, rootDir);
  const localFiles = localManifest?.files && typeof localManifest.files === 'object' ? localManifest.files : {};

  const changedFiles = [];
  const manifestDiffFiles = [];
  const skippedPruned = [];
  const removedFiles = [];

  for (const [rel, rMeta] of Object.entries(remoteManifest.files)) {
    assertSafeCoreRelPath(rel);
    if (!rMeta || typeof rMeta.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(rMeta.sha256)) {
      throw new Error(`Invalid SHA-256 metadata in remote manifest for ${rel}`);
    }
    if (prunedSet.has(rel)) {
      skippedPruned.push(rel);
      continue;
    }
    const lMeta = localFiles[rel] || null;
    const manifestDiff = !lMeta || lMeta.sha256 !== rMeta.sha256;
    if (manifestDiff) {
      manifestDiffFiles.push(rel);
    }
    if (rootDir) {
      const diskPath = path.join(rootDir, 'core', rel);
      let needsDiskUpdate = true;
      try {
        if (fs.existsSync(diskPath) && sha256File(diskPath) === rMeta.sha256) {
          needsDiskUpdate = false;
        }
      } catch {}
      if (needsDiskUpdate) {
        changedFiles.push(rel);
      }
    } else if (manifestDiff) {
      changedFiles.push(rel);
    }
  }

  for (const rel of Object.keys(localFiles)) {
    if (!Object.prototype.hasOwnProperty.call(remoteManifest.files, rel)) {
      assertSafeCoreRelPath(rel);
      removedFiles.push(rel);
    }
  }

  const semverCmp = compareSemver(remoteManifest.version, effLocalVersion);
  let reason = 'up_to_date';
  let updateAvailable = false;
  if (semverCmp > 0) {
    reason = 'new_version';
    updateAvailable = true;
  } else if (semverCmp < 0) {
    reason = 'ahead';
    updateAvailable = false;
  } else if (manifestDiffFiles.length > 0 || removedFiles.length > 0) {
    reason = 'hotfix';
    updateAvailable = true;
  }

  return {
    localVersion: effLocalVersion,
    remoteVersion: remoteManifest.version,
    semverCmp,
    updateAvailable,
    reason,
    changedFiles: changedFiles.sort((a, b) => a.localeCompare(b)),
    manifestDiffFiles: manifestDiffFiles.sort((a, b) => a.localeCompare(b)),
    removedFiles: removedFiles.sort((a, b) => a.localeCompare(b)),
    skippedPruned: skippedPruned.sort((a, b) => a.localeCompare(b))
  };
}

async function fetchUrlBuffer(urlStr, { fetchImpl = globalThis.fetch, timeoutMs = 15000, headers = {} } = {}) {
  assertAllowedUpdateUrl(urlStr);
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch API is unavailable in this Node runtime');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
  try {
    const res = await fetchImpl(urlStr, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'antigravity-enhancer-updater',
        'Cache-Control': 'no-cache',
        ...headers
      }
    });
    if (res.url) {
      assertAllowedUpdateUrl(res.url);
    }
    const arrBuf = await res.arrayBuffer();
    const buffer = Buffer.from(arrBuf);
    return { ok: Boolean(res.ok), status: Number(res.status || 0), buffer };
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchLatestCommitMeta({ fetchImpl = globalThis.fetch, timeoutMs = 4500 } = {}) {
  const apiUrl = `https://api.github.com/repos/${UPDATE_REPO}/commits/${UPDATE_BRANCH}`;
  try {
    const res = await fetchUrlBuffer(apiUrl, {
      fetchImpl,
      timeoutMs,
      headers: { Accept: 'application/vnd.github+json' }
    });
    if (!res.ok) return null;
    const data = JSON.parse(res.buffer.toString('utf8'));
    const sha = typeof data?.sha === 'string' ? data.sha.trim() : '';
    if (!/^[0-9a-f]{40}$/i.test(sha)) return null;
    const firstLine = String(data?.commit?.message || '')
      .split(/\r?\n/)[0]
      .trim()
      .slice(0, 120);
    const date = String(data?.commit?.committer?.date || data?.commit?.author?.date || '').trim();
    return {
      sha,
      shortSha: sha.slice(0, 7),
      message: firstLine,
      date
    };
  } catch {
    return null;
  }
}

function buildRawFileUrl(ref, repoRelPath) {
  const cleanRel = String(repoRelPath || '').replace(/^\/+/, '');
  const base = `https://raw.githubusercontent.com/${UPDATE_REPO}/${ref}/${cleanRel}`;
  return ref === UPDATE_BRANCH ? `${base}?t=${Date.now()}` : base;
}

export async function checkForUpdates({
  rootDir = ROOT_DIR,
  fetchImpl = globalThis.fetch,
  timeoutMs = 12000
} = {}) {
  const localInfo = getLocalVersionInfo(rootDir);
  try {
    const commitMeta = await fetchLatestCommitMeta({
      fetchImpl,
      timeoutMs: Math.min(4500, timeoutMs)
    });
    const ref = commitMeta?.sha || UPDATE_BRANCH;
    const manifestUrl = buildRawFileUrl(ref, 'core/manifest.json');
    const res = await fetchUrlBuffer(manifestUrl, { fetchImpl, timeoutMs });
    if (!res.ok) {
      return {
        ok: false,
        repo: UPDATE_REPO,
        branch: UPDATE_BRANCH,
        repoUrl: UPDATE_REPO_URL,
        localVersion: localInfo.version,
        error: `GitHub manifest fetch failed (HTTP ${res.status})`
      };
    }

    let remoteManifest;
    try {
      remoteManifest = JSON.parse(stripUtf8Bom(res.buffer.toString('utf8')));
    } catch {
      return {
        ok: false,
        repo: UPDATE_REPO,
        branch: UPDATE_BRANCH,
        repoUrl: UPDATE_REPO_URL,
        localVersion: localInfo.version,
        error: 'Remote core/manifest.json is not valid JSON'
      };
    }

    if (remoteManifest?.name && remoteManifest.name !== 'antigravity-enhancer') {
      return {
        ok: false,
        repo: UPDATE_REPO,
        branch: UPDATE_BRANCH,
        repoUrl: UPDATE_REPO_URL,
        localVersion: localInfo.version,
        error: `Unexpected remote package name: ${remoteManifest.name}`
      };
    }

    const diff = diffManifestUpdates(localInfo.manifest, remoteManifest, {
      rootDir,
      localVersion: localInfo.version
    });

    return {
      ok: true,
      repo: UPDATE_REPO,
      branch: UPDATE_BRANCH,
      repoUrl: UPDATE_REPO_URL,
      ref,
      localVersion: diff.localVersion,
      remoteVersion: diff.remoteVersion,
      semverCmp: diff.semverCmp,
      updateAvailable: diff.updateAvailable,
      reason: diff.reason,
      changedFiles: diff.changedFiles,
      manifestDiffFiles: diff.manifestDiffFiles,
      removedFiles: diff.removedFiles,
      skippedPruned: diff.skippedPruned,
      changedCount: diff.changedFiles.length + diff.removedFiles.length,
      commitSha: commitMeta?.shortSha || '',
      commitFullSha: commitMeta?.sha || '',
      commitMessage: commitMeta?.message || '',
      commitDate: commitMeta?.date || '',
      checkedAt: new Date().toISOString(),
      remoteManifest
    };
  } catch (err) {
    return {
      ok: false,
      repo: UPDATE_REPO,
      branch: UPDATE_BRANCH,
      repoUrl: UPDATE_REPO_URL,
      localVersion: localInfo.version,
      error: err?.message || String(err || 'Update check failed')
    };
  }
}

export function stripInternalUpdatePayload(res) {
  if (!res || typeof res !== 'object') return res;
  const { remoteManifest: _omit, ...publicFields } = res;
  return publicFields;
}

async function runPool(items, concurrency, worker) {
  const queue = items.slice();
  const limit = Math.max(1, Math.min(concurrency, queue.length || 1));
  const workers = Array.from({ length: limit }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      await worker(item);
    }
  });
  await Promise.all(workers);
}

export function scheduleDaemonRestart(rootDir = ROOT_DIR, { delayMs = 350 } = {}) {
  const realDaemon = path.join(rootDir, 'core', 'daemon.mjs');
  const serviceModPath = path.join(rootDir, 'core', 'installer', 'service.mjs');
  const wrapperDaemon = path.join(os.homedir(), '.gemini', 'antigravity', 'scripts', SERVICE_IDS.wrapperFileName);
  const serviceModUrl = pathToFileURL(serviceModPath).href;
  const helperCode = `
    setTimeout(async () => {
      try {
        const svc = await import(${JSON.stringify(serviceModUrl)});
        if (typeof svc.restartSystemService === 'function') {
          svc.restartSystemService(${JSON.stringify(rootDir)}, ${JSON.stringify(realDaemon)}, ${JSON.stringify(wrapperDaemon)});
        }
      } catch {}
      process.exit(0);
    }, ${Math.max(100, Number(delayMs) || 350)});
  `;
  const child = spawn(
    process.execPath,
    ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', helperCode],
    {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    }
  );
  child.unref();
  return { scheduled: true, pid: child.pid || null };
}

export async function applyHotUpdate({
  rootDir = ROOT_DIR,
  fetchImpl = globalThis.fetch,
  timeoutMs = 20000,
  force = false,
  onScheduleRestart = null
} = {}) {
  if (updateInFlight) {
    return {
      ok: false,
      inProgress: true,
      error: 'An update is already in progress'
    };
  }
  updateInFlight = true;
  let stagingDir = null;
  try {
    const check = await checkForUpdates({ rootDir, fetchImpl, timeoutMs });
    if (!check.ok) {
      return stripInternalUpdatePayload(check);
    }

    if (!force && !check.updateAvailable) {
      return {
        ok: true,
        updated: false,
        upToDate: true,
        repo: check.repo,
        repoUrl: check.repoUrl,
        fromVersion: check.localVersion,
        toVersion: check.remoteVersion,
        reason: check.reason,
        commitSha: check.commitSha,
        commitMessage: check.commitMessage,
        changedCount: 0
      };
    }

    const remoteManifest = check.remoteManifest;
    const ref = check.ref || UPDATE_BRANCH;
    stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-enhancer-update-'));
    const stagingCore = path.join(stagingDir, 'core');
    fs.mkdirSync(stagingCore, { recursive: true });

    // 1. Download & SHA-256 verify all changed core/* files into isolated staging directory
    await runPool(check.changedFiles, 4, async (rel) => {
      assertSafeCoreRelPath(rel);
      const expectedMeta = remoteManifest.files[rel];
      const fileUrl = buildRawFileUrl(ref, `core/${rel}`);
      const res = await fetchUrlBuffer(fileUrl, { fetchImpl, timeoutMs });
      if (!res.ok) {
        throw new Error(`Failed to download core/${rel} (HTTP ${res.status})`);
      }
      const actualSha = sha256Buffer(res.buffer);
      if (actualSha !== expectedMeta.sha256) {
        throw new Error(
          `SHA-256 verification failed for core/${rel} (expected ${expectedMeta.sha256.slice(0, 12)}, got ${actualSha.slice(0, 12)})`
        );
      }
      if (Number.isFinite(expectedMeta.bytes) && res.buffer.length !== expectedMeta.bytes) {
        throw new Error(
          `Byte length mismatch for core/${rel} (expected ${expectedMeta.bytes}B, got ${res.buffer.length}B)`
        );
      }
      if (rel.endsWith('.json')) {
        try {
          JSON.parse(stripUtf8Bom(res.buffer.toString('utf8')));
        } catch {
          throw new Error(`Invalid JSON payload in downloaded core/${rel}`);
        }
      }
      const destPath = path.join(stagingCore, rel);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, res.buffer);
    });

    // 2. Download root files (package.json & install.mjs required; docs best-effort)
    const stagedRootFiles = [];
    for (const rootFile of ROOT_SYNC_FILES) {
      const fileUrl = buildRawFileUrl(ref, rootFile);
      let res;
      try {
        res = await fetchUrlBuffer(fileUrl, { fetchImpl, timeoutMs });
      } catch (err) {
        if (REQUIRED_ROOT_FILES.has(rootFile)) {
          throw new Error(`Failed to download ${rootFile}: ${err?.message || err}`);
        }
        continue;
      }
      if (!res.ok) {
        if (REQUIRED_ROOT_FILES.has(rootFile)) {
          throw new Error(`Failed to download ${rootFile} (HTTP ${res.status})`);
        }
        continue;
      }
      if (rootFile === 'package.json') {
        let pkg;
        try {
          pkg = JSON.parse(stripUtf8Bom(res.buffer.toString('utf8')));
        } catch {
          throw new Error('Downloaded package.json is not valid JSON');
        }
        if (pkg?.name !== 'antigravity-enhancer' || pkg?.version !== remoteManifest.version) {
          throw new Error(
            `Downloaded package.json version (${pkg?.version}) does not match remote manifest (${remoteManifest.version})`
          );
        }
      } else if (rootFile === 'install.mjs') {
        const text = res.buffer.toString('utf8');
        if (!text.includes('antigravity-enhancer')) {
          throw new Error('Downloaded install.mjs failed sanity check');
        }
      }
      const stagedPath = path.join(stagingDir, rootFile);
      fs.writeFileSync(stagedPath, res.buffer);
      stagedRootFiles.push(rootFile);
    }

    // 3. Back up current core/ (compatible with `node install.mjs rollback`); never touch user/
    const targetCore = path.join(rootDir, 'core');
    const targetPrev = path.join(rootDir, 'core.prev');
    const backupsDir = path.join(rootDir, 'backups');
    let backupDir = null;
    if (fs.existsSync(targetCore)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      backupDir = path.join(backupsDir, stamp);
      fs.mkdirSync(backupsDir, { recursive: true });
      copyDirRecursive(targetCore, backupDir);
      fs.rmSync(targetPrev, { recursive: true, force: true });
      copyDirRecursive(targetCore, targetPrev);
    }

    // 4. Apply verified staged files into rootDir
    try {
      for (const rel of check.changedFiles) {
        const srcPath = path.join(stagingCore, rel);
        const dstPath = path.join(targetCore, rel);
        fs.mkdirSync(path.dirname(dstPath), { recursive: true });
        fs.copyFileSync(srcPath, dstPath);
      }
      for (const rel of check.removedFiles) {
        const dstPath = path.join(targetCore, rel);
        if (fs.existsSync(dstPath)) {
          fs.rmSync(dstPath, { force: true });
        }
      }
      for (const rootFile of stagedRootFiles) {
        fs.copyFileSync(path.join(stagingDir, rootFile), path.join(rootDir, rootFile));
      }

      if (check.skippedPruned.length > 0) {
        buildManifest(rootDir);
      } else {
        fs.writeFileSync(path.join(targetCore, 'manifest.json'), JSON.stringify(remoteManifest, null, 2) + '\n', 'utf8');
      }

      const integrity = verifyCoreIntegrity(rootDir);
      if (!integrity.ok) {
        throw new Error(`Post-update integrity check failed (${integrity.modified.length} file issue(s))`);
      }
    } catch (applyErr) {
      // Automatic rollback if apply or post-verification failed
      if (fs.existsSync(targetPrev)) {
        try {
          fs.rmSync(targetCore, { recursive: true, force: true });
          copyDirRecursive(targetPrev, targetCore);
        } catch {}
      }
      return {
        ok: false,
        updated: false,
        rolledBack: fs.existsSync(targetPrev),
        fromVersion: check.localVersion,
        toVersion: check.remoteVersion,
        error: applyErr?.message || String(applyErr || 'Apply failed')
      };
    }

    const daemonFilesChanged =
      check.changedFiles.some((rel) => rel === 'daemon.mjs' || rel === 'shared.mjs' || rel.startsWith('daemon/') || rel.startsWith('installer/')) ||
      check.removedFiles.some((rel) => rel.startsWith('daemon/'));

    if (typeof onScheduleRestart === 'function') {
      try {
        onScheduleRestart({
          rootDir,
          fromVersion: check.localVersion,
          toVersion: check.remoteVersion,
          daemonFilesChanged
        });
      } catch {}
    }

    return {
      ok: true,
      updated: true,
      restarting: typeof onScheduleRestart === 'function',
      daemonFilesChanged,
      repo: check.repo,
      repoUrl: check.repoUrl,
      fromVersion: check.localVersion,
      toVersion: check.remoteVersion,
      changedCount: check.changedFiles.length + check.removedFiles.length,
      updatedFiles: check.changedFiles,
      removedFiles: check.removedFiles,
      backupDir,
      commitSha: check.commitSha,
      commitMessage: check.commitMessage
    };
  } catch (err) {
    return {
      ok: false,
      updated: false,
      error: err?.message || String(err || 'Hot update failed')
    };
  } finally {
    updateInFlight = false;
    if (stagingDir) {
      try {
        fs.rmSync(stagingDir, { recursive: true, force: true });
      } catch {}
    }
  }
}
