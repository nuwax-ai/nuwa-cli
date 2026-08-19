# nuwa-cli serve 修复验收报告

- **分支**：`feat/serve-system-prompt-bridge-stability`
- **日期**：2026-08-19
- **提交**：`ce54dad` · `a8b8ea3` · `9af8fa4`
- **测试**：489 passed / 63 files（含新增 5 用例）
- **改动范围**：仅 nuwa-cli 仓库；agent-kit / mcp-proxy-ts / 云端配置均未改动

| 问题 | 状态 |
|---|---|
| system_prompt 丢失 — 云端系统提示未下发到 agent | ✅ 已修复 |
| chrome_tools ENOENT — codex 会话 MCP 启动失败 | ✅ 已修复 |
| PersistentMcpBridge 每会话重启 — 跨 agent 并行互踩 | ✅ 已修复 |

---

## §0 概览

三个问题同源于一次排查：Console 设置的系统提示在 nuwa-cli serve 链路未生效，而 nuwaclaw 客户端正常。顺藤摸瓜确认三处缺陷，全部在 nuwa-cli 仓库内修复。

| 问题 | 根因 | 修复 | Commit |
|---|---|---|---|
| system_prompt 丢失 | `parseDownstreamSessionConfig` 白名单无该字段，静默丢弃；三条会话路径均未组装 `_meta.systemPrompt` | 解析顶层 `system_prompt`，new / load / reconfigure 全路径经 `_meta.systemPrompt = { append }` 注入 | `ce54dad` `a8b8ea3` |
| chrome_tools ENOENT | 云端下发的 `chrome-tools` 与内置 `chrome-devtools` 跨名不等价，按 ephemeral 下发且 command 本机不可用 | 跨名等价兜底折叠：npx 裸包名相同即命中内置 persistent 条目 | `9af8fa4` |
| bridge 每会话重启 | `PersistentMcpBridge.start` 为 stop-first，宿主每会话无条件调用，无配置比对守卫 | 宿主层稳定序列化快照比对，配置未变直接复用运行中 bridge | `ce54dad` |

---

## §1 system_prompt 接入

云端契约（以 nuwaclaw `router.ts` 为准）在 `/computer/chat` body 顶层携带 `system_prompt`。nuwaclaw 经 ACP `session/new` 的 `_meta.systemPrompt = { append }` 扩展通道注入；两个引擎适配层均解析该通道（codex 侧映射为 `developerInstructions`）。

**修复前的断链**：

```
body.system_prompt
  → parseDownstreamSessionConfig   ✗ 白名单丢弃
  → session/new（无 _meta）
  → agent 收不到
```

**修复点**：

- **解析** — `downstreamConfig.ts`：`DownstreamSessionConfig` 增加 `systemPrompt`，取 `body.system_prompt`（兼容 camelCase），空白视同未下发。
- **传递** — `sessionHub.ts`：`SessionRuntimeOptions` / `ManagedSession` / `runtimeMatches` / `reconfigureSession` 全链路携带。
- **注入（三条路径全覆盖）**：
  1. 新会话：`ctx.buildSession({ cwd, mcpServers, _meta })`
  2. auto-resume：`session/load` 同样带 `_meta` — 排查中发现 codex-acp 的 `loadSession` 与 claude-acp 的 load 复用路径**同样解析** `_meta.systemPrompt`，而 auto-resume 是常态路径（`a8b8ea3` 补漏）
  3. 内存命中 reconfigure：重建 runner 走 buildSession，自动生效

**注入形态**（对齐 nuwaclaw acpNewSessionParams）：

```ts
.buildSession({
  cwd, mcpServers,
  _meta: { systemPrompt: { append: session.systemPrompt } },
})
```

---

## §2 MCP 跨名等价兜底折叠

云端 Console 配置的 `chrome-tools`（日志显示为下划线形态 `chrome_tools`，系 `sanitizeMcpServerNames` 为 codex `mcp__server__tool` 命名空间做的规范化）与内置 `chrome-devtools` 是同一服务的两份配置。内置那份由 PersistentMcpBridge 托管且工作正常；云端那份按 ephemeral stdio 下发，command 在本机不可用，codex 引擎 spawn 报 `os error 2`（ENOENT）。

对齐 nuwaclaw `mergeMcpServerConfigs`「同 key 以本地为准」的去重语义，并扩展到跨名等价 —— **内置默认保留，云端配置无需删除**：

