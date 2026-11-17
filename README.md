# antigravity-codex-theme

**中文界面深度汉化 + Codex 极简纯白/Onyx 昼夜主题 + 4 态实时状态灯与遥测胶囊**

[English Overview](#english-overview) · [快速安装](#快速安装) · [状态灯说明](#4-态连接与执行状态指示灯) · [自定义配置](#自定义与热重载) · [开源说明](#开源与致谢)

---

> **开源重构声明**
> 本项目基于开源 Antigravity 运行时注入与界面汉化方案的架构原型进行 **Codex 极简风格改造与全量模块化重构**——采用 Codex 纯白 (`codex-pure-white`) 作为默认日间风格、Onyx (`onyx-dark`) 作为夜间风格，内置 900+ 词条无痛汉化与四态实时遥测指示灯，并将目录、进程、服务标识与工程结构全面规范化。

---

## 核心特性

### 1. 深度 UI 汉化（零侵入实时本地化）
- **900+ 核心 UI 词典**：覆盖设置面板、模型选择器、权限模式、侧边栏会话管理、终端与工具调用提示等 Antigravity 高频界面文本。
- **高性能 `WeakMap` 隔离引擎**：通过单遍 `TreeWalker` + 首字符预筛选直接替换文本节点，**不克隆 DOM、不破坏 React Fiber 事件绑定**，支持一键关闭并无损还原英文原貌。
- **严格保护用户内容**：自动豁免代码块（`code` / `pre`）、Markdown 正文、Monaco 编辑器、Xterm 终端、用户提问气泡与对话标题。
- **个人词典热覆盖**：在 [user/i18n.override.json](user/i18n.override.json) 中追加 `"English": "中文"` 条目，2.5 秒内自动热生效。

### 2. Codex 极简纯白 & Onyx 暗夜双模式
- **日间默认 `codex-pure-white`**：纯粹 `#FFFFFF` 主画布、`#F9F9F9` 轻质侧栏、`#EFEFEF` 选中行、高对比纯黑墨水文字与 `#2B7FFF` 发送/主按钮，搭配标准无衬线与等宽字体栈（`Inter` / `PingFang SC` / `SF Mono` / `Fira Code`），即装即用无需额外字体包。
- **夜间无缝切换 `onyx-dark`**：当 Antigravity 处于深色模式时自动切换至官方 Onyx 暗夜配色（`#070708` / `#111114` / `#1F1F24`）。
- **悬浮双层圆角输入托盘**：Codex 标志性的 `24px` 外层柔光托盘 + `20px` 浮起卡片质感，保留内置浏览器穿孔透明区域（`[data-has-browser-hole="true"]`）。

### 3. 4 态状态指示灯与居中紧凑遥测胶囊
在输入框底部工具栏正中（`模型选择` 与 `权限/语音/发送` 之间）嵌入极简遥测胶囊：

```text
● 220 tok/s · Ctx 45% · Cache 90.7%
```

窄窗口时自动降级为输入框底部的细虚线独立一行；鼠标悬停或点击即可弹出 Bento 仪表盘，支持展开本步 TTFT、流式耗时、Thinking/正文 token、本轮多步汇总及全会话累计命中率：

| 状态灯形态 | 状态含义 | 触发条件 |
| :--- | :--- | :--- |
| **蓝色常亮** | 连接正常 / 就绪 | 会话流已连接且处于空闲就绪状态；用户主动停止生成（Cancel）后立即回落常亮 |
| **蓝色闪烁** | 执行中 | 模型推理流式输出、`/compact` 压缩或工具调用正在活跃推进 |
| **琥珀脉冲** | 慢等待 / 重试 / 重连中 | 等待首字或步骤推进超过 `60s`（含跨模型后 `/compact` KV 缓存冷启动）、模型自动重试连接中，或会话流建连延迟 `3s–11s` |
| **红色脉冲** | 连接断开或执行异常 | 网络离线、会话未连接或重连超时 `>= 12s`、API/步骤报错（排除主动取消），或守护进程心跳超时 `> 90s` |

### 4. 工程护栏与无痛运维
- **设置页死锁自愈 & 缩放快捷键**：自动修复 TanStack Router 设置弹窗假死导致的点击无响应，补齐 macOS (`Cmd + -/=/0`) 与 Windows/Linux (`Ctrl + -/=/0`) 界面缩放热键。
- **安全热重载 & 零重启更新**：修改 [user/config.json](user/config.json)、[user/custom.css](user/custom.css)、[user/custom.js](user/custom.js) 后约 2.5s 自动推入运行中窗口，无需重启 Antigravity。
- **安全模式（`--safe-mode`）**：仅加载经过 SHA-256 校验的 `core/` 内核，快速排查自定义脚本/样式冲突。

---

## 快速安装

> **前置要求**：Node.js **>= 22.0.0**（推荐 **>= 22.13.0** 以解锁内置 `node:sqlite` 实时指标读取），以及已启用或可注入远程调试端口的 Google Antigravity。

```bash
git clone https://github.com/<your-username>/antigravity-codex-theme.git
cd antigravity-codex-theme

# 安装并注册后台守护服务（支持 macOS LaunchAgents / Linux systemd / Windows schtasks）
node install.mjs install

# 诊断运行环境、core/ 文件哈希完整性与实时窗口挂载状态
node --disable-warning=ExperimentalWarning install.mjs doctor
```

> **提示**：安装器会自动向 `~/.antigravity/argv.json` 写入 `"remote-debugging-port": 9222`（Insiders 为 `9223`）。若 Antigravity 在安装前已启动且未开启调试端口，安装后**完全退出并重启一次 Antigravity** 即可生效。

<details>
<summary>常用 CLI 命令一览</summary>

| 命令 | 说明 |
| :--- | :--- |
| `node install.mjs install [--channel auto\|stable\|insiders] [--sync-user]` | 安装核心文件到 `~/.gemini/antigravity/codex-theme` 并配置开机自启服务；如存在旧版主题服务会自动平滑迁移 |
| `node --disable-warning=ExperimentalWarning install.mjs doctor` | 检查 Node 版本、Antigravity 调试端口、`core/manifest.json` 校验及实时页面状态 |
| `node --disable-warning=ExperimentalWarning install.mjs verify [--safe-mode]` | 执行单次 CDP 注入并验证页面挂载结果（支持安全模式隔离排查） |
| `node install.mjs rollback` | 从 `core.prev` 或时间戳备份恢复上一版本内核 |
| `node install.mjs uninstall` | 停止并移除系统后台服务，向打开窗口推送还原指令恢复英文原貌（保留 `user/` 配置） |
| `npm test` | 运行 Protobuf 解析、4 态状态机与仓库完整性/卫生自动化测试 |

</details>

---

## 自定义与热重载

安装后运行目录位于 `~/.gemini/antigravity/codex-theme/user/`（可随时编辑，2.5s 自动热更新）：

- [user/config.json](user/config.json)
  - `preset`: `"codex-pure-white"`（默认，深色自动协同切换为 `"onyx-dark"`）
  - `telemetryLayout`: `"compact"`（默认极简胶囊 `tok/s · Ctx % · Cache %`）或 `"detailed"`（含 `TTFT` / 绝对 token / `Out`）
  - `telemetryCacheMode`: `"session"`（默认累计缓存命中率）或 `"step"`（单步命中率）
  - `modules`: 可独立开关 `i18n`、`metrics`、`deadlockHealer`、`zoomShortcuts`、`customCss`、`customJs`
- [user/i18n.override.json](user/i18n.override.json)：补充或微调中英词条映射
- [user/custom.css](user/custom.css)：追加自定义 CSS 规则
- [user/custom.js](user/custom.js)：注入自定义前端钩子逻辑

---

## 模块化项目架构

```text
antigravity-codex-theme/
├── core/
│   ├── daemon/                 # 后台守护模块化核心
│   │   ├── paths.mjs           # 配置热读取、多文件拼装与通道发现
│   │   ├── protobuf.mjs        # 零依赖 Protobuf 线协议解析与 Step 错误提取
│   │   ├── ls-log.mjs          # language_server.log 重试尾部识别
│   │   ├── telemetry-renderer.mjs # Codex 胶囊与 Bento 卡片 HTML 渲染器
│   │   ├── sqlite-metrics.mjs  # O(1) 增量会话数据库统计
│   │   └── cdp-bridge.mjs      # CDP WebSocket 目标挂载、心跳与日志治理
│   ├── runtime/                # 按序拼装注入的浏览器运行时脚本
│   │   ├── 00-head.js          # 初始化与卸载还原清理
│   │   ├── 10-guards.js        # 设置弹窗死锁修复 & 缩放快捷键
│   │   ├── 20-theme-sync.js    # codex-pure-white / onyx-dark 自适应同步
│   │   ├── 30-antigravity-probe.js # React Fiber 运行态安全探针
│   │   ├── 40-status-machine.js # 纯函数 4 态状态机（可直接单元测试）
│   │   ├── 50-telemetry-ui.js  # 胶囊排版、悬浮卡片与等待计时器
│   │   ├── 60-i18n-engine.js   # WeakMap 无原型词典高性能汉化引擎
│   │   └── 90-tail.js          # DOMContentLoaded 挂载与 user/custom.js 钩子
│   ├── styles/                 # 模块化 CSS（底座 / Codex 纯白 / Onyx 深色 / 遥测）
│   ├── installer/              # 跨平台安装、自检与服务管理
│   ├── daemon.mjs              # 守护进程入口
│   ├── shared.mjs              # JSONC 安全解析、PID 校验与公共工具
│   ├── i18n.json               # 900+ 界面汉化词典
│   └── manifest.json           # core/ 全量 SHA-256 完整性清单
├── tests/                      # node:test 自动化测试（Protobuf / 状态机 / 完整性）
├── user/                       # 用户可热重载配置层
├── install.mjs                 # 跨平台 CLI
├── SKILL.md                    # 供 AI Agent 自动部署排障的技能说明
└── LICENSE                     # MIT License
```

---

## English Overview

**antigravity-codex-theme** brings **deep Chinese UI localization (900+ strings via a non-destructive `WeakMap` DOM translator)** together with a **minimal Codex pure-white light theme (`codex-pure-white`)**, **official Onyx dark mode (`onyx-dark`)**, and a **4-state telemetry LED + inline token metrics pill** to Google Antigravity via non-invasive Chrome DevTools Protocol (CDP) runtime injection.

It is an open-source Codex-style redesign and clean modular refactor inspired by open-source Antigravity runtime theming and localization tooling.

```bash
git clone https://github.com/<your-username>/antigravity-codex-theme.git
cd antigravity-codex-theme
node install.mjs install
npm test
```

## 开源与致谢

- **架构原型说明**：本项目基于开源社区对 Google Antigravity 运行时 CDP 热注入与 `WeakMap` 界面汉化方案的探索成果改造，围绕 **Codex 极简纯白视觉体系**、**汉化体验**、**四态精确状态指示灯** 与 **全模块化工程架构** 进行了重构与重写。
- **许可协议**：[MIT License](LICENSE)
