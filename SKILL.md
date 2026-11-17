---
name: antigravity-codex-theme
description: Deploy, selectively install, diagnose, configure, or troubleshoot antigravity-codex-theme (Codex pure-white/charcoal-dark theme, Chinese UI localization, 4-state session status indicator, expandable L1/L2 usage panels, and per-turn footer stats) on macOS, Windows, and Linux.
---

# Agent Operations Guide: antigravity-codex-theme

Follow this guide when a user asks you to install, selectively install specific modules, verify, customize, troubleshoot, rollback, or uninstall **`antigravity-codex-theme`**.

> **Platform & Node.js Alignment**:
> - Minimum Node.js version: **`>= 22.13.0`** (aligned with `package.json`, required for built-in `node:sqlite`).
> - Real-device verified environment: **macOS** with Antigravity **`2.31.0` / `2.32.1`** and Node.js `v24.4.1`. Windows (`schtasks`) and Linux (`systemd --user`) autostart implementations are included, while CI (`ubuntu-latest`) covers syntax checks and unit tests only.

## 1. Key Paths & Service Identifiers

| Item | Path / Identifier |
| :--- | :--- |
| Deployed runtime directory | `~/.gemini/antigravity/codex-theme` |
| Service wrapper script | `~/.gemini/antigravity/scripts/antigravity-codex-daemon.mjs` |
| macOS LaunchAgent | `com.antigravity.codex-theme` (`~/Library/LaunchAgents/com.antigravity.codex-theme.plist`) |
| macOS daemon logs | `/tmp/antigravity-codex-daemon.log`, `/tmp/antigravity-codex-daemon.err` |
| Linux systemd user unit | `antigravity-codex-theme.service` (`~/.config/systemd/user/antigravity-codex-theme.service`) |
| Windows autostart | Scheduled Task `AntigravityCodexThemeDaemon` / `AntigravityCodexThemeDaemon.vbs` |
| User hot-reload config | `~/.gemini/antigravity/codex-theme/user/config.json` |

## 2. Selectable Core Modules

Users can install all features or only the modules they request:

| Feature ID | Config Keys | Purpose |
| :--- | :--- | :--- |
| `theme` | `modules.theme` | Codex pure-white light & charcoal-dark themes (`00-base.css`, `10-light-codex.css`, `20-dark-codex.css`, `20-theme-sync.js`) |
| `i18n` | `modules.i18n` | 900+ Chinese UI localization entries (`core/i18n.json`, `60-i18n-engine.js`) |
| `metrics` | `modules.metrics` | 4-state session status indicator (`会话状态`), L1/L2 expandable usage panels, and per-turn footer stats |
| `fixes` | `modules.deadlockHealer`, `modules.zoomShortcuts` | Settings modal router deadlock fix & `Cmd/Ctrl + -/=/0` zoom shortcuts (`10-guards.js`) |

## 3. Standard & Selective Workflows

### Fast Sparse Clone (Recommended for AI Agents — skips `assets/` screenshots & `tests/`)
```bash
git clone --depth=1 --filter=blob:none --sparse https://github.com/nkjDSLcvanv/antigravity-codex-theme.git
cd antigravity-codex-theme
git sparse-checkout set core user
```
If the user requests only specific modules without even downloading unused `core/` files, run `git sparse-checkout set --no-cone ...` with only the needed files (for an existing clone, run `node install.mjs sparse-paths --only <features>` to list exact paths).

### Install or Upgrade (auto-migrates older theme daemons cleanly)
```bash
# Install all core features
node install.mjs install

# Or install only selected modules (e.g., i18n + session status/telemetry without Codex theme)
node install.mjs install --only i18n,metrics
```
Optional flags:
- `--only theme,i18n,metrics,fixes`: enable only the specified feature groups
- `--without <features>`: exclude specific feature groups
- `--minimal`: prune excluded feature files inside `~/.gemini/antigravity/codex-theme/core` and rebuild its manifest
- `--sync-user`: overwrite `user/*` files from repository defaults
- `--channel stable|insiders`: restrict to one Antigravity channel

> **Note**: `install` patches `~/.antigravity/argv.json` with `"remote-debugging-port": 9222` (or `9223` for Insiders) and registers the background autostart service. If Antigravity was already open without remote debugging enabled, ask the user to fully quit and reopen Antigravity once.

### Diagnose Environment & Live Injection
```bash
node --disable-warning=ExperimentalWarning install.mjs doctor
```
Verify in JSON output:
- `ok === true`
- `node.tier` shows `FULL (>= 22.13.0, ...)`
- `coreIntegrity.clean === true`
- `liveWindow.reachable === true` and `liveWindow.state.hasStyle === true` (`#ag-codex-theme`); when `theme` is enabled, `preset` is `"codex-pure-white"` or `"codex-dark"`; when `i18n` is enabled, `dictCount >= 800`; when `metrics` is enabled in an active chat, `pillMounted === true`

### Safe-Mode Troubleshooting
```bash
node --disable-warning=ExperimentalWarning install.mjs verify --safe-mode
```
If `--safe-mode` works cleanly, inspect `~/.gemini/antigravity/codex-theme/user/` rather than `core/`.

### Configuration Tweaks (Hot-Reloaded in ~2.5s)
Edit `~/.gemini/antigravity/codex-theme/user/config.json`:
- **Toggle individual modules**: `"modules": { "theme": true, "i18n": true, "metrics": true, "deadlockHealer": true, "zoomShortcuts": true }`
- **Switch status bar density**: `"telemetryLayout": "detailed"` (`"compact"` is default)
- **Switch cache metric mode**: `"telemetryCacheMode": "step"` (`"session"` is default)
- **Disable entire plugin cleanly**: `"enabled": false`

### Rollback / Uninstall
```bash
node install.mjs rollback
node install.mjs uninstall
```
`uninstall` stops the daemon, removes autostart registrations, and restores original English UI and native styling while preserving `~/.gemini/antigravity/codex-theme/user/`, `backups/`, `core.prev/`, and `"remote-debugging-port"` in `argv.json`.

## 4. Verification Checklist (For Maintainers / Contributors)
After editing any file under `core/`, always regenerate `core/manifest.json` before running checks or tests:
```bash
node install.mjs build-manifest
npm run check
npm test
```
