# nuwa-cli serve 修复验收报告

- **分支**：`feat/serve-system-prompt-bridge-stability`
- **日期**：2026-08-19
- **提交**：`ce54dad` · `a8b8ea3` · `9af8fa4` · `5580b82`（+ 解包对齐 + 报告）
- **测试**：493 passed / 63 files（含新增 9 用例）
- **改动范围**：仅 nuwa-cli 仓库；agent-kit / mcp-proxy-ts / 云端配置均未改动

| 问题 | 状态 |
|---|---|
| system_prompt 丢失 — 云端系统提示未下发到 agent | ✅ 已修复 |
| chrome_tools ENOENT — codex 会话 MCP 启动失败 | ✅ 已修复 |
| PersistentMcpBridge 每会话重启 — 跨 agent 并行互踩 | ✅ 已修复 |
| chrome_tools 改 Rust convert 形态后再次 ENOENT | ✅ 已修复（TS 版改写） |
| codex 运行速度排查 | 📊 结论：瓶颈在模型 API（77%），链路侧健康 |

---

## §0 概览

三个问题同源于一次排查：Console 设置的系统提示在 nuwa-cli serve 链路未生效，而 nuwaclaw 客户端正常。顺藤摸瓜确认三处缺陷，全部在 nuwa-cli 仓库内修复。

| 问题 | 根因 | 修复 | Commit |
|---|---|---|---|
| system_prompt 丢失 | `parseDownstreamSessionConfig` 白名单无该字段，静默丢弃；三条会话路径均未组装 `_meta.systemPrompt` | 解析顶层 `system_prompt`，new / load / reconfigure 全路径经 `_meta.systemPrompt = { append }` 注入 | `ce54dad` `a8b8ea3` |
| chrome_tools ENOENT | 云端下发的 `chrome-tools` 与内置 `chrome-devtools` 跨名不等价，按 ephemeral 下发且 command 本机不可用 | 跨名等价兜底折叠：npx 裸包名相同即命中内置 persistent 条目 | `9af8fa4` |
| bridge 每会话重启 | `PersistentMcpBridge.start` 为 stop-first，宿主每会话无条件调用，无配置比对守卫 | 宿主层稳定序列化快照比对，配置未变直接复用运行中 bridge | `ce54dad` |
| chrome_tools（Rust convert 形态）ENOENT | 云端配置改为 `mcp-proxy convert <url> --protocol stream`（nuwaclaw 机器的 Rust 工具），本机无 `mcp-proxy` 二进制 | 改写为 `node + @nuwax-ai/mcp-proxy-ts 入口` 执行同样 convert（CLI 参数兼容，原样透传） | `5580b82` |

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

### §2.1 后续演进：chrome_tools 改为 Rust convert 形态（`5580b82` + 解包对齐）

验收期间云端配置再次变化：`chrome_tools` 从 npx stdio 形态改为 Rust 工具形态 —— `mcp-proxy convert http://127.0.0.1:18099 --protocol stream`（nuwaclaw 生态的命令形态）。该形态**不走** §2 的折叠（非 npx、目标也不是内置条目），且本机无 `mcp-proxy` 二进制，codex spawn 再次 ENOENT。

**与 nuwaclaw 的逻辑核对结论**：nuwaclaw 对 `mcp-proxy` 条目调 `extractRealMcpServers` **解包**—— 但只认 `--config '{json}'` 聚合形态；URL 直连形态在 nuwaclaw 返回 null 被**静默丢弃**（即 nuwaclaw 从未真正运行过该 server）。nuwa-cli 拉齐解包语义并补齐 URL 形态：

1. **`--config` 聚合形态 → 解包**（`downstreamConfig.ts` 的 `unwrapMcpProxyBridgeEntries`，对齐 nuwaclaw `extractRealMcpServers`）：以 inner name 展开 JSON.mcpServers 里的真实条目，stdio 恢复 command/args/env，url 条目按 remote（http/sse）接管，绝不再 spawn Rust 二进制。nuwaclaw 侧另有 uvx→`uv tool run` 的应用内路径重写，属宿主环境层（uvx 在 nuwa-cli 机器 PATH 上），不改写。
2. **URL 直连形态 → TS convert 改写**（`proxyRewrite.ts` 的 `rewriteRustMcpProxyConvert`）：