| 云端下发 | 判定 | 结果 |
|---|---|---|
| `chrome-tools`（`npx chrome-devtools-mcp@任意版本`） | npx 裸包名 ≡ 内置条目 | **折叠**：云端条目丢弃，内置 persistent 桥兜底，不再 ephemeral 下发 |
| `chrome-devtools`（同名，定制 args） | 同名 | **覆盖**：云端定制保留，persistent 标记不丢（原语义不变） |
| `nuwax-openui` / `ask-question` 等 | 不等价 | 正常 ephemeral 下发 |

- 等价键：npx 形态取裸包名（忽略 `-y`/`-p` 与 `@version` 后缀，scoped 包安全）；非 npx 按 command+args 完全一致（保守）。
- 折叠丢弃云端等价条目的 env / allowTools 定制 —— 与 nuwaclaw「本地为准」一致，命中时打日志可观测。
- 实现位置：`proxyRewrite.ts` 的 `foldEquivalentToDefaults()`，在 merge 阶段、npx 解析改写之前执行。

---

## §3 PersistentMcpBridge 防抖

mcp-proxy-ts 的 `bridge.start()` 是 stop-first 语义（已运行先杀再起），而宿主每个新 ACP 会话都会调 `rewriteMcpServersForEngine → ensurePersistentMcpBridge → start`。后果：任意引擎/会话切换都重启 chrome-devtools-mcp，杀掉浏览器实例；agent A 用浏览器进行中时 agent B 新开会话会直接打断 A（并行互踩）。

nuwaclaw 不受影响是因为有两层守卫（请求级 `rawMcpServersEqual` fast-path + sync 级 `configsEqual`）。nuwa-cli 在宿主层补齐等价守卫 —— 这正是 agent-kit `proxyBridge.ts` 契约注释的兜底条款：*"If a future host's `start` is NOT idempotent, that host must diff before calling `ensureStarted`"*。

**修复后行为**（`proxyRewrite.ts`）：

```
ensurePersistentMcpBridge(servers):
  configKey = stablePersistentConfigKey(servers)   # key 排序 + 稳定序列化
  if configKey === lastPersistentConfig && bridge.isRunning():
      return lastPersistentBridge                   # 复用，不重启
  bridge = ensureStarted(servers)                   # 仅配置真变更才 stop/start
```

- persistent 集合实际恒为 `{ chrome-devtools }`，修复后重启只在真变更（如 `NUWACLI_MCP_PERSISTENT` 追加长驻名）时发生。
- **agent-kit 不改**：宿主层 diff 已达同等效果；`createPersistentBridge` 目前唯一消费者是 nuwa-cli，nuwaclaw 走自己的 sync 层守卫 —— 现在改它是零受益的跨仓库发版链。将来出现第二个直接消费的宿主时再考虑下沉。

---

## §4 验证与验收

> 当前运行中的 serve 仍是旧代码 —— 验收前先按 S0 以本地调试命令（`npm run dev:serve`）跑起新代码。
> 涉及日志：`~/.nuwa-cli/logs/main.<date>.log`（serve 主日志）、`~/.nuwa-cli/logs/codex/app-server.log`（codex 引擎）。

### S0 前置：部署新代码（本地调试方式）

- **操作**（在 nuwa-cli 仓库，`feat/serve-system-prompt-bridge-stability` 分支）：
  1. `npm run build` — 构建新 `dist/`（tsc 类型检查 + esbuild 打包）
  2. 停掉旧 serve（当前跑的是全局安装的旧版）：`nuwa-cli stop --all`，或 `node dist/cli.js stop --all`
  3. `npm run dev:serve` — 以本地新代码启动 serve（`node dist/cli.js serve --port 60016`，与生产端口一致，lanproxy 隧道复用）
  4. 可选健康检查：`npm run dev:doctor`
- **PASS IF**：serve 启动日志出现 `PersistentMcpBridge warmed`；无报错。
- **说明**：验收完成后如需切回全局版，停掉 dev 进程后 `nuwa-cli serve`（或 `nuwa-cli restart`）即可；日志统一落 `~/.nuwa-cli/logs/`，dev 与全局版共享，验收断言不受影响。

### S1 system_prompt — 新会话生效

- **操作**：
  1. Console 为项目设置一段**特征明确**的系统提示（如「回复必须以【NUWAX-SP】开头」）。
  2. 从云端发起新对话（建议换一个 project 或先停旧会话，避免 auto-resume）。
