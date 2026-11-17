/**
 * antigravity-codex-theme · Shared Runtime & Installer Utilities (core/shared.mjs)
 */
import fs from 'node:fs';
import http from 'node:http';
import { spawnSync } from 'node:child_process';

export const DEFAULT_ALLOWED_ORIGINS = [
  'http://127.0.0.1',
  'https://127.0.0.1',
  'http://localhost',
  'https://localhost',
  'vscode-file://'
];

export function isAllowedOrigin(urlStr, allowedOrigins = DEFAULT_ALLOWED_ORIGINS) {
  if (!urlStr || typeof urlStr !== 'string') return false;
  const origins = Array.isArray(allowedOrigins) ? allowedOrigins : DEFAULT_ALLOWED_ORIGINS;
  return origins.some((prefix) => urlStr.startsWith(prefix));
}

export function readPortFromFile(portFile) {
  try {
    const raw = fs.readFileSync(portFile, 'utf8').trim();
    const lines = raw.split(/\r?\n/);
    const port = parseInt(lines[0], 10);
    return Number.isFinite(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

export function fetchTargetsFromPort(port, timeoutMs = 450) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/json/list', timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve([]);
        }
      });
    });
    req.on('error', () => resolve([]));
    req.on('timeout', () => {
      req.destroy();
      resolve([]);
    });
  });
}

function skipJsoncTrivia(raw, startIdx) {
  let k = startIdx;
  const len = raw.length;
  while (k < len) {
    if (/\s/.test(raw[k])) {
      k++;
    } else if (raw[k] === '/' && raw[k + 1] === '/') {
      k += 2;
      while (k < len && raw[k] !== '\n') k++;
    } else if (raw[k] === '/' && raw[k + 1] === '*') {
      k += 2;
      while (k + 1 < len && !(raw[k] === '*' && raw[k + 1] === '/')) k++;
      k += 2;
    } else {
      break;
    }
  }
  return k;
}

export function inspectJsoncRootObject(raw, targetProp = 'remote-debugging-port') {
  let i = 0;
  const len = raw.length;
  let depth = 0;
  let openBraceIdx = -1;
  let closeBraceIdx = -1;
  let hasTopProps = false;
  let hasRemoteDebuggingPort = false;
  let targetIntValue = null;

  while (i < len) {
    const ch = raw[i];
    const next = i + 1 < len ? raw[i + 1] : '';

    if (ch === '/' && next === '/') {
      i += 2;
      while (i < len && raw[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i + 1 < len && !(raw[i] === '*' && raw[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (ch === '"') {
      i++;
      let val = '';
      while (i < len) {
        if (raw[i] === '\\') {
          val += raw.slice(i, i + 2);
          i += 2;
          continue;
        }
        if (raw[i] === '"') {
          i++;
          break;
        }
        val += raw[i++];
      }
      if (depth === 1 && openBraceIdx !== -1 && closeBraceIdx === -1) {
        hasTopProps = true;
        if (val === targetProp) {
          const k = skipJsoncTrivia(raw, i);
          if (raw[k] === ':') {
            hasRemoteDebuggingPort = true;
            const vStart = skipJsoncTrivia(raw, k + 1);
            const numMatch = raw.slice(vStart).match(/^(\d+)/);
            if (numMatch) {
              const parsed = parseInt(numMatch[1], 10);
              if (Number.isFinite(parsed) && parsed > 0) {
                targetIntValue = parsed;
              }
            }
          }
        }
      }
      continue;
    }

    if (ch === '{') {
      if (depth === 0 && openBraceIdx === -1) {
        openBraceIdx = i;
      }
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && openBraceIdx !== -1 && closeBraceIdx === -1) {
        closeBraceIdx = i;
      }
    } else if (depth === 1 && openBraceIdx !== -1 && closeBraceIdx === -1 && !/\s/.test(ch)) {
      hasTopProps = true;
    }
    i++;
  }

  return {
    openBraceIdx,
    closeBraceIdx,
    hasTopProps,
    hasRemoteDebuggingPort,
    targetIntValue
  };
}

export function extractJsoncNumberProperty(raw, propName = 'remote-debugging-port') {
  if (!raw || typeof raw !== 'string') return null;
  return inspectJsoncRootObject(raw, propName).targetIntValue;
}

export function isConfirmedDaemonPid(pid, extraPatterns = []) {
  if (!pid || pid <= 0 || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  if (process.platform === 'win32') {
    try {
      const res = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
        windowsHide: true,
        encoding: 'utf8',
        timeout: 1500
      });
      const out = String(res.stdout || '').toLowerCase();
      return out.includes('node.exe');
    } catch {
      return false;
    }
  }
  try {
    const res = spawnSync('ps', ['-p', String(pid), '-o', 'args='], {
      encoding: 'utf8',
      timeout: 1500
    });
    if (res.error || res.status !== 0) return false;
    const argsOut = String(res.stdout || '');
    return (
      argsOut.includes('daemon.mjs') ||
      argsOut.includes('antigravity-codex-daemon.mjs') ||
      extraPatterns.some((pat) => pat && argsOut.includes(pat))
    );
  } catch {
    return false;
  }
}

export function resolveStableNodeExecPath() {
  if (process.platform === 'darwin') {
    try {
      const realCurrent = fs.realpathSync(process.execPath);
      for (const candidate of ['/opt/homebrew/bin/node', '/usr/local/bin/node']) {
        if (fs.existsSync(candidate) && fs.realpathSync(candidate) === realCurrent) {
          return candidate;
        }
      }
    } catch {}
  }
  return process.execPath;
}
