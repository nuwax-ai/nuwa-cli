# nuwa-cli

[English](README.md) | 简体中文

无界面（headless）的多引擎 Agent 命令行工具。`nuwa-cli` 已内置 Codex 与 Claude 的 ACP 运行时；本机无需预装对应 CLI。若本机已有 `claude` / `codex`，会复用 `~/.claude` / `~/.codex` 的历史和配置；否则可完全使用 ACP 下发的模型、环境变量与 MCP 配置运行。

---

## 安装

**一键安装**（S3 镜像，国内可达，自动配置 PATH）：

```bash
# Windows (PowerShell)
irm https://s3.nuwax.com:9443/nuwax-packages/agent-engines/nuwa-cli/install-from-s3.ps1 | iex

# macOS / Linux
curl -fsSL https://s3.nuwax.com:9443/nuwax-packages/agent-engines/nuwa-cli/install-from-s3.sh | bash
```

或通过 npm 安装（需要 Node.js 22+）：

```bash
npm install -g @nuwax-ai/nuwa-cli@beta --progress=true
nuwa-cli doctor
```

> npm 太慢？`NUWACLI_REGISTRY=https://registry.npmmirror.com`（bash）/ `$env:NUWACLI_REGISTRY='https://registry.npmmirror.com'`（PowerShell）。

---

## 快速开始

```bash
nuwa-cli doctor                          # 检查环境
nuwa-cli chat -p "列出当前目录下的文件"    # 单次，claude 引擎
nuwa-cli chat --engine codex -p "hello"  # 单次，codex 引擎
nuwa-cli console                         # Web 控制台（浏览器）
nuwa-cli gateway --domain https://agent.nuwax.com --saved-key <key>  # 云端隧道
```

---

## 命令

### 核心

| 命令 | 说明 |
|---|---|
| `nuwa-cli doctor` | 检查 Node、引擎、登录态、lanproxy 健康 |
| `nuwa-cli chat` | 交互式 REPL 或单次模式（`-p`），支持 claude/codex |
| `nuwa-cli console` | 本机 Web 控制台，流式聊天（[文档](docs/console.md)） |
| `nuwa-cli sessions` | 列出/续接本地 claude/codex 会话历史 |
| `nuwa-cli context` | 跨引擎上下文引用（read/digest/handoff） |

### 云端与生命周期

| 命令 | 说明 |
|---|---|
| `nuwa-cli gateway` | 自动检测引擎 → 登录 → 启动 `serve --tunnel`（[文档](docs/gateway.md)） |
| `nuwa-cli serve` | 本机 HTTP API，供脚本/IM 集成（[文档](docs/serve-lifecycle.md)） |
| `nuwa-cli login` / `logout` / `status` | Nuwax 账号登录（无 UI） |
| `nuwa-cli account` | 管理多个账号 |
| `nuwa-cli config` | 获取/设置 domain、lanproxy 路径等 |
| `nuwa-cli service` | 系统级开机自启（LaunchAgent / systemd / 计划任务） |
| `nuwa-cli update` | 升级 npm 包 |

### 进程管理

```bash
nuwa-cli start                 # 后台 Gateway
nuwa-cli start --all           # Gateway + 前台 Console
nuwa-cli stop                  # 停止 Gateway
nuwa-cli stop --all            # 停止全部
nuwa-cli restart               # 强制重启 Gateway（先杀所有旧进程）
nuwa-cli restart --all         # 强制重启 Gateway + Console
nuwa-cli ps                    # 查看运行中的进程
```

---

## 核心特性

- **继承你的环境。** 默认不注入任何凭证——引擎看到的就是你已有的 `~/.claude` / `~/.codex` 配置、MCP server、skills 和模型偏好。
- **走 ACP 协议。** 两个引擎都通过 [Agent Client Protocol](https://agentclientprotocol.com) 驱动，不是 CLI 文本抓取。
- **模型协议路由。** 会话下发 `model_provider` 时，按协议自动选引擎：`api_protocol: openai` → codex，`api_protocol: anthropic` → claude。详见 [`docs/serve-lifecycle.md`](docs/serve-lifecycle.md)。
- **云端隧道。** `--tunnel` 注册到 Nuwax 后端，启动 file-server + lanproxy，把本机 Agent 暴露给云端。详见 [`docs/gateway.md`](docs/gateway.md)。
- **健康检查。** 启动后对 file-server HTTP `/health` 轮询 + lanproxy 云端隧道探测。详见 [`docs/serve-health-check.md`](docs/serve-health-check.md)。
- **跨平台。** Windows / macOS / Linux，arm64 / x64。所有子进程 spawn 使用 `windowsHide`；`.cmd` 脚本自动检测。
- **S3 分发。** 从 Nuwax S3 镜像一键安装，无需 GitHub 或 npm 登录。详见 [`docs/distribution-s3.md`](docs/distribution-s3.md)。
- **引擎日志。** 引擎 stderr 实时写入 `~/.nuwa-cli/logs/`，便于诊断。

---

## `nuwa-cli serve` API

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

### 查看本地会话文件

云端会话生成的文件写入工作空间目录 `~/.nuwa-cli/workspaces/<user_id>/<agent_work_dir>/`：

- `<user_id>` 是你的 Nuwax 数字用户 ID；
- `<agent_work_dir>` 是每次会话的项目 ID（数字目录）。

这两个 ID 可在 `nuwa-cli status` 输出或 `~/.nuwa-cli/logs/serve.*.log` 日志里找到。

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

## 文档

| 文档 | 内容 |
|---|---|
| [`docs/gateway.md`](docs/gateway.md) | Gateway 架构、隧道、daemon、服务 |
| [`docs/serve-lifecycle.md`](docs/serve-lifecycle.md) | serve 生命周期、鉴权、权限模型、模型路由 |
| [`docs/console.md`](docs/console.md) | Web 控制台 |
| [`docs/serve-health-check.md`](docs/serve-health-check.md) | file-server + lanproxy 健康探测 |
| [`docs/distribution-s3.md`](docs/distribution-s3.md) | S3 分发、发布、安装 |
| [`docs/acp-permission-guardrails.md`](docs/acp-permission-guardrails.md) | ACP 权限审批流程 |
| [`docs/local-debugging.md`](docs/local-debugging.md) | 本地开发调试 |

---

## 运行要求

- Node.js >= 22
- `claude` 和/或 `codex` CLI，已安装并登录（ACP 下发模型配置时可省略）

## 已知限制

- **进程树清理**：孙进程（如 `claude-code-acp-ts` 拉起的 `claude` 二进制）不会被信号通知，可能成为孤儿。
- **yolo 无路径限制**：`--approve auto` 对普通工具不论目标路径一律自动批准。
- **Prompt 超时**：每条 prompt 限时 5 分钟，引擎卡住时报错而非无限等待。
- **MCP 启动**：引擎等所有 MCP server 初始化后才处理首条消息；`npm exec` MCP server 首次可能需数分钟。MCP server 以原始 stdio 形式注入引擎，两个 TS adapter 在 adapter 层原生处理 ACP `mcpServers`。默认始终启用 `chrome-devtools`（`npx -y chrome-devtools-mcp@latest`，每 session 自启，无跨 session 持久化，无 `--isolated`）。注意：`@nuwax-ai/mcp-proxy-ts` 仍是依赖（host adapter 工具/默认服务合并），但不再用于给 engine 注入 proxy 入口。
- **自定义 ACP 引擎**（pi-acp、hermes、kilo 等）暂不支持——仅支持 `claude` 和 `codex`。