- **断言**：主日志 `runtime config resolved` 的 meta 中 `hasSystemPrompt: true`；agent 回复以【NUWAX-SP】开头。
- **PASS IF**：日志断言与行为断言同时成立；`mcpServers` 摘要数组同时打印各 server 的 name + command + args。

### S2 system_prompt — auto-resume 路径生效（回归 `a8b8ea3`）

- **操作**：同一 project 不带 `session_id` 连续发第二条消息（触发本地历史自动续接）。
- **断言**：主日志出现 `auto-resume from local history`，且系统提示仍然生效（回复带特征前缀）。
- **PASS IF**：auto-resume 会话行为同样受系统提示约束 —— 证明 `session/load` 的 `_meta` 注入生效。

### S3 MCP 折叠 — codex 不再 ENOENT

- **操作**：发起一个 codex 引擎会话（Console 云端配置**保持原样，不删** chrome-tools），问「有哪些可用的工具」。
- **断言**：
  - 主日志出现折叠命中行（scope `mcp-proxy`）。
  - `codex/app-server.log` 中无 `chrome_tools ... failed ... os error 2`，MCP 启动状态里 `chrome_tools` 不再出现。
- **PASS IF**（日志命中行原文）：

  ```
  mcp-proxy: downstream server "chrome_tools" is equivalent to default "chrome-devtools" (persistent), folding into default
  ```

  且 codex 可用工具仍包含 Chrome DevTools 全套（来自桥接实例）。

### S4 bridge 防抖 — 跨引擎切换不重启

- **操作**：在 Console 先后发起 claude 引擎会话与 codex 引擎会话（同一 project，间隔几秒）。
- **断言**：第二个会话建立时，主日志出现复用行，且**不再出现** `Already running, stopping first` + `Spawning server "chrome-devtools"` 序列。
- **PASS IF**（日志复用行原文）：

  ```
  mcp-proxy: persistent bridge config unchanged, reusing running bridge (no restart)
  ```

  加分项：在 agent A 浏览器工具调用进行中发起 agent B 会话，A 的调用不再被打断。

### S5 回归 — claude 引擎与自动化测试

- **操作**：
  1. 发起 claude 引擎会话，确认浏览器工具（29 tools）与 MCP 全部 ready。
  2. 仓库内执行 `npm run build` 与 `npm run test:run`。
- **PASS IF**：claude 会话 `chrome-devtools` 经桥接 ready、工具可调用；build 无类型错误；测试 489 全绿。

### 验收日志关键词速查

| 关键词 | 文件 | 含义 |
|---|---|---|
| `hasSystemPrompt: true` | `main.*.log` | 云端系统提示已进入 runtime 配置 |
| `folding into default` | `main.*.log` | 下发 server 等价命中内置 persistent（S3） |
| `reusing running bridge (no restart)` | `main.*.log` | bridge 防抖生效（S4） |
| `Already running, stopping first` | `main.*.log` | 会话切换时出现即防抖失效（不应再出现） |
| `mcpServer/startupStatus/updated ... failed` | `codex/app-server.log` | codex 侧 MCP 启动失败（不应再有 chrome_tools） |
| `model overlay applied` | `main.*.log` | 模型覆盖（既有行为，codex 会话应仍出现） |

---

## §5 边界与遗留

- **折叠丢弃云端定制**：等价命中时云端条目的 env / allowTools 不生效（本地为准，对齐 nuwaclaw）。若将来需按云端定制 chrome-devtools，改用**同名**下发（覆盖语义保留定制）。
- **bridge 真变更仍会重启**：`NUWACLI_MCP_PERSISTENT` 追加长驻名或同名定制变化时，一次 stop/start 是预期行为。
- **防抖的崩溃边缘**：bridge 子进程意外死亡但句柄未置空时，复用分支可能返回死实例；mcp-proxy 内部 ResilientTransport 有重连兜底，如现场出现可手动 `nuwa-cli restart`，后续观察是否需要心跳探测。
- **未改动面**：agent-kit、mcp-proxy-ts、云端配置、`update` 命令与 install-from-s3 分发链路 —— 全部保持原状。

> **发布提醒**：验收通过后按既定流程发 beta —— bump 版本 → commit → `source .env` → `npm run release:beta`（npm / npmmirror / cnpm 三通道）。
