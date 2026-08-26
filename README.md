# nuwa-cli

[English](#nuwa-cli) | [简体中文](#简体中文)

Headless multi-engine agent CLI. `nuwa-cli` bundles ACP runtimes for Codex and Claude. A locally installed CLI is optional: when present, nuwa-cli reuses its `~/.claude` / `~/.codex` history and configuration; otherwise the session can run entirely from model, environment, and MCP configuration delivered over ACP.

---

## Install

**Recommended · new install** (interactive wizard — language, stop services if needed, global npm install, then login / start until Gateway is ready):

```bash
npx @nuwax-ai/nuwa-cli@latest install
```

Automation / CI (non-interactive; if already logged in, starts Gateway; if not, installs the package and prints how to finish):

```bash
npx -y @nuwax-ai/nuwa-cli@latest install --yes
```

**Alternative · S3 one-liner** (CN-reachable mirror). **Not installed:** tarball + PATH, then silent `install --yes --bootstrap`. **Already installed:** `nuwa-cli update <version> --yes` (same kernel as daily upgrades, including logged-in restart). Same version: skip.

```bash
# Windows (PowerShell)
irm https://s3.nuwax.com:9443/nuwax-packages/agent-engines/nuwa-cli/install-from-s3.ps1 | iex

# macOS / Linux
curl -fsSL https://s3.nuwax.com:9443/nuwax-packages/agent-engines/nuwa-cli/install-from-s3.sh | bash
```

> npm too slow? `NUWACLI_REGISTRY=https://registry.npmmirror.com` (bash) / `$env:NUWACLI_REGISTRY='https://registry.npmmirror.com'` (PowerShell). Skip login/start tail: `NUWACLI_NO_START=1`.

See [`docs/install-upgrade-split.md`](docs/install-upgrade-split.md) for the new-install vs upgrade split.

### Upgrade

Prefer **`nuwa-cli update`** (interactive confirm before stopping Gateway/Console/tunnels; `--yes` skips the prompt; releases Windows vendor `.exe` locks; incremental path; **logged-in → restart**). On Windows, **do not** run bare `npm i -g @nuwax-ai/nuwa-cli@…` while services are running — npm will `EBUSY` on locked `nuwax-lanproxy.exe` / `nuwax-codex.exe`. If you must use npm manually: `nuwa-cli stop --all` first, then install. `npx … install` when already installed hints to use `update` (overlay only with `--force`).

## Uninstall

**Recommended** (stops services, removes OS autostart if installed, `npm uninstall -g`; **keeps** `~/.nuwa-cli` by default):

```bash
npx @nuwax-ai/nuwa-cli@latest uninstall
```

Also delete user data (credentials / sessions / logs / workspaces):

```bash
npx @nuwax-ai/nuwa-cli@latest uninstall --purge --yes
```

Automation: `npx -y @nuwax-ai/nuwa-cli@latest uninstall --yes`.

> Distinct from `nuwa-cli service uninstall` (removes login autostart only, keeps the package).

---

## Quick start

```bash
nuwa-cli doctor                          # check environment
nuwa-cli chat -p "list files"            # one-shot, claude engine
nuwa-cli chat --engine codex -p "hello"  # one-shot, codex engine
nuwa-cli console                         # web dashboard (browser)
nuwa-cli gateway --domain https://agent.nuwax.com --saved-key <key>  # cloud tunnel
```

---

## Commands

### Core

| Command | Description |
|---|---|
| `nuwa-cli doctor` | Check Node, engines, login state, lanproxy health |
| `nuwa-cli chat` | Interactive REPL or one-shot (`-p`) with claude/codex |
| `nuwa-cli console` | Local web dashboard with streaming chat ([docs](docs/console.md)) |
| `nuwa-cli sessions` | List/resume local claude/codex session history |
| `nuwa-cli workspaces` | List local workspace directories (cloud-session files) |
| `nuwa-cli context` | Cross-engine context reference (read/digest/handoff) |

### Cloud & lifecycle

| Command | Description |
|---|---|
| `nuwa-cli gateway` | Auto-detect engine → login → start `serve --tunnel` ([docs](docs/gateway.md)) |
| `nuwa-cli serve` | Local HTTP API for scripting / IM integration ([docs](docs/serve-lifecycle.md)) |
| `nuwa-cli login` / `logout` / `status` | Nuwax account login (headless) |
| `nuwa-cli account` | Manage multiple accounts |
| `nuwa-cli config` | Get/set domain, lanproxy path, etc. |
| `nuwa-cli service` | OS-level autostart (LaunchAgent / systemd / Scheduled Task) |
| `nuwa-cli update` | Upgrade the npm package (preferred; confirms before stopping services; `--yes` for CI) |
| `nuwa-cli install` | First-time install wizard (usually via `npx @nuwax-ai/nuwa-cli@latest install`) |
| `nuwa-cli uninstall` | Remove the global package (usually via `npx … uninstall`; keeps `~/.nuwa-cli` unless `--purge`) |
| `nuwa-cli lang` | Show or set the UI language (`en` / `zh-CN` / `auto`) |

### Process management

```bash
nuwa-cli start                 # daemon Gateway only
nuwa-cli start --all           # Gateway + foreground Console
nuwa-cli stop                  # stop Gateway
nuwa-cli stop --all            # stop everything
nuwa-cli restart               # force-restart Gateway (kills all old processes first)
nuwa-cli restart --all         # force-restart Gateway + Console
nuwa-cli ps                    # list running processes
```

---

## Key features

- **Inherits your environment.** No API key injection by default — engines see your existing `~/.claude` / `~/.codex` config, MCP servers, skills, and model preferences.
- **ACP protocol.** Both engines driven over [Agent Client Protocol](https://agentclientprotocol.com), not CLI text scraping.
- **Model protocol routing.** When a session supplies `model_provider`, nuwa-cli auto-selects the engine: `api_protocol: openai` → codex, `api_protocol: anthropic` → claude. See [`docs/serve-lifecycle.md`](docs/serve-lifecycle.md).
- **Cloud tunnel.** `--tunnel` registers with Nuwax backend, starts file-server + lanproxy, and exposes the local agent to the cloud. See [`docs/gateway.md`](docs/gateway.md).
- **Health checks.** file-server HTTP `/health` polling (default 20s) + lanproxy cloud tunnel probe, with full start retry via `@nuwax-ai/agent-kit` `withStartRetry`. If file-server stays unhealthy, lanproxy is skipped. See [`docs/serve-health-check.md`](docs/serve-health-check.md).
- **Cross-platform.** Windows / macOS / Linux, arm64 / x64. All spawns use `windowsHide`. `.cmd` shims auto-detected.
- **S3 distribution.** One-line installer from Nuwax S3 mirror; no GitHub or npm login needed. See [`docs/distribution-s3.md`](docs/distribution-s3.md).
- **Engine stderr logging.** All engine stderr streamed to `~/.nuwa-cli/logs/` for diagnostics.

---

## Language

`nuwa-cli` defaults to **English**. Simplified Chinese (`zh-CN`) is shown automatically when your system locale is Simplified Chinese (`LANG` / `LC_ALL` / `LC_MESSAGES` / `LANGUAGE` containing `zh`, e.g. `zh_CN.UTF-8`, `zh-Hans`). Traditional Chinese locales (`zh-TW` / `zh-HK` / `zh-Hant`) fall back to English.

Override at any time — priority: `NUWACLI_LANG` env > config > auto-detect > English:

```bash
nuwa-cli lang               # show the current language and how it was resolved
nuwa-cli lang zh-CN         # persist Simplified Chinese to ~/.nuwa-cli/config.json
nuwa-cli lang en            # persist English
nuwa-cli lang auto          # follow the system locale again

NUWACLI_LANG=zh-CN nuwa-cli doctor   # one-off override (highest priority)
```

> ACP protocol responses (HTTP / SSE / permission outcomes) are always English regardless of this setting — they are consumed by clients and engines, not humans. Only terminal output is localized. See [`docs/i18n.md`](docs/i18n.md).

---

## `nuwa-cli serve` API

```bash
nuwa-cli serve --port 60016
# POST /computer/chat            → { session_id }
# GET  /computer/progress/:id    SSE stream
# GET/POST /computer/agent/status
# POST /computer/agent/stop
# GET  /health                   (no auth)
```

Accepts NuwaClaw-compatible `model_provider` / `agent_config` / `context_servers`. Precedence: session config > Gateway flags > local environment. ACP `mcpServers` / `context_servers` are passed to the engine as raw stdio MCP servers; both TS adapters (`claude-code-acp-ts` / `@nuwax-ai/nuwax-codex-acp-ts`) handle ACP `mcpServers` natively at the adapter layer.

Cloud-session files are stored under:

```text
~/.nuwa-cli/workspaces/<user_id>/<agent_work_dir>/
```

Use `nuwa-cli status` to view the registered computer name and service state.

### Browsing local session files

Files generated by cloud sessions are written under the workspace directory `~/.nuwa-cli/workspaces/<user_id>/<agent_work_dir>/`:

- `<user_id>` is your numeric Nuwax user ID;
- `<agent_work_dir>` is the project ID (a numeric directory) for each session.

Both IDs are visible in `nuwa-cli status` output or in `~/.nuwa-cli/logs/serve.*.log`.

You can also list workspace directories directly from the terminal with `nuwa-cli workspaces` (supports `--user <id>`, `--json`, and `--long` to print a per-project file tree) — no need to construct the path by hand:

```bash
nuwa-cli workspaces                  # list all users / projects
nuwa-cli workspaces --user <id>      # only one user
nuwa-cli workspaces --long           # print a file tree per project
```

Open the workspace directory on each platform:

```bash
# macOS (Finder)
open ~/.nuwa-cli/workspaces

# Windows (PowerShell, File Explorer)
explorer "$env:USERPROFILE\.nuwa-cli\workspaces"

# Linux
xdg-open ~/.nuwa-cli/workspaces
```

Or list all session directories for a user from the command line:

```bash
ls -la ~/.nuwa-cli/workspaces/<user_id>/
```

nuwa-cli also runs a local **file-server** (HTTP, default port `60015`, printed at `serve`/`gateway` startup) that mirrors the same workspace layout and exposes file list / preview / upload / tar endpoints — same paths the engine writes to. While `serve` is running it is reachable at `http://127.0.0.1:60015`.

See [`docs/serve-lifecycle.md`](docs/serve-lifecycle.md) for full lifecycle, auth, and permission details.

---

## Documentation

| Doc | Content |
|---|---|
| [`docs/gateway.md`](docs/gateway.md) | Gateway architecture, tunnel, daemon, service |
| [`docs/serve-lifecycle.md`](docs/serve-lifecycle.md) | serve lifecycle, auth, permission model, model routing |
| [`docs/console.md`](docs/console.md) | Web dashboard |
| [`docs/serve-health-check.md`](docs/serve-health-check.md) | file-server + lanproxy health probes |
| [`docs/distribution-s3.md`](docs/distribution-s3.md) | S3 distribution, publish, install |
| [`docs/acp-permission-guardrails.md`](docs/acp-permission-guardrails.md) | ACP permission flow |
| [`docs/i18n.md`](docs/i18n.md) | UI language (English default, Simplified Chinese, switching) |
| [`docs/local-debugging.md`](docs/local-debugging.md) | Local dev setup |

---

## Requirements

- Node.js >= 22
- `claude` and/or `codex` CLI installed and logged in (optional when ACP supplies model config)

## Known limitations

- **Process-tree teardown on host crash**: engine process groups are signalled through SIGTERM→SIGKILL on stop/shutdown; if the host itself is SIGKILLed or crashes, grandchildren may still be orphaned (watchdog planned).
- **No path confinement in yolo**: `--approve auto` auto-approves all ordinary tool calls regardless of target path.
- **Prompt timeout**: 5 minutes per prompt; engine hangs produce an error instead of infinite wait.
- **MCP startup**: engines wait for MCP servers to initialize before first prompt; `npm exec` MCP servers may take minutes on first run. MCP servers are injected as raw stdio; both TS adapters handle ACP `mcpServers` natively at the adapter layer. `chrome-devtools` is always enabled by default as a raw stdio MCP (`npx -y chrome-devtools-mcp@latest`, one per session, no cross-session persistence, no `--isolated`). `@nuwax-ai/mcp-proxy-ts` remains a dependency for host adapter tool / default service merging, but is no longer used to inject a proxy entry for the engine.
- **Custom ACP engines** (pi-acp, hermes, kilo, etc.) not supported — only `claude` and `codex`.

---

## 简体中文

[English](#nuwa-cli) | 简体中文

无界面（headless）的多引擎 Agent 命令行工具。`nuwa-cli` 已内置 Codex 与 Claude 的 ACP 运行时；本机无需预装对应 CLI。若本机已有 `claude` / `codex`，会复用 `~/.claude` / `~/.codex` 的历史和配置；否则可完全使用 ACP 下发的模型、环境变量与 MCP 配置运行。

---

### 安装

**推荐 · 新装**（交互向导：选语言、按需停服务、全局安装，再登录 / start 直到 Gateway 就绪）：

```bash
npx @nuwax-ai/nuwa-cli@latest install
```

自动化 / CI（非交互；已登录则 start；未登录则只装包并提示收尾）：

```bash
npx -y @nuwax-ai/nuwa-cli@latest install --yes
```

**备选 · S3 一键**（国内可达镜像）。**未安装：** tarball + PATH，再静默 `install --yes --bootstrap`。**已安装：** `nuwa-cli update <version> --yes`（与日常升级同一内核，含已登录 restart）。同版本：跳过。

```bash
# Windows (PowerShell)
irm https://s3.nuwax.com:9443/nuwax-packages/agent-engines/nuwa-cli/install-from-s3.ps1 | iex

# macOS / Linux
curl -fsSL https://s3.nuwax.com:9443/nuwax-packages/agent-engines/nuwa-cli/install-from-s3.sh | bash
```

> npm 太慢？`NUWACLI_REGISTRY=https://registry.npmmirror.com`（bash）/ `$env:NUWACLI_REGISTRY='https://registry.npmmirror.com'`（PowerShell）。跳过 login/start：`NUWACLI_NO_START=1`。

分流细节见 [`docs/install-upgrade-split.md`](docs/install-upgrade-split.md)。

### 升级

请优先使用 **`nuwa-cli update`**（有服务在跑时交互确认是否停止；`--yes` 跳过确认；释放 Windows vendor `.exe` 锁；增量路径；**已登录 → restart**）。Windows 上**不要**在服务仍运行时裸跑 `npm i -g @nuwax-ai/nuwa-cli@…`——npm 会对被锁的 `nuwax-lanproxy.exe` / `nuwax-codex.exe` 报 `EBUSY`。若必须手动 npm：先 `nuwa-cli stop --all`，再安装。已安装时 `npx … install` 会提示改用 `update`（仅 `--force` 覆盖）。

### 卸载

**推荐**（停服务、移除开机自启、`npm uninstall -g`；**默认保留** `~/.nuwa-cli`）：

```bash
npx @nuwax-ai/nuwa-cli@latest uninstall
```

同时删除用户数据（凭证 / 会话 / 日志 / 工作空间）：

```bash
npx @nuwax-ai/nuwa-cli@latest uninstall --purge --yes
```

自动化：`npx -y @nuwax-ai/nuwa-cli@latest uninstall --yes`。

> 与 `nuwa-cli service uninstall` 不同（后者只卸登录自启，保留全局包）。

---

### 快速开始

```bash
nuwa-cli doctor                          # 检查环境
nuwa-cli doctor --fix                     # 检测并自动修复可处理的问题
nuwa-cli chat -p "列出当前目录下的文件"    # 单次，claude 引擎
nuwa-cli chat --engine codex -p "hello"  # 单次，codex 引擎
nuwa-cli console                         # Web 控制台（浏览器）
nuwa-cli gateway --domain https://agent.nuwax.com --saved-key <key>  # 云端隧道
```

---

### 命令

#### 核心

| 命令 | 说明 |
|---|---|
| `nuwa-cli doctor` | 检查 Node、引擎、登录态、lanproxy 健康；`--fix` 自动修自启与服务异常 |
| `nuwa-cli chat` | 交互式 REPL 或单次模式（`-p`），支持 claude/codex |
| `nuwa-cli console` | 本机 Web 控制台，流式聊天（[文档](docs/console.md)） |
| `nuwa-cli sessions` | 列出/续接本地 claude/codex 会话历史 |
| `nuwa-cli workspaces` | 列出本地工作空间目录（云端会话生成的文件） |
| `nuwa-cli context` | 跨引擎上下文引用（read/digest/handoff） |

#### 云端与生命周期

| 命令 | 说明 |
|---|---|
| `nuwa-cli gateway` | 自动检测引擎 → 登录 → 启动 `serve --tunnel`（[文档](docs/gateway.md)） |
| `nuwa-cli serve` | 本机 HTTP API，供脚本/IM 集成（[文档](docs/serve-lifecycle.md)） |
| `nuwa-cli login` / `logout` / `status` | Nuwax 账号登录（无 UI） |
| `nuwa-cli account` | 管理多个账号 |
| `nuwa-cli config` | 获取/设置 domain、lanproxy 路径等 |
| `nuwa-cli service` | 系统级开机自启（LaunchAgent / systemd / 计划任务） |
| `nuwa-cli update` | 升级 npm 包（推荐；有服务时确认停止；`--yes` 供 CI） |
| `nuwa-cli install` | 首次安装向导（通常：`npx @nuwax-ai/nuwa-cli@latest install`） |
| `nuwa-cli uninstall` | 卸载全局包（通常：`npx … uninstall`；默认保留 `~/.nuwa-cli`，`--purge` 才清数据） |
| `nuwa-cli lang` | 查看或设置界面语言（`en` / `zh-CN` / `auto`） |

#### 进程管理

```bash
nuwa-cli start                 # 后台 Gateway
nuwa-cli start --all           # Gateway + 前台 Console
nuwa-cli stop                  # 停止 Gateway
nuwa-cli stop --all            # 停止全部
nuwa-cli restart               # 强制重启 Gateway（先杀所有旧进程）
nuwa-cli restart --all         # 强制重启 Gateway + Console
nuwa-cli ps                    # 查看运行中的进程
```

开机后或脚本里跑 `start`：若已安装登录自启，Gateway 可能已在后台拉起，`start` 会先等待隧道就绪再复用。做 `start --force` / `restart` 重试时请等当前命令结束，或先 `nuwa-cli status` 确认 Gateway 与 lanproxy 已就绪，再决定是否再次强制启动。

---

### 核心特性

- **继承你的环境。** 默认不注入任何凭证——引擎看到的就是你已有的 `~/.claude` / `~/.codex` 配置、MCP server、skills 和模型偏好。
- **走 ACP 协议。** 两个引擎都通过 [Agent Client Protocol](https://agentclientprotocol.com) 驱动，不是 CLI 文本抓取。
- **模型协议路由。** 会话下发 `model_provider` 时，按协议自动选引擎：`api_protocol: openai` → codex，`api_protocol: anthropic` → claude。详见 [`docs/serve-lifecycle.md`](docs/serve-lifecycle.md)。
- **云端隧道。** `--tunnel` 注册到 Nuwax 后端，启动 file-server + lanproxy，把本机 Agent 暴露给云端。详见 [`docs/gateway.md`](docs/gateway.md)。
- **健康检查。** 启动后对 file-server HTTP `/health` 轮询（默认 20s）+ lanproxy 云端隧道探测，经 `@nuwax-ai/agent-kit` `withStartRetry` 完整重试；file-server 最终不健康则跳过 lanproxy。详见 [`docs/serve-health-check.md`](docs/serve-health-check.md)。
- **跨平台。** Windows / macOS / Linux，arm64 / x64。所有子进程 spawn 使用 `windowsHide`；`.cmd` 脚本自动检测。
- **S3 分发。** 从 Nuwax S3 镜像一键安装，无需 GitHub 或 npm 登录。详见 [`docs/distribution-s3.md`](docs/distribution-s3.md)。
- **引擎日志。** 引擎 stderr 实时写入 `~/.nuwa-cli/logs/`，便于诊断。

---

### 语言

`nuwa-cli` **默认英文**。当系统 locale 为简体中文（`LANG` / `LC_ALL` / `LC_MESSAGES` / `LANGUAGE` 含 `zh`，如 `zh_CN.UTF-8`、`zh-Hans`）时自动显示简体中文；繁体中文（`zh-TW` / `zh-HK` / `zh-Hant`）回退英文。

随时可切换——优先级：`NUWACLI_LANG` 环境变量 > 配置 > 自动检测 > 英文：

```bash
nuwa-cli lang               # 查看当前语言及解析来源
nuwa-cli lang zh-CN         # 持久化简体中文到 ~/.nuwa-cli/config.json
nuwa-cli lang en            # 持久化英文
nuwa-cli lang auto          # 重新跟随系统 locale

NUWACLI_LANG=zh-CN nuwa-cli doctor   # 临时覆盖（优先级最高）
```

> ACP 协议响应（HTTP / SSE / permission 结果）**始终为英文**，与界面语言无关——它们是给客户端/引擎消费的协议数据，不是给人看的。只有终端输出会本地化。详见 [`docs/i18n.md`](docs/i18n.md)。

---

### `nuwa-cli serve` API

```bash
nuwa-cli serve --port 60016
# POST /computer/chat            → { session_id }
# GET  /computer/progress/:id    SSE 流
# GET/POST /computer/agent/status
# POST /computer/agent/stop
# GET  /health                   （无需鉴权）
```

兼容 NuwaClaw 的 `model_provider` / `agent_config` / `context_servers`。优先级：会话配置 > Gateway 参数 > 本地环境。ACP 下发的 `mcpServers` / `context_servers` 作为原始 stdio MCP 交给引擎；`claude-code-acp-ts` / `@nuwax-ai/nuwax-codex-acp-ts` 两个 TS adapter 在 adapter 层原生处理 ACP `mcpServers`。

云端会话生成的本地文件位于：

```text
~/.nuwa-cli/workspaces/<user_id>/<agent_work_dir>/
```

运行 `nuwa-cli status` 可查看“我的电脑”名称和服务状态。

#### 查看本地会话文件

云端会话生成的文件写入工作空间目录 `~/.nuwa-cli/workspaces/<user_id>/<agent_work_dir>/`：

- `<user_id>` 是你的 Nuwax 数字用户 ID；
- `<agent_work_dir>` 是每次会话的项目 ID（数字目录）。

这两个 ID 可在 `nuwa-cli status` 输出或 `~/.nuwa-cli/logs/serve.*.log` 日志里找到。

也可直接在终端用 `nuwa-cli workspaces` 列出工作空间目录（支持 `--user <id>` 过滤、`--json`、`--long` 列文件树），无需手动拼路径：

```bash
nuwa-cli workspaces                  # 列出所有用户/项目
nuwa-cli workspaces --user <id>      # 只看某个用户
nuwa-cli workspaces --long           # 列出每个项目内的文件树
```

各平台打开工作空间目录：

```bash
# macOS（Finder）
open ~/.nuwa-cli/workspaces

# Windows（PowerShell，资源管理器）
explorer "$env:USERPROFILE\.nuwa-cli\workspaces"

# Linux
xdg-open ~/.nuwa-cli/workspaces
```

或命令行浏览某个用户下的所有会话目录：

```bash
ls -la ~/.nuwa-cli/workspaces/<user_id>/
```

nuwa-cli 还会启动本地**文件服务**（HTTP，默认端口 `60015`，`serve`/`gateway` 启动时打印）——它镜像相同的工作空间布局，提供文件列表 / 预览 / 上传 / 打包接口，路径与引擎写入的位置一致。serve 运行时可通过 `http://127.0.0.1:60015` 访问。

详见 [`docs/serve-lifecycle.md`](docs/serve-lifecycle.md)。

---

### 文档

| 文档 | 内容 |
|---|---|
| [`docs/gateway.md`](docs/gateway.md) | Gateway 架构、隧道、daemon、服务 |
| [`docs/serve-lifecycle.md`](docs/serve-lifecycle.md) | serve 生命周期、鉴权、权限模型、模型路由 |
| [`docs/console.md`](docs/console.md) | Web 控制台 |
| [`docs/serve-health-check.md`](docs/serve-health-check.md) | file-server + lanproxy 健康探测 |
| [`docs/distribution-s3.md`](docs/distribution-s3.md) | S3 分发、发布、安装 |
| [`docs/acp-permission-guardrails.md`](docs/acp-permission-guardrails.md) | ACP 权限审批流程 |
| [`docs/i18n.md`](docs/i18n.md) | 界面语言（英文默认、简体中文、切换） |
| [`docs/local-debugging.md`](docs/local-debugging.md) | 本地开发调试 |

---

### 运行要求

- Node.js >= 22
- `claude` 和/或 `codex` CLI，已安装并登录（ACP 下发模型配置时可省略）

### 已知限制

- **进程树清理（宿主崩溃时）**：stop/shutdown 路径会对引擎进程组执行 SIGTERM→SIGKILL 整树清理；若宿主自身被 SIGKILL 或崩溃，孙进程仍可能孤儿化（watchdog 待立项）。
- **yolo 无路径限制**：`--approve auto` 对普通工具不论目标路径一律自动批准。
- **Prompt 超时**：每条 prompt 限时 5 分钟，引擎卡住时报错而非无限等待。
- **MCP 启动**：引擎等所有 MCP server 初始化后才处理首条消息；`npm exec` MCP server 首次可能需数分钟。MCP server 以原始 stdio 形式注入引擎，两个 TS adapter 在 adapter 层原生处理 ACP `mcpServers`。默认始终启用 `chrome-devtools`（`npx -y chrome-devtools-mcp@latest`，每 session 自启，无跨 session 持久化，无 `--isolated`）。注意：`@nuwax-ai/mcp-proxy-ts` 仍是依赖（host adapter 工具/默认服务合并），但不再用于给 engine 注入 proxy 入口。
- **自定义 ACP 引擎**（pi-acp、hermes、kilo 等）暂不支持——仅支持 `claude` 和 `codex`。