```
node <@nuwax-ai/mcp-proxy-ts dist/index.js> convert <url> --protocol stream
```

   TS 版 convert 模式 CLI 参数兼容（位置参数 URL + `--protocol sse|stream`），参数原样透传；找不到 TS 入口时保持原样（宿主环境可能自装 Rust 版）。
3. `--config` JSON 非法 / 缺 mcpServers → 条目原样保留，引擎侧报错可见（不做静默丢弃）。

> **环境前提**：改写只解决「命令不存在」；`chrome_tools` 最终可用还取决于目标 `http://127.0.0.1:18099` 有服务在听（本机 nuwa-browser 类浏览器 MCP）。无服务时 startupStatus 会从 ENOENT 变为连接类失败 —— 属预期，起服务即可。

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

## §3.5 codex 运行速度排查结论

排查动机：主观感受 codex 会话慢。对 15:05–15:08 两个真实 turn（22.7s / 36.1s）逐事件分解：

**链路侧（快，全部健康）**：

| 环节 | 耗时 |
|---|---|
| 请求 → 会话建立（received→accepted，含 MCP rewrite + buildSession + model overlay） | 455ms |
| bridge 复用（§3 防抖生效，`reusing running bridge`） | 0ms |
| chrome-devtools（桥）ready | 95ms |
| ask_question ready | 384ms |
| nuwax_openui（npx 冷启动，仅会话开头一次） | 2.4s |

**模型侧（Turn B = 22.7s 的分解）**：

| 阶段 | 耗时 | 占比 |
|---|---|---|
| userMessage → 首个推理输出（**首 token**） | ~7.8s | 34% |
| 工具结果回传 → 下轮推理启动（事件空洞） | ~2.6s | 12% |
| 最后一段输出完成 | ~7.2s | 32% |
| MCP 工具实际执行 | ~1.2s | 5% |
| reasoning 流式输出 | ~2.8s | 12% |

**模型等待合计 ≈ 77%**；Turn A（36.1s）同构（工具间空洞 +8.0s / +4.1s）。全程 0 次 stream error / 429 / 5xx / quota —— 网关稳定，纯延迟问题（glm-5 + 长上下文：系统提示 + user-memory + 29 个工具定义）。

**提速方向（按收益排序）**：

1. **模型侧（收益最大）**：调低 glm-5 reasoning effort（可经 `session_set_config_option`，与 model overlay 同通道）；轻任务换低延迟模型；网关侧排查区域/并发配置。
2. **nuwax_openui 冷启动 2.4s**：npx 缓存已预热，2.4s 是解压启动而非下载 —— 加 `NUWACLI_MCP_PERSISTENT=nuwax_openui` 纳入常驻桥可每次会话消掉（待办，未实施）。
3. 链路侧（会话建立 455ms、bridge 0ms）已无优化必要。

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

### S3 MCP 折叠 / convert 改写 — codex 不再 ENOENT

- **操作**：发起一个 codex 引擎会话（Console 云端配置**保持原样，不删** chrome-tools），问「有哪些可用的工具」。
- **断言**（按云端 chrome_tools 当前形态二选一）：
  - **npx stdio 形态**：主日志出现折叠命中行，`codex/app-server.log` 无 `chrome_tools` 条目。
  - **Rust convert 形态**（当前）：主日志 `runtime config resolved` 的 mcpServers 摘要显示 `chrome_tools: <node 路径> <mcp-proxy-ts>/dist/index.js convert ...`（已完成 TS 改写）；`app-server.log` 中 chrome_tools 不再报 `os error 2`。
- **PASS IF**（npx 形态折叠行原文）：

  ```
  mcp-proxy: downstream server "chrome_tools" is equivalent to default "chrome-devtools" (persistent), folding into default
  ```

  （Rust convert 形态）ENOENT 消失；若 `127.0.0.1:18099` 无服务，chrome_tools 报**连接类**失败属预期 —— 起本地浏览器 MCP 服务后即 ready。codex 可用工具仍包含 Chrome DevTools 全套（桥接实例）。

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
- **PASS IF**：claude 会话 `chrome-devtools` 经桥接 ready、工具可调用；build 无类型错误；测试 493 全绿（含新增 9 用例：system_prompt 解析 ×2、折叠 ×2、convert 改写 ×1、--config 解包 ×3、防抖 ×1）。

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
