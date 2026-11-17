#!/usr/bin/env node
/**
 * antigravity-codex-theme · CDP Theme, Localization & Live Telemetry Daemon (core/daemon.mjs)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseDaemonCliArgs,
  createBundleController
} from './daemon/paths.mjs';
import {
  parseProto,
  parseGenMetadataRow,
  extractMaxStepIdx,
  extractProtoLeafStrings,
  extractStep17Message,
  isCancelText
} from './daemon/protobuf.mjs';
import { readRecentLsRetryInfo } from './daemon/ls-log.mjs';
import { createMetricsReader } from './daemon/sqlite-metrics.mjs';
import {
  acquireDaemonPidLock,
  trimLogFileIfOversized,
  trimDaemonLogsIfNeeded,
  createCdpManager
} from './daemon/cdp-bridge.mjs';

const __filename = fileURLToPath(import.meta.url);

let DatabaseSync = null;
try {
  const sqliteMod = await import('node:sqlite').catch(() => null);
  if (sqliteMod && typeof sqliteMod.DatabaseSync === 'function') {
    DatabaseSync = sqliteMod.DatabaseSync;
  }
} catch {
  DatabaseSync = null;
}

const cliOpts = parseDaemonCliArgs(process.argv.slice(2));
const bundleCtrl = createBundleController({
  safeMode: cliOpts.safeMode,
  cliChannel: cliOpts.cliChannel,
  hasSqlite: Boolean(DatabaseSync),
  cliOpts
});

const metricsReader = createMetricsReader({
  getDatabaseSync: () => DatabaseSync,
  getConfig: () => bundleCtrl.getState().activeConfig
});

const cdpManager = createCdpManager({
  bundleCtrl,
  metricsReader,
  hasSqlite: () => Boolean(DatabaseSync),
  runOnce: cliOpts.runOnce
});

export {
  parseProto,
  parseGenMetadataRow,
  extractMaxStepIdx,
  extractProtoLeafStrings,
  extractStep17Message,
  isCancelText,
  readRecentLsRetryInfo,
  trimLogFileIfOversized
};

export function parseConversationMetrics(cascadeId, conversationsDir, extraOpts = {}) {
  bundleCtrl.rebuildBundleIfNeeded();
  return metricsReader.parseConversationMetrics(cascadeId, conversationsDir, extraOpts);
}

export async function startDaemon() {
  if (globalThis.__ag_daemon_started) return;
  globalThis.__ag_daemon_started = true;

  acquireDaemonPidLock(cliOpts.cliChannel, cliOpts.runOnce);
  trimDaemonLogsIfNeeded(cliOpts.runOnce);
  bundleCtrl.rebuildBundleIfNeeded();

  const { activeConfig, cachedPatchVersion } = bundleCtrl.getState();
  console.log(
    `[Antigravity Codex Daemon] Started (${cachedPatchVersion}) | preset=${activeConfig.preset} | channel=${activeConfig.channel} | sqlite=${Boolean(DatabaseSync)} | safeMode=${cliOpts.safeMode}`
  );

  await cdpManager.sync();
  if (cliOpts.runOnce) {
    cdpManager.closeAll();
    process.exit(0);
  } else {
    setInterval(() => cdpManager.sync(), 2500);
  }
}

const invokedArg = process.argv[1] ? path.resolve(process.argv[1]) : '';
const isDirectDaemon =
  invokedArg === path.resolve(__filename) || path.basename(invokedArg) === 'antigravity-codex-daemon.mjs';

if (process.env.AG_DAEMON_LIBRARY !== '1' && isDirectDaemon) {
  await startDaemon();
}
