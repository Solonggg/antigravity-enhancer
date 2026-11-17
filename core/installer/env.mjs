/**
 * core/installer/env.mjs — Antigravity Environment Detection, argv.json Patcher & Live CDP Probe
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  isAllowedOrigin,
  fetchTargetsFromPort,
  inspectJsoncRootObject
} from '../shared.mjs';

export async function detectEnvironment(channel = 'auto') {
  const nodeVer = process.versions.node;
  const [major, minor] = nodeVer.split('.').map((n) => parseInt(n, 10));
  const nodeBasicOk = major >= 22;

  let sqliteAvailable = false;
  try {
    const mod = await import('node:sqlite').catch(() => null);
    sqliteAvailable = !!(mod && typeof mod.DatabaseSync === 'function');
  } catch {
    sqliteAvailable = false;
  }

  const home = os.homedir();
  const checkSingleChannel = (ch) => {
    const isInsiders = ch === 'insiders';
    const appDirName = isInsiders ? 'Antigravity - Insiders' : 'Antigravity';
    const dotDir = path.join(home, isInsiders ? '.antigravity-insiders' : '.antigravity');
    let portFile;
    let appPath;
    if (process.platform === 'darwin') {
      portFile = path.join(home, 'Library/Application Support', appDirName, 'DevToolsActivePort');
      appPath = isInsiders ? '/Applications/Antigravity - Insiders.app' : '/Applications/Antigravity.app';
    } else if (process.platform === 'win32') {
      const appData = process.env.APPDATA || path.join(home, 'AppData/Roaming');
      portFile = path.join(appData, appDirName, 'DevToolsActivePort');
      appPath = '';
    } else {
      const xdg = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
      portFile = path.join(xdg, appDirName, 'DevToolsActivePort');
      appPath = '';
    }
    const portFileExists = fs.existsSync(portFile);
    const appExists = appPath
      ? fs.existsSync(appPath)
      : portFileExists || fs.existsSync(path.dirname(portFile)) || fs.existsSync(dotDir);
    return {
      channel: ch,
      appExists,
      portFile,
      portFileExists
    };
  };

  const primaryChannel = channel === 'insiders' ? 'insiders' : 'stable';
  const chInfo = checkSingleChannel(primaryChannel);
  const insidersInfo = checkSingleChannel('insiders');

  return {
    nodeVer,
    major,
    minor,
    nodeBasicOk,
    sqliteAvailable,
    tier: sqliteAvailable
      ? 'FULL (>= 22.13, Codex Theme + i18n + 4-State Telemetry LED)'
      : nodeBasicOk
      ? 'STANDARD (22.0~22.12, Codex Theme + i18n; SQLite Telemetry disabled)'
      : 'UNSUPPORTED (< 22.0, requires Node 22+)',
    channel,
    appExists: chInfo.appExists || insidersInfo.appExists,
    portFile: chInfo.portFileExists ? chInfo.portFile : insidersInfo.portFileExists ? insidersInfo.portFile : chInfo.portFile,
    portFileExists: chInfo.portFileExists || insidersInfo.portFileExists,
    channels: {
      stable: checkSingleChannel('stable'),
      insiders: insidersInfo
    }
  };
}

export function ensureArgvRemoteDebugging(channel = 'auto') {
  const home = os.homedir();
  const dirs =
    channel === 'insiders'
      ? ['.antigravity-insiders']
      : channel === 'stable'
      ? ['.antigravity']
      : ['.antigravity', '.antigravity-insiders'];

  const results = [];
  for (const d of dirs) {
    const defaultPort = d === '.antigravity-insiders' ? 9223 : 9222;
    const argvDir = path.join(home, d);
    const argvPath = path.join(argvDir, 'argv.json');
    if (!fs.existsSync(argvDir)) continue;
    try {
      if (!fs.existsSync(argvPath)) {
        fs.writeFileSync(argvPath, JSON.stringify({ 'remote-debugging-port': defaultPort }, null, 2) + '\n', 'utf8');
        results.push({ path: argvPath, port: defaultPort, action: 'created' });
        continue;
      }
      const raw = fs.readFileSync(argvPath, 'utf8');
      const parsedInfo = inspectJsoncRootObject(raw);
      if (parsedInfo.hasRemoteDebuggingPort) {
        results.push({ path: argvPath, action: 'already-present' });
        continue;
      }
      if (parsedInfo.openBraceIdx !== -1 && parsedInfo.closeBraceIdx > parsedInfo.openBraceIdx) {
        const afterOpen = raw.slice(parsedInfo.openBraceIdx + 1);
        const comma = parsedInfo.hasTopProps ? ',' : '';
        const trailingNl = afterOpen.startsWith('\n') || afterOpen.startsWith('\r') ? '' : '\n';
        const patched =
          raw.slice(0, parsedInfo.openBraceIdx + 1) +
          `\n\t"remote-debugging-port": ${defaultPort}${comma}${trailingNl}` +
          afterOpen;
        fs.writeFileSync(argvPath, patched, 'utf8');
        results.push({ path: argvPath, port: defaultPort, action: 'patched' });
      } else {
        results.push({ path: argvPath, action: 'skipped', error: 'root JSON object not found' });
      }
    } catch (e) {
      results.push({ path: argvPath, action: 'skipped', error: e.message });
    }
  }
  return results;
}

export async function inspectLiveWindow(portFileOrEnv, fallbackPort = 9222) {
  const candidateFiles = [];
  const candidatePorts = [];

  if (portFileOrEnv && typeof portFileOrEnv === 'object' && portFileOrEnv.channels) {
    if (portFileOrEnv.portFile) candidateFiles.push(portFileOrEnv.portFile);
    if (portFileOrEnv.channels.stable?.portFile) candidateFiles.push(portFileOrEnv.channels.stable.portFile);
    if (portFileOrEnv.channels.insiders?.portFile) candidateFiles.push(portFileOrEnv.channels.insiders.portFile);
    if (portFileOrEnv.channels.stable?.appExists !== false) candidatePorts.push(9222);
    if (portFileOrEnv.channels.insiders?.appExists) candidatePorts.push(9223);
  } else if (typeof portFileOrEnv === 'string' && portFileOrEnv) {
    candidateFiles.push(portFileOrEnv);
    if (fallbackPort > 0) candidatePorts.push(fallbackPort);
  } else if (fallbackPort > 0) {
    candidatePorts.push(fallbackPort);
  }

  let port = null;
  let targets = [];
  const triedPorts = new Set();

  for (const pf of candidateFiles) {
    if (pf && fs.existsSync(pf)) {
      const raw = fs.readFileSync(pf, 'utf8').trim();
      const parsed = parseInt(raw.split(/\r?\n/)[0], 10);
      if (parsed > 0 && !triedPorts.has(parsed)) {
        triedPorts.add(parsed);
        const res = await fetchTargetsFromPort(parsed);
        if (res.length > 0) {
          port = parsed;
          targets = res;
          break;
        }
      }
    }
  }
  if (targets.length === 0) {
    for (const fb of candidatePorts) {
      if (fb > 0 && !triedPorts.has(fb)) {
        triedPorts.add(fb);
        const fbTargets = await fetchTargetsFromPort(fb);
        if (fbTargets.length > 0) {
          port = fb;
          targets = fbTargets;
          break;
        }
      }
    }
  }
  if (!port || targets.length === 0) {
    return { reachable: false, reason: 'No active CDP port responded (checked DevToolsActivePort & fallback port 9222)' };
  }

  const pages = targets.filter(
    (t) =>
      t.type === 'page' &&
      t.webSocketDebuggerUrl &&
      !String(t.url || '').startsWith('devtools://') &&
      isAllowedOrigin(t.url) &&
      !String(t.title || '').includes('Launchpad')
  );

  if (pages.length === 0) {
    return { reachable: true, port, pages: 0, reason: 'No active workbench page target' };
  }

  const page = pages[0];
  const state = await new Promise((resolve) => {
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {}
      resolve(null);
    }, 2000);
    ws.addEventListener('open', () => {
      ws.send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: {
            expression: `({
              version: window.__ag_patch_version || null,
              bodyReady: window.__ag_body_ready === true,
              hasStyle: !!document.getElementById('ag-codex-theme'),
              hasUserStyle: !!document.getElementById('ag-user-custom-style'),
              preset: document.documentElement.getAttribute('data-ag-preset'),
              themeMode: document.documentElement.getAttribute('data-ag-theme-mode'),
              pageType: document.documentElement.getAttribute('data-ag-page-type'),
              dictCount: window.__ag_i18n_dict ? Object.keys(window.__ag_i18n_dict).length : 0,
              protoSafe: window.__ag_i18n_dict ? Object.getPrototypeOf(window.__ag_i18n_dict) === null : false,
              pillMounted: !!document.getElementById('ag-live-metrics-pill'),
              pillText: document.getElementById('ag-live-metrics-pill')?.textContent || null
            })`,
            returnByValue: true
          }
        })
      );
    });
    ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(String(ev.data));
        if (msg.id === 1) {
          clearTimeout(timer);
          ws.close();
          resolve(msg.result?.result?.value || null);
        }
      } catch {}
    });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
  });

  return {
    reachable: true,
    port,
    targetId: page.id,
    title: page.title,
    state
  };
}
