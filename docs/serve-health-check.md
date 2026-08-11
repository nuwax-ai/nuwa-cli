# 开发方案：file-server 与 lanproxy 启动健康检查

> 启动 `serve`（`gateway` / `start` 底层都走 `serve`）时，对拉起的 **file-server** 与 **lanproxy** 做真实就绪探测，而非「spawn 了就当成功」。
> 本方案已在本仓库落地；探测与完整启动重试骨架收敛在 `@nuwax-ai/agent-kit`（exact pin，见 `sync:core-deps`），与 nuwaclaw Electron `ServiceManager` 对齐。
> 代码主入口：`src/commands/serve.ts`、`src/core/serve/fileServer.ts`、`src/core/serve/lanproxyProcess.ts`。

## 背景

`serve --tunnel` 会依次拉起两个外部子进程：

1. **nuwax-file-server**（独立 npm 包 `nuwax-file-server`，一个 Express HTTP 服务，处理工程文件 / 上传 / 构建产物）；
2. **lanproxy**（TCP 隧道客户端，连接云端 `serverHost:serverPort`，把云端对本机的请求隧道到本地 gateway / file-server）。

首版里这两个的「就绪」都是假的：

| 子进程 | 旧实现 | 问题 |
|---|---|---|
| file-server | `startFileServer()` 以 `detached:true + unref()` fire-and-forget，随后立即打印「已启动」 | 实际可能还在 require/初始化，甚至启动失败；上层却以为它好了 |
| lanproxy | `startLanproxy()` 返回的 `ready` 只是 `spawn` 成功后固定 `setTimeout(300ms)` 就 resolve | 300ms 远不足以确认隧道真正建立；lanproxy 连不上 server 往往是几秒后才退出，300ms 时它还「活着」 |

后果：云端通过隧道访问本机时偶尔「刚启动那几秒 503」，或 file-server 接口在 serve 启动后短时间内不可用，且日志看不出是没起来还是没就绪。

## 设计总览：本地探测 + 云端回探 + 完整启动重试

两者探测方式**故意不同**，因为它们的对外形态不同：

```
file-server  →  本地 HTTP 服务，暴露 GET /health   →  本地直接探 HTTP
lanproxy     →  纯 TCP 隧道客户端，无本地 HTTP 端口 →  必须经云端回探隧道状态
```

外层再用 `@nuwax-ai/agent-kit` 的 `withStartRetry`（默认最多 3 次、1s/2s backoff）做**完整启动重试**：失败必须先 stop / 清进程，再 spawn，避免「Already running」假成功。宿主只注入 `attemptFn` 与 logger；kit 不拥有进程生命周期。

lanproxy 是**客户端**：它主动连云端，本机不开任何 HTTP/控制端口。因此本机无法直接判断「隧道是否连通」——只能问云端：这个 `configKey` 对应的隧道现在 online 吗？这就是 `/api/sandbox/config/health/{key}` 的作用。

### lanproxy 的三层递进检查

不是单一手段，而是三层、由廉到贵：

1. **`ready`（spawn 成功）**——`startLanproxy` 返回的 `ready` Promise。捕获「启动即失败」：spawn 报错或子进程在窗口内 `exit` → reject。这一层只是「进程拉起来了」。
2. **`confirmLanproxyHealthy(pid, stabilizeMs)`（进程稳定存活）**——`process.kill(pid, 0)` 确认 pid 存活，跨一个稳定窗口（默认 1s）后再次确认仍存活。廉价本地检查，能捕捉到「连接 server 失败后延迟退出」这种 300ms 之后才暴露的崩溃。若期间 `signal` 已 abort，计为 **aborted**（不是 stabilize 失败），避免无意义整轮重试。
3. **`waitForLanproxyTunnel(domain, configKey)`（云端隧道 online）**——真实信号。轮询云端接口直到隧道被判为 online 或超时。**这是唯一的强保证**：隧道确实在云端注册并可回探。

第 2 层是第 3 层的 fast-fail 预检：进程都没了就没必要浪费一个云端请求的超时时间。

## 方案细节

### 1. file-server：HTTP `/health` 轮询

nuwax-file-server（Express，`app.use(router)` 挂在根路径）暴露：

```
GET http://127.0.0.1:{port}/health
→ 200 { "status": "ok", "timestamp", "uptime", "version", "platform", "nodeVersion", "pid", "memory", "env" }
```

`waitForFileServerHealth(port, timeoutMs=DEFAULT_FILE_SERVER_HEALTH_TIMEOUT_MS(20s), intervalMs=200)`：

- 实现在 `@nuwax-ai/agent-kit`；宿主包装返回 `boolean`；
- 轮询 `GET http://127.0.0.1:{port}/health`（单次请求 `AbortSignal.timeout(1500)`）；
- 返回体 `status === "ok"` 即就绪，立即 resolve `true`；
- 否则 `intervalMs` 后重试，直到 `timeoutMs` 超时 Resolve `false`；
- 任何 fetch 异常（ECONNREFUSED / 超时 / 非 200 / 解析失败）都视为「还没好」，继续重试。

