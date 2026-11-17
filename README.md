# antigravity-codex-theme

Google Antigravity 的 Codex 极简昼夜主题、中文界面汉化与实时会话状态统计插件。

[快速安装](#快速安装) · [按需自选核心功能](#按需自选核心功能) · [功能与效果展示](#功能与效果展示) · [配置与热更新](#配置与热更新) · [致谢与开源协议](#致谢与开源协议)

![Codex 浅色与深色模式对比](assets/light-dark-themes.png)

**Codex 风格主题 · 中文界面 · 实时状态与每轮统计**

基于开源项目 [chuanban-antigravity-theme-patch](https://github.com/Anarcadia/chuanban-antigravity-theme-patch) 进行 Codex 视觉改造与模块化重构（[查看详细致谢与开源协议](#致谢与开源协议)）。

---

## 快速安装

> **前置要求**：**Node.js >= 22.13.0**（与 [package.json](package.json) 一致，用于内置 `node:sqlite` 读取实时会话统计）以及 Google Antigravity。
>
> **安装前请注意以下系统变更**：
> 1. 安装脚本会向 `~/.antigravity/argv.json`（及 Insiders 的 `~/.antigravity-insiders/argv.json`）写入 `"remote-debugging-port": 9222`（Insiders 为 `9223`）以启用本地 `127.0.0.1` 调试端口；若安装前 Antigravity 已经打开且此前未开启调试端口，**安装后需彻底退出并重启一次 Antigravity**。
> 2. 核心文件会部署至 `~/.gemini/antigravity/codex-theme`，并注册系统后台自启服务（macOS `LaunchAgent` / Linux `systemd --user` / Windows 计划任务 `schtasks`），**全程不修改 Antigravity 安装包本体文件**。

### 方式一：AI 一键安装（推荐）

直接复制下面任意一段提示词发给你的 AI 助手（Antigravity / Claude Code / Codex / Cursor 等），即可自动完成稀疏拉取、部署与验证：

> **💬 安装全部核心功能（跳过截图资源，速度更快）**：
> 请读取 `https://github.com/nkjDSLcvanv/antigravity-codex-theme.git`，使用 `git clone --depth=1 --filter=blob:none --sparse` 拉取核心文件（参考仓库内的 `SKILL.md`，跳过 `assets/` 和 `tests/`），运行 `node install.mjs install`、`node --disable-warning=ExperimentalWarning install.mjs doctor` 和 `verify` 完成安装并确认实时注入正常。

> **💬 按需自选部分功能（不用全部下载/启用）**：
> 请参考 `https://github.com/nkjDSLcvanv/antigravity-codex-theme.git` 中的 `SKILL.md`，只帮我下载并安装我指定的核心功能（可选：`theme` Codex 主题、`i18n` 中文汉化、`metrics` 实时会话状态与用量统计、`fixes` 死锁修复与缩放快捷键）。我本次只需要：`i18n,metrics`（请按需替换），请执行稀疏拉取并用 `--only` 参数完成安装与校验。

### 方式二：命令行安装

> **已实机验证平台与版本**：
> - **macOS（已实机验证）**：已在 **macOS + Antigravity `2.31.0` / `2.32.1` + Node.js `v24.4.1`** 实机完成安装（`LaunchAgent`）、实时注入、会话状态与面板切换及卸载还原测试。
> - **Windows / Linux（未在桌面端实机测试）**：已实现 Windows（`schtasks` / VBS / 注册表）与 Linux（`systemd --user`）自启管理脚本；现有 GitHub Actions CI 仅在 Ubuntu（`ubuntu-latest`）上运行 `npm run check` 语法检查与 `npm test` 单元测试，**尚未在 Windows 与 Linux 桌面环境中实机验证安装与卸载**。

```bash
git clone https://github.com/nkjDSLcvanv/antigravity-codex-theme.git
cd antigravity-codex-theme

# 部署到 ~/.gemini/antigravity/codex-theme、启用本地调试端口并注册后台自启
node install.mjs install

# 检查 Node 版本、调试端口、文件完整性与当前窗口挂载状态
node --disable-warning=ExperimentalWarning install.mjs doctor
```

<details>
<summary>常用运维与回滚命令</summary>

| 命令 | 用途 |
| :--- | :--- |
| `node install.mjs install [--channel auto\|stable\|insiders] [--only <features>] [--minimal] [--sync-user]` | 部署或升级插件并注册后台守护服务 |
| `node --disable-warning=ExperimentalWarning install.mjs doctor` | 自检 Node 版本、调试端口、`core/manifest.json` 哈希及实时页面状态 |
| `node --disable-warning=ExperimentalWarning install.mjs verify [--safe-mode]` | 单次注入并验证挂载结果；`--safe-mode` 可跳过 `user/` 自定义脚本排障 |
| `node install.mjs sparse-paths --only <features>` | 输出指定模块组合的精简文件列表 |
| `node install.mjs rollback` | 回滚到上一个备份的 `core/` 版本 |
| `node install.mjs uninstall` | 停止服务、清理自启项并还原原版英文界面与样式 |
| `npm test` | 运行语法检查、线协议解析、状态机与仓库完整性单元测试 |

</details>

### 按需自选核心功能（不用全部下）

插件的 4 个核心能力完全解耦，可按需只下载并启用需要的部分：

| 功能标识 | 模块内容 |
| :--- | :--- |
| `theme` | Codex 纯白 (`codex-pure-white`) / 炭灰暗夜 (`codex-dark`) 昼夜主题 |
| `i18n` | 中文界面本地化（900+ 词条，`WeakMap` 原地更新，跳过代码块与终端） |
| `metrics` | 实时会话状态指示、一/二级用量统计面板与每轮对话尾部统计 |
| `fixes` | 设置弹窗死锁修复与 `Cmd/Ctrl + -/=/0` 界面缩放快捷键 |

**1）跳过截图与测试，仅拉取运行核心并自选启用功能（全平台通用）**：

```bash
git clone --depth=1 --filter=blob:none --sparse https://github.com/nkjDSLcvanv/antigravity-codex-theme.git
cd antigravity-codex-theme
git sparse-checkout set core user

# 示例 1：只开启「中文汉化 + 实时会话状态与用量统计」，保留 Antigravity 原生配色
node install.mjs install --only i18n,metrics

# 示例 2：只开启「Codex 昼夜主题 + 中文汉化」，不启用统计读取
node install.mjs install --only theme,i18n
```

**2）连未选功能的文件也不下载（`--no-cone` 极简拉取）**：

<details>
<summary>展开查看单模块极简拉取示例（macOS / Linux / Git Bash）</summary>

```bash
# 示例：仅下载并安装「中文界面汉化 (i18n)」核心文件
git clone --depth=1 --filter=blob:none --sparse https://github.com/nkjDSLcvanv/antigravity-codex-theme.git
cd antigravity-codex-theme
git sparse-checkout set --no-cone \
  /install.mjs /package.json /SKILL.md /LICENSE \
  /user/config.json /user/custom.css /user/custom.js /user/i18n.override.json \
  /core/daemon.mjs /core/shared.mjs /core/manifest.json /core/installer \
  /core/daemon/paths.mjs /core/daemon/cdp-bridge.mjs \
  /core/runtime/00-head.js /core/runtime/90-tail.js \
  /core/i18n.json /core/runtime/60-i18n-engine.js
node install.mjs install --only i18n --minimal
```

如已先执行 `git sparse-checkout set core user`，可用 `node install.mjs sparse-paths --only theme,metrics` 生成任意组合的路径清单。

</details>

### 卸载与保留说明

运行 `node install.mjs uninstall` 时的行为如下：
- **会移除或还原**：立即停止后台同步进程，删除系统开机自启项（macOS `LaunchAgent` plist、Linux `systemd --user` unit、Windows 计划任务与启动脚本），并向已打开的 Antigravity 窗口还原原版英文界面与原生样式。
- **会保留的设置**：保留个人配置与改装目录 `~/.gemini/antigravity/codex-theme/user/`（`config.json`、`i18n.override.json`、`custom.css`、`custom.js`）、历史版本备份 `backups/` 与 `core.prev/`，以及安装时写入 `~/.antigravity/argv.json`（或 `~/.antigravity-insiders/argv.json`）中的 `"remote-debugging-port"` 字段；如需彻底清除，可手动删除对应目录与该配置项。

---

## 功能与效果展示

### 1. 实时会话状态与用量统计

在输入框底部工具栏正中（模型选择与权限/发送按钮之间）嵌入紧凑的 **会话状态指示** 与摘要栏，鼠标悬停时会显示 `会话状态：...` 悬浮提示：

```text
● 248 tok/s · Ctx 42% · Cache 90.9%
```

| 会话状态 | 指示圆点样式 | 触发条件 |
| :--- | :--- | :--- |
| **就绪** | **蓝色常亮** | 会话流正常连接且处于空闲状态；主动点击取消生成后立即恢复常亮 |
| **执行中** | **蓝色闪烁** | 模型流式生成、`/compact` 压缩或工具调用正在推进 |
| **等待或重试** | **黄色脉冲** | 首字或步骤等待超过 `60s`（如切换模型后 `/compact` 重算 KV 缓存）、模型不可用自动重试，或建连延迟 `3s–11s` |
| **连接或执行异常** | **红色脉冲** | 网络离线、会话未连接超时 `>= 12s`、API/步骤报错（已过滤主动取消），或后台统计服务心跳超时 `>= 90s` |

![会话状态：就绪、执行中、等待或重试、连接或执行异常](assets/led-status-states.png)

*会话状态：就绪、执行中、等待或重试、连接或执行异常*

- **悬停预览 / 单击展开一级面板**：查看当前最新一次调用的生成速度（`tok/s` 与端到端均值）、上下文占用百分比与剩余容量、累计缓存命中率、当前上下文分段条（新增 / 写缓存 / 读缓存 / 剩余）以及等待或异常提示。
- **再点一下状态栏（或点击「展开明细」）→ 展开二级面板**：进一步展示首字延迟（TTFT）与流式耗时、Thinking 与正文输出拆分、本轮多步合计，以及整个会话的累计输入/输出总览；点击页面空白处、按 `Esc` 或第三次点击状态栏即可收起。
- **上下文预警与压缩视图**：上下文占比 `>= 75%` 自动转为黄色预警、`>= 90%` 转为红色临界高亮；执行 `/compact` 时提示压缩进度（跨模型切换压缩时主动说明 KV 缓存冷重算原因），压缩完成后以绿色标记展示摘要大小。

![一级概览、二级详情与上下文预警及压缩状态](assets/telemetry-bento-panels.png)

*白日模式下状态栏提供紧凑（默认）、详细（含 `TTFT` 与 `Out`）和窄栏自动折行三种自适应布局：*

![白日模式下状态栏三种自适应布局](assets/telemetry-layouts.png)

### 2. 每轮对话尾部统计

在每次助手回复底部的操作栏左侧，自动附上一行紧凑统计：

```text
Gemini 4 Hydrogen (XHigh) · In 1.57M · Out 11k · Cache 98.8% · 236 tok/s
```

鼠标悬停在上面时，系统原生 `title` 悬浮提示会显示该轮总步数、精确上下文占用、`Thinking` 与正文/工具分别消耗的 token 数、缓存命中比例及流式/总耗时。

### 3. 中文界面汉化（900+ 词条）

- 覆盖设置弹窗、模型选择器、权限模式、侧边栏会话菜单、命令审批与工具状态等常见英文界面文本。
- 基于 `WeakMap` 在原文本节点直接更新，不克隆或破坏 React 事件绑定；自动豁免代码块、`pre`、Monaco 编辑器、终端、用户提问气泡与会话标题。
- 支持通过 [user/i18n.override.json](user/i18n.override.json) 热更新覆盖词条，或在配置中关闭 `i18n` 恢复英文。

### 4. Codex 风格昼夜主题与实用修复

- **日间默认 (`codex-pure-white`)**：`#FFFFFF` 纯白画布、`#F9F9F9` 侧边栏、`#EFEFEF` 选中条、`#2B7FFF` 主按钮与双层圆角悬浮输入框（`#F3F4F6` 外托盘 + `#FFFFFF` 内卡片）。
- **夜间模式 (`codex-dark`)**：对应 Codex 桌面端中性炭灰配色方案——`#181818` 主背景、`#232323` 侧栏、`#353535` 选中圆角条、`#282828` 外托盘、`#363636` 输入卡片与 `#2C67C5` 主按钮。
- **内置实用修复**：修复 Antigravity 设置弹窗路由死锁，并补齐 macOS (`Cmd + -/=/0`) 与 Windows/Linux (`Ctrl + -/=/0`) 界面缩放快捷键。

---

## 配置与热更新

个人配置位于 `~/.gemini/antigravity/codex-theme/user/`，修改后约 2.5 秒自动推入正在运行的窗口，无需重启 Antigravity：

- [user/config.json](user/config.json)
  - `preset`：`"codex-pure-white"`（日间默认）或 `"codex-dark"`（深色自动切换）
  - `telemetryLayout`：`"compact"`（默认紧凑条 `tok/s · Ctx % · Cache %`）或 `"detailed"`（显示 `TTFT` / 精确上下文 / `Out`）
  - `telemetryCacheMode`：`"session"`（默认累计缓存命中率）或 `"step"`（当前步命中率）
  - `modules`：按需独立开关 `theme`（Codex 昼夜主题）、`i18n`（中文汉化）、`metrics`（实时会话状态与统计面板）、`deadlockHealer`（设置死锁修复）、`zoomShortcuts`（缩放快捷键）、`customCss`、`customJs`
- [user/i18n.override.json](user/i18n.override.json)：追加或覆盖个人词条映射
- [user/custom.css](user/custom.css) / [user/custom.js](user/custom.js)：自定义样式与前端脚本钩子

---

## 目录结构

```text
antigravity-codex-theme/
├── assets/                     # README 展示截图
├── core/
│   ├── daemon/                 # 后台同步服务（配置热加载 / Protobuf 解析 / 日志重试 / 面板渲染 / SQLite / CDP）
│   ├── runtime/                # 按序拼接注入的浏览器脚本（生命周期 / 修复补丁 / 昼夜同步 / 状态机 / 统计界面 / 汉化引擎）
│   ├── styles/                 # 样式拆分（基础结构 / Codex 纯白 / Codex 深灰 / 会话状态与统计面板）
│   ├── installer/              # 模块分组清单 / Manifest 校验与打包 / 环境探测 / 跨平台自启管理
│   ├── daemon.mjs              # 后台服务入口
│   ├── shared.mjs              # 公共工具函数
│   ├── i18n.json               # 900+ 界面汉化词典
│   └── manifest.json           # core/ 文件 SHA-256 清单
├── tests/                      # 单元测试（node:test）
├── user/                       # 用户自定义与热更新目录
├── install.mjs                 # 安装与运维 CLI
├── SKILL.md                    # 供 AI Agent 使用的操作说明
└── LICENSE                     # MIT License
```

---

## 致谢与开源协议

- **致谢原开源项目**：本项目基于 [**Anarcadia/chuanban-antigravity-theme-patch**](https://github.com/Anarcadia/chuanban-antigravity-theme-patch) 改造而来。原项目提供了出色的 Antigravity CDP 运行时热注入框架、`WeakMap` DOM 汉化引擎、SQLite 增量统计思路与跨平台守护服务基础；本仓库在其基础上完成了 Codex 昼夜双色风格改造、会话状态机重构、按需模块拆分安装以及全面模块化工程整理。
- **开源协议**：[MIT License](LICENSE)

---

## English Overview

**antigravity-codex-theme** is a modular Codex-style theme, Chinese UI localization, and session status & telemetry plugin for Google Antigravity, refactored from [Anarcadia/chuanban-antigravity-theme-patch](https://github.com/Anarcadia/chuanban-antigravity-theme-patch):

- **Selective Core Installation (`--only`)**: Install everything or choose only the modules you need (`theme`, `i18n`, `metrics`, `fixes`) using Git sparse checkout.
- **Session Status Indicator & L1/L2 Usage Panels**: 4-state indicator (ready / running / waiting or retrying / error) + compact status bar (`tok/s · Ctx % · Cache %`); click once to open the Level 1 summary card and click again to expand Level 2 details.
- **Per-Turn Footer Stats**: Inline `Model · In · Out · Cache · tok/s` attached to each assistant response toolbar with hover breakdown.
- **Chinese UI Localization**: 900+ UI strings translated in-place via a `WeakMap` observer without breaking React Fiber listeners or mutating code blocks.
- **Codex Pure White & Charcoal Dark Themes**: `#FFFFFF` / `#F9F9F9` light mode and `#181818` / `#232323` / `#363636` dark mode.
- **Verified Environment**: Tested end-to-end on macOS with Antigravity `2.31.0` / `2.32.1` and Node.js `v24.4.1` (requires Node.js `>= 22.13.0`). Windows and Linux service registration is implemented, while GitHub Actions CI currently runs syntax checks and unit tests on Ubuntu without desktop install/uninstall verification.
