# `nuwa-cli console` — 本地 Web Console

`nuwa-cli console` 启动一个**仅本机**（默认 `127.0.0.1:60017`）的 HTTP 服务，自动打开浏览器单页应用，把 `chat` / `sessions` / 引擎与模型/模式切换、以及流式聊天集中到一个可视化界面。零额外运行时依赖——页面用原生 HTML/CSS/JS 写成，由 esbuild 在构建时内联进 `dist/cli.js`。

## 快速开始

```bash
npm run build
node dist/cli.js console                 # 默认 claude 引擎，自动开浏览器
node dist/cli.js console --engine codex  # 默认 codex（界面内仍可切换）
node dist/cli.js console --no-open       # 不自动开浏览器，自行打开打印出的 URL
```

需要同时启动完整运行环境时使用 `nuwa-cli start`：Gateway 会进入后台，Console 留在当前终端前台运行。

启动会打印一行带一次性 token 的本地地址，例如：

```
nuwa-cli console 已启动：http://127.0.0.1:60017/?t=350a8a358178872db9325b2f66b089ba35e37dda53c2a8dc
```

`Ctrl+C` 退出。

## 界面能做什么

- **左侧 · 会话列表**：合并展示本地 `claude`/`codex` 历史会话（带引擎徽标和**模型徽标**）与当前在线会话。
  - 「续接」：对该历史会话走 ACP `session/load` 真·续接（使用其原始 `cwd`）。
  - 「查看」：只读浏览该会话的规范化转录消息。
  - 「+ 新建」：以默认引擎和 `--cwd`（或默认工作区）开一个全新会话。
- **顶部控制条**：
  - **引擎**：新建会话时选 `claude` / `codex`（两个引擎的可用性由 `/api/engines` 探测）。
  - **模式**：下拉取自引擎返回的 `modes.availableModes`（如 `default` / `acceptEdits` / `plan` / `bypassPermissions` / `dontAsk`），切换经 `session/set_mode`。
  - **模型**：若引擎通过 ACP `configOptions`（`category: "model"`）暴露了模型选择器，则下拉可选、切换经 `session/set_config_option`；否则只读展示模型 hint，下拉禁用并给出说明。
- **中间聊天区**：发消息后经 SSE（`EventSource`）流式接收 `agent_message_chunk` / 思考片段 / 工具调用；`end_turn` 标记本轮结束。
- **权限审批**：`--approve ask` 或命中敏感分类时，工具调用会在聊天区弹出「批准 / 拒绝」按钮，回执经 `POST /api/live/:id/permission/:interventionId`。

## 参数

| 参数 | 默认 | 含义 |
|---|---|---|
| `--engine` | `claude` | 默认引擎（界面内仍可切换） |
| `--port` | `60017` | 监听端口；占用时自动向后寻找可用端口 |
| `--host` | `127.0.0.1` | 监听地址（仅建议回环） |
| `--cwd` | `~/.nuwa-cli/workspaces` | 新会话的默认工作目录 |
| `--approve` | `auto` | `auto`（普通工具自动批准，敏感操作仍弹审批）/ `ask`（逐个审批）/ `deny`（全拒绝） |
| `--no-open` | — | 启动后不自动打开浏览器 |
| `--api-key` / `--base-url` / `--model` | — | 覆盖模型连接（同 `chat`） |

## 模型信息从哪来

界面里模型有三个来源，按视图不同分别使用：

1. **在线会话**（最权威）：取自 ACP `session/new` / `session/load` 响应里的 `configOptions`（`category === "model"` 的 `currentValue`）。
2. **历史列表徽标**：从转录文件解析——claude 取 assistant 消息的 `message.model`，codex 取 `turn_context` 行的 `payload.model`。缺失则不显示徽标。
3. **引擎面板（无会话时）**：读引擎本地配置做 hint——claude 读 `~/.claude/settings.json` 的 `model`（或 `env.ANTHROPIC_MODEL` 等），codex 读 `~/.codex/config.toml` 的 `model = "..."`。

## 鉴权与安全

- 服务只绑定回环地址；每个路由都要一次性 token（`X-Nuwax-Ui-Token` 头或 `?t=` 查询），且 `Host` 必须是回环地址。
- token 启动时随机生成、内嵌进返回的 HTML，浏览器无需手输；它同时阻挡其它网页的 drive-by / DNS-rebinding 请求（跨源页读不到该 token）。
- `--approve auto`（默认）对普通工具自动批准、**没有路径限制**；敏感分类（如本地 session 历史）仍强制在浏览器内弹审批。需要逐个审批用 `--approve ask`，需要纯对话用 `--approve deny`。

## 与 `serve` 的关系

| | `nuwa-cli console` | `nuwa-cli serve` |
|---|---|---|
| 面向 | 人在本机前的可视化操作 | 脚本 / 云端 / IM 的机器 API |
| 形态 | 浏览器单页应用 + JSON/SSE | JSON + SSE（无 UI） |
| 默认端口 | `60017` | `60016` |
| 运行方式 | 前台；`Ctrl+C` 退出 | 可 `--daemon` / `service install` 常驻 |
| 鉴权 | 内嵌一次性 token（用户无感） | `X-Nuwax-Internal-Secret`（需从启动输出取） |

两者独立，可同时运行。Console 复用 Gateway 的 `SessionHub` 与权限审批通道（`acpRequestPermission` + `ApprovalPendingService`），但它是**前台**工具，不提供 `--daemon` / `service install`；无人值守的远程调度使用 Gateway。

`nuwa-cli start` 会编排两者：复用或后台启动 Gateway，然后复用或前台启动 Console。`nuwa-cli start --force` 会强制替换两者。

## HTTP 接口（参考）

前端调用的本地接口（均需 token）：

- `GET /` — 单页应用。
- `GET /api/engines` — 引擎探测 + 模型 hint + 当前权限策略。
- `GET /api/sessions` — 本地历史会话列表（含 `model`）。
- `GET /api/sessions/:engine/:id/transcript?file=` — 只读转录（`file` 必须位于该引擎的转录根目录下）。
- `POST /api/sessions` / `POST /api/sessions/resume` — 新建 / 续接。
- `GET /api/live` — 在线会话列表（含 `modes` / `configOptions` / `model` / `ready`）。
- `POST /api/live/:id/{prompt,mode,config-option,stop}` — 驱动 / 切换 / 停止。
- `POST /api/live/:id/permission/:interventionId` — 权限回执。
- `GET /api/live/:id/events` — SSE 事件流（`session_ready` / `session_state` / `session_prompt_start` / `agent_session_update` / `end_turn` / `session_ended` / `acpRequestPermission`）。

## 排错

- **浏览器没自动打开**：用启动日志里的完整 URL（含 `?t=`）手动打开；或检查 `open` / `xdg-open` 是否在 `PATH`。
- **页面 401**：URL 里少了 token，或 `Host` 不是回环地址（不要用代理/非回环主机名访问）。
- **模型下拉显示「未暴露」**：该引擎未通过 ACP `configOptions` 暴露模型选择器，属预期降级；模式下拉不受影响。
- **端口被占**：`--port` 指定的端口占用时会自动后移，实际端口见启动日志。
