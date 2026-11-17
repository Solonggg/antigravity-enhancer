---
name: antigravity-codex-theme
description: Deploy, diagnose, configure, or troubleshoot antigravity-codex-theme (Chinese UI localization + Codex pure-white/Onyx theme + 4-state live telemetry LED) on macOS, Windows, and Linux.
---

# Agent Operations Guide: antigravity-codex-theme

Follow this guide when a user asks you to install, verify, customize, troubleshoot, rollback, or uninstall **`antigravity-codex-theme`** (Chinese UI localization + Codex pure-white light / Onyx dark theme + 4-state telemetry LED).

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

## 2. Standard Workflows

### Install or Upgrade (auto-migrates older theme daemons cleanly)
```bash
node install.mjs install
```
Pass `--sync-user` only if resetting `user/*` files from the repository defaults. Pass `--channel stable` or `--channel insiders` if restricting to one Antigravity channel.

### Diagnose Environment & Live Injection
```bash
node --disable-warning=ExperimentalWarning install.mjs doctor
```
Verify in JSON output:
- `ok === true`
- `node.tier` shows `FULL (>= 22.13, ...)` when live SQLite telemetry is expected
- `coreIntegrity.clean === true`
- `liveWindow.reachable === true` and `liveWindow.state.hasStyle === true` (`#ag-codex-theme`), `preset` is `"codex-pure-white"` (light) or `"onyx-dark"` (dark), `dictCount >= 800`, and `pillMounted === true` in an active chat

### Safe-Mode Troubleshooting
If a user edit in `user/custom.css` or `user/custom.js` causes visual breakage:
```bash
node --disable-warning=ExperimentalWarning install.mjs verify --safe-mode
```
If `--safe-mode` works cleanly, inspect `~/.gemini/antigravity/codex-theme/user/` rather than `core/`.

### Configuration Tweaks (Hot-Reloaded in ~2.5s)
Edit `~/.gemini/antigravity/codex-theme/user/config.json` (never edit `core/` on deployed machines without rebuilding `core/manifest.json`):
- **Disable UI localization only**: `"modules": { "i18n": false }`
- **Switch telemetry pill density**: `"telemetryLayout": "detailed"` (`"compact"` is default)
- **Switch cache metric mode**: `"telemetryCacheMode": "step"` (`"session"` is default)
- **Disable entire theme cleanly**: `"enabled": false`

### Rollback / Uninstall
```bash
node install.mjs rollback
node install.mjs uninstall
```

## 3. Verification Checklist (For Maintainers / Contributors)
After editing any file under `core/`, always regenerate `core/manifest.json` before running tests or packing:
```bash
node install.mjs build-manifest
npm run check
npm test
```
