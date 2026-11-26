---
name: antigravity-enhancer
description: Deploy, selectively install, relaunch with CDP opt-in (Antigravity 2.33.0+), diagnose, configure, or troubleshoot antigravity-enhancer (zero-outbound Chinese UI localization, local session status/usage stats, simplified right-click Open In for IDEA/Finder/Zed/VS Code/Cursor, and opt-in prompt suggestions) on macOS, Windows, and Linux.
---

# Agent Operations Guide: antigravity-enhancer

Follow this guide when a user asks you to install, selectively install specific modules, update for Antigravity `2.33.0+`, verify, customize, troubleshoot, rollback, or uninstall **`antigravity-enhancer`**.

> **Design Guarantees**:
> - **Zero theme overrides**: Leaves Antigravity's native light and dark themes completely untouched.
> - **Zero outbound network**: No SSH Remote, no GitHub update checks, no external URL launchers; only local `127.0.0.1` CDP.
> - **Minimum Node.js version**: **`>= 22.13.0`** (required for built-in `node:sqlite`).
> - **Supported Antigravity versions**: **`2.30.x` – `2.35.1+`** (includes single-icon M1/M2 `--remote-debugging-port=0` opt-in relaunch for `2.33.0+`).

## 1. Key Paths & Service Identifiers

| Item | Path / Identifier |
| :--- | :--- |
| Deployed runtime directory | `~/.gemini/antigravity/enhancer` |
| Service wrapper script | `~/.gemini/antigravity/scripts/antigravity-enhancer-daemon.mjs` |
| macOS LaunchAgent | `com.antigravity.enhancer` (`~/Library/LaunchAgents/com.antigravity.enhancer.plist`) |
| macOS daemon logs | `/tmp/antigravity-enhancer-daemon.log`, `/tmp/antigravity-enhancer-daemon.err` |
| Linux systemd user unit | `antigravity-enhancer.service` (`~/.config/systemd/user/antigravity-enhancer.service`) |
| Windows autostart | Scheduled Task `AntigravityEnhancerDaemon` / `AntigravityEnhancerDaemon.vbs` |
| User hot-reload config | `~/.gemini/antigravity/enhancer/user/config.json` |

## 2. Selectable Core Modules

| Feature ID | Config Keys | Purpose |
| :--- | :--- | :--- |
| `i18n` | `modules.i18n` | 5,200+ Chinese UI localization entries with Shadow DOM penetration (`core/i18n.json`, `60-i18n-engine.js`, preserving English model/effort/brand labels) |
| `metrics` | `modules.metrics` | Pure local 4-state session status indicator, L1/L2 expandable usage panels, and per-turn footer stats (local SQLite + `language_server.log` only) |
| `openIn` | `modules.openIn` | Simplified passive right-click "Open In" menu for file references (`IDEA`, `Finder`, `Zed`, `VS Code`, `Cursor`) with line/column jumping and zero shell interpolation (`core/daemon/open-in.mjs`, `65-open-in.js`, `42-open-in.css`) |
| `fixes` | `modules.deadlockHealer`, `modules.zoomShortcuts` | Settings modal router deadlock fix & `Cmd/Ctrl + -/=/0` zoom shortcuts (`10-guards.js`) |
| `suggest` | `modules.promptSuggestions` | Opt-in (default `false`) Ghost Text + `Tab`/`→` prompt suggestions via local `agy` worker (`prompt-suggest.mjs`, `70-prompt-suggestions.js`, `40-prompt-suggestions.css`) |

## 3. Standard & Selective Workflows

### Fast Sparse Clone (skips `assets/` screenshots & `tests/`)
```bash
git clone --depth=1 --filter=blob:none --sparse https://github.com/Solonggg/antigravity-enhancer.git
cd antigravity-enhancer
git sparse-checkout set core user
```

### Install or Upgrade (automatically retires legacy `codex-theme` and standalone `open-in` daemons)
```bash
# Install all default modules (i18n, metrics, openIn, fixes)
node install.mjs install

# Or install only selected modules
node install.mjs install --only i18n,openIn
```
Optional flags:
- `--only i18n,metrics,openIn,fixes,suggest`: enable only the specified feature groups (`suggest` is off by default unless listed)
- `--without <features>`: exclude specific feature groups
- `--minimal`: prune excluded feature files inside `~/.gemini/antigravity/enhancer/core` and rebuild its manifest
- `--with-launcher`: (macOS only) optionally create `~/Applications/Antigravity (Enhancer).app`; by default macOS uses single-icon mode (`single-icon-m2-relay`)
- `--sync-user`: overwrite `user/*` files from repository defaults
- `--channel stable|insiders`: restrict to one Antigravity channel

### Antigravity `2.33.0+` CDP Opt-In Relaunch & Anti-Self-Termination Rule
- **When `install` or `doctor` reports `"cdpStatus": "missing_opt_in_flag"`**:
  - **Inside Antigravity itself**: **NEVER run `relaunch --force`** during an active turn. Ask the user to quit and reopen Antigravity once after the reply completes (M2 cold-start relay attaches `--remote-debugging-port=0` automatically), or run `node ~/.gemini/antigravity/enhancer/install.mjs relaunch` from an external terminal.
  - **From an external terminal**: Run `node ~/.gemini/antigravity/enhancer/install.mjs relaunch` directly.

### Diagnose Environment & Live Injection
```bash
node --disable-warning=ExperimentalWarning install.mjs doctor
```
Verify in JSON output:
- `ok === true`
- `coreIntegrity.clean === true`
- `liveWindow.reachable === true` and `liveWindow.state.hasStyle === true` (`#ag-enhancer-style`)
- When `i18n` is enabled: `dictCount >= 5000`; when `openIn` is enabled: `openInMounted === true`

### Safe-Mode Troubleshooting
```bash
node --disable-warning=ExperimentalWarning install.mjs verify --safe-mode
```

### Configuration Tweaks (Embedded Settings UI or Hot-Reloaded `user/config.json`)
Users can toggle modules, select right-click Open-In targets (`IDEA`, `Finder`, `Zed`, `VS Code`, `Cursor`), customize `ideaPath`, pick prompt-suggestion models, and change status bar preferences under **Settings → Enhancer** (`设置 → Enhancer 增强`), or edit `~/.gemini/antigravity/enhancer/user/config.json`.

### Rollback / Uninstall
```bash
node install.mjs rollback
node install.mjs uninstall
```

## 4. Verification Checklist (For Maintainers)
After editing any file under `core/`, always regenerate `core/manifest.json` before running checks or tests:
```bash
node install.mjs build-manifest
npm run check
npm test
```