完整启动封装 **`bringUpFileServer`**：

1. `stopFileServer`（清上一轮）→ `startFileServer` → 轮询 `/health`；
2. 失败再 `stop`，经 `withStartRetry` 完整重试（默认 3 次）；
3. `onStarted` 在每次成功 spawn 后立刻回调（serve 用来标记 `fileServerStarted`，保证健康等待期间 SIGINT 仍能 stop detached 进程）；
4. `start`/`stop` 维护 process registry：按 port 记住 pid，`stop` 与同 port 再次 `start` 前 `unregisterProcess`，避免重试堆失效 PID。

> `status === "ok"` 与本仓库 gateway 自己的 `/health`（`src/core/serve/server.ts`）约定一致，`serveLock.ts` 的 `probeServeHealth` 也是同款判断。

### 2. lanproxy：三层检查（见上）

`confirmLanproxyHealthy` 与 `waitForLanproxyTunnel` 都在 `src/core/serve/lanproxyProcess.ts`。
完整拉起用 **`bringUpLanproxy`**（三层检查 + `withStartRetry`；任一层失败先 `handle.stop()`）。

**云端隧道接口契约**（`waitForLanproxyTunnel` 调用）：

| 项 | 值 |
|---|---|
| URL | `{domain}/api/sandbox/config/health/{configKey}`（`domain` 去尾部 `/`，`configKey` 做 `encodeURIComponent`） |
| Method | `GET` |
| 鉴权 | 无额外 header；`configKey` 路径参数即标识（与注册接口 `/api/sandbox/config/reg` 同域、同 envelope 风格） |
| 单次超时 | `AbortSignal.timeout(5000)` |
| 返回 envelope | `{ code, success, message, data }`（与 `regClient.ts` 的 `ApiEnvelope` 一致，`code:"0000"` 为成功） |
| **健康判定** | `code === "0000"` \|\| `success === true` \|\| `data?.online === true`（三选一容错，适配后端字段演进） |
| 轮询 | `timeoutMs=15_000`，`intervalMs=500`，全程未判健康则 Resolve `false` |
| 参数缺失保护 | `domain` 或 `configKey` 为空 → 直接 `false`，不发请求 |

参数来源（`serve.ts` 启动上下文）：

- `domain` ← `credentials.domain`（用户登录的业务后端域，带 `https://`，与注册时 `POST {domain}/api/sandbox/config/reg` 同一个）。
- `configKey` ← `reg.configKey`（注册返回，== `savedKey` == lanproxy 的 `clientKey`）。

### 3. 集成到 `serve.ts`

启动序列（`--tunnel` 分支内）：

```ts
const fileServerHealthy = await bringUpFileServer({
  port: fileServerPort,
  baseWorkspaceDir: cwd,
  signal: shutdownSignal,
  onStarted: () => { fileServerStarted = true; /* … */ },
});
if (!fileServerHealthy) {
  // 黄字警告；跳过 lanproxy（避免「隧道通、文件口挂」）
  break;
}

const lanproxyResult = await bringUpLanproxy({
  start: { ..., clientKey: reg.configKey },
  domain,
  configKey: reg.configKey,
  signal: shutdownSignal,
});
// 必须先挂上 handle，再判 shuttingDown：
// 否则「bringUp 已成功、赋值前 SIGINT」会让 shutdown 看不到 handle → 孤儿进程。
lanproxyHandle = lanproxyResult.handle ?? undefined;
if (shuttingDown) {
  lanproxyHandle?.stop();
  break;
}
```

**失败策略：警告而非致命（但 FS 挂则跳过隧道）**。file-server / lanproxy 各自重试耗尽后打印黄色警告，不 `throw`、不阻断本地 HTTP API。**若 file-server 最终不健康，不再拉起 lanproxy**，避免「隧道通、文件口挂」的假成功。

**信号处理**：

- `SIGINT` / `SIGTERM` 在 HTTP listen 之后立刻注册（早于 file-server / lanproxy）。
- `bringUpFileServer` 前检查 `shuttingDown`；`onStarted` 在每次 spawn 后立即标记 `fileServerStarted`。
- lanproxy：`bringUp` 返回后**立刻**赋给 `lanproxyHandle`；若已 `shuttingDown` 则对返回的 handle 再 `stop()`。
- shutdown 会 `AbortController.abort()`，健康轮询、stabilize 等待与 `withStartRetry` backoff 收到 signal 后结束。

**耗时预算（无 abort）**：单次 FS health 默认 **20s**、隧道 **15s**（+1s 稳定）；完整 `withStartRetry` 默认最多 **3** 次并夹 1s/2s backoff。最坏可达分钟级。Ctrl+C 应立刻打断，不等待整轮预算。

## 复用到 nuwaclaw（Electron 客户端）要点

nuwaclaw 同样会拉起 file-server + lanproxy，健康检查与完整启动重试已收敛到 `@nuwax-ai/agent-kit`（`waitForFileServerHealth` / `waitForLanproxyTunnel` / `withStartRetry`）。Electron 侧在 `ServiceManager` 接线；CLI 侧在 `bringUp*`。要点：

1. **file-server 探测**：完全复用 kit 的 `waitForFileServerHealth`——`GET http://127.0.0.1:{port}/health`，判 `status === "ok"`。`port` 取客户端分配给 file-server 的端口（Electron 端注意它可能不固定为 60015，需用实际监听端口）。
2. **lanproxy 探测**：照搬三层。注意 Electron 端 `startLanproxy` 的 `ready` 实现可能不同（有的用固定延时，有的监听子进程 stdout 关键字），但第 2/3 层（进程存活 + 云端回探）与 spawn 方式无关，可直接复用。
3. **云端接口**：URL/method/envelope 判定见上表。`domain` 用客户端登录的业务后端域，`configKey` 用注册返回值（Electron 客户端通常已持有，等价于其 `configKey`/`savedKey`/隧道 key）。
4. **超时建议**：file-server 默认 **20s**（Windows 冷启；kit `DEFAULT_FILE_SERVER_HEALTH_TIMEOUT_MS`）；lanproxy 云端回探 15s（含建连 + server 注册传播，500ms 轮询）。外层再套 `withStartRetry`（默认 3 次）。
5. **调用时机**：在「`startLanproxy` 返回且 `ready` resolve 之后」再做云端回探——`ready` 之前隧道几乎不可能 online，提前探只会浪费轮询。第 2 层 `confirmLanproxyHealthy` 的 1s 稳定窗口正好给 lanproxy 首次连接 server 的时间，往往第 3 层首轮就命中。
6. **如后端契约不同**：当前实现假设 `GET` 且 envelope `{code,success,data.online}`。若 nuwaclaw 后端实际为 `POST` 或健康字段在别处（如 `data.status === "UP"`），仅需调整 kit / 宿主 `waitForLanproxyTunnel` 里的 method 与判定表达式，轮询骨架不变。
7. **关停竞态**：成功拉起后要把可 `stop` 的句柄尽快交给 shutdown 路径（CLI：先赋值 `lanproxyHandle` 再判 `shuttingDown`；FS：`onStarted` 尽早打标）。

## 涉及文件

| 文件 | 改动 |
|---|---|
| `src/core/serve/fileServer.ts` | `waitForFileServerHealth` + `bringUpFileServer`；port→pid registry unregister |
| `src/core/serve/lanproxyProcess.ts` | 三层检查 + `bringUpLanproxy`；abort ≠ stabilize 失败 |
| `src/commands/serve.ts` | `--tunnel` 走 `bringUp*`；FS 不健康跳过隧道；lanproxy handle 竞态 stop |
| `package.json` / `scripts/sync-core-deps.mjs` | `@nuwax-ai/agent-kit` exact pin 纳入核心依赖同步 |
| `tests/fileServer.test.ts` | health + bringUp 重试 + registry |
| `tests/lanproxyProcess.test.ts` | 三层检查 + bringUp 重试 / abort |
| `tests/serveCommand.test.ts` | mock `bringUp*`；FS 失败跳过隧道；成功后 SIGINT 仍 stop |

## 决策记录

- **为什么 file-server 用 HTTP、lanproxy 用云端回探**：file-server 是本地 HTTP 服务、有 `/health`，本地探最直接；lanproxy 是纯 TCP 隧道客户端、本机无任何 HTTP/控制端口，本地根本无法判断隧道是否连通，只能问云端。
- **为什么 lanproxy 要三层**：`ready` 只保证「拉起来」，`confirmLanproxyHealthy` 廉价捕捉「延迟崩溃」，`waitForLanproxyTunnel` 才是「隧道真通」的强保证。三层由廉到贵，第 2 层失败可直接跳过第 3 层省时间。
- **为什么健康判定用三选一容错**：后端 envelope 的健康字段可能演进（`code` / `success` / `data.online`），任一为「健康」即认定 online，减少因后端字段微调导致的误判。
- **为什么失败只警告不 fatal**：本地 HTTP API 不依赖隧道，lanproxy 不通时本地调试仍可用；是否升级为 fatal 留给产品决策。
- **为什么 FS 挂则跳过 lanproxy**：重试耗尽后文件口仍不可用时，再拉隧道只会制造「云端以为通、文件 API 挂」的假成功；本地 HTTP 调试不受影响。
- **为什么要用 `withStartRetry`**：Windows 冷启 / AV / 偶发端口占用导致单次 health 超时较常见；完整 stop→start 重试与 Electron 对齐，比只加长单次 timeout 更稳。
- **为什么 agent-kit 必须 exact pin**：与其它核心运行时依赖一样，由某版 CLI 锁定一组 pin；`^`/`~` 会导致两宿主行为漂移。纳入 `sync:core-deps` 统一检查 / 对齐。
