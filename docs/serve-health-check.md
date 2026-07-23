# 开发方案：file-server 与 lanproxy 启动健康检查

> 启动 `serve`（`gateway` / `start` 底层都走 `serve`）时，对拉起的 **file-server** 与 **lanproxy** 做真实就绪探测，而非「spawn 了就当成功」。
> 本方案已在本仓库落地，并作为 [`nuwaclaw`](../../) Electron 客户端复用的参考。
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

## 设计总览：本地探测 + 云端回探

两者探测方式**故意不同**，因为它们的对外形态不同：

```
file-server  →  本地 HTTP 服务，暴露 GET /health   →  本地直接探 HTTP
lanproxy     →  纯 TCP 隧道客户端，无本地 HTTP 端口 →  必须经云端回探隧道状态
```

lanproxy 是**客户端**：它主动连云端，本机不开任何 HTTP/控制端口。因此本机无法直接判断「隧道是否连通」——只能问云端：这个 `configKey` 对应的隧道现在 online 吗？这就是 `/api/sandbox/config/health/{key}` 的作用。

### lanproxy 的三层递进检查

不是单一手段，而是三层、由廉到贵：

1. **`ready`（spawn 成功）**——`startLanproxy` 返回的 `ready` Promise。捕获「启动即失败」：spawn 报错或子进程在窗口内 `exit` → reject。这一层只是「进程拉起来了」。
2. **`confirmLanproxyHealthy(pid, stabilizeMs)`（进程稳定存活）**——`process.kill(pid, 0)` 确认 pid 存活，跨一个稳定窗口（默认 1s）后再次确认仍存活。廉价本地检查，能捕捉到「连接 server 失败后延迟退出」这种 300ms 之后才暴露的崩溃。
3. **`waitForLanproxyTunnel(domain, configKey)`（云端隧道 online）**——真实信号。轮询云端接口直到隧道被判为 online 或超时。**这是唯一的强保证**：隧道确实在云端注册并可回探。

第 2 层是第 3 层的 fast-fail 预检：进程都没了就没必要浪费一个云端请求的超时时间。

## 方案细节

### 1. file-server：HTTP `/health` 轮询

nuwax-file-server（Express，`app.use(router)` 挂在根路径）暴露：

```
GET http://127.0.0.1:{port}/health
→ 200 { "status": "ok", "timestamp", "uptime", "version", "platform", "nodeVersion", "pid", "memory", "env" }
```

`waitForFileServerHealth(port, timeoutMs=10_000, intervalMs=200)`：

- 轮询 `GET http://127.0.0.1:{port}/health`（单次请求 `AbortSignal.timeout(1500)`）；
- 返回体 `status === "ok"` 即就绪，立即 resolve `true`；
- 否则 `intervalMs` 后重试，直到 `timeoutMs` 超时 Resolve `false`；
- 任何 fetch 异常（ECONNREFUSED / 超时 / 非 200 / 解析失败）都视为「还没好」，继续重试。

> `status === "ok"` 与本仓库 gateway 自己的 `/health`（`src/core/serve/server.ts`）约定一致，`serveLock.ts` 的 `probeServeHealth` 也是同款判断。

### 2. lanproxy：三层检查（见上）

`confirmLanproxyHealthy` 与 `waitForLanproxyTunnel` 都在 `src/core/serve/lanproxyProcess.ts`。

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
startFileServer(fileServerPort, cwd);
const fileServerHealthy = await waitForFileServerHealth(fileServerPort);
// 健康打印绿色「已启动」；未通过打印黄色警告（不 fatal）

lanproxyHandle = startLanproxy({ ..., clientKey: reg.configKey });
await lanproxyHandle.ready;                                   // ① spawn 成功
const lanproxyAlive = await confirmLanproxyHealthy(handle.pid); // ② 进程稳定存活
const lanproxyHealthy = lanproxyAlive
  ? await waitForLanproxyTunnel(credentials.domain, reg.configKey) // ③ 云端隧道 online
  : false;
```

**失败策略：警告而非致命**。任一未通过只打印黄色 `[nuwa-cli] ... 健康检查未通过 ...`，不 `throw`、不阻断 serve——因为本地 HTTP API（`/computer/chat` 等）在 lanproxy 不通时仍可用于本地直连调试。是否要把 lanproxy 不通升级为 fatal，取决于产品取舍（云端隧道是 serve 的主要目的，但本地 API 不应被连累）。

**信号处理**：`SIGINT` / `SIGTERM` 在 HTTP listen 之后立刻注册（早于 file-server / lanproxy 健康检查）。`startFileServer` 前检查 `shuttingDown`（避免 register 等待期间 Ctrl+C 后仍 spawn）；spawn 后立即标记 `fileServerStarted`。shutdown 会 `AbortController.abort()`，健康检查轮询（`waitForFileServerHealth` / `confirmLanproxyHealthy` / `waitForLanproxyTunnel`）收到 signal 后立即结束，避免 Ctrl+C 后仍卡满 10s/15s。

## 复用到 nuwaclaw（Electron 客户端）要点

nuwaclaw 同样会拉起 file-server + lanproxy，健康检查逻辑可直接照搬。要点：

1. **file-server 探测**：完全复用 `waitForFileServerHealth` 的轮询逻辑——`GET http://127.0.0.1:{port}/health`，判 `status === "ok"`。`port` 取客户端分配给 file-server 的端口（Electron 端注意它可能不固定为 60015，需用实际监听端口）。
2. **lanproxy 探测**：照搬三层。注意 Electron 端 `startLanproxy` 的 `ready` 实现可能不同（有的用固定延时，有的监听子进程 stdout 关键字），但第 2/3 层（进程存活 + 云端回探）与 spawn 方式无关，可直接复用。
3. **云端接口**：URL/method/envelope 判定见上表。`domain` 用客户端登录的业务后端域，`configKey` 用注册返回值（Electron 客户端通常已持有，等价于其 `configKey`/`savedKey`/隧道 key）。
4. **超时建议**：file-server 10s（Express 冷启通常 1–2s，留余量）；lanproxy 云端回探 15s（含建连 + server 注册传播，500ms 轮询）。
5. **调用时机**：在「`startLanproxy` 返回且 `ready` resolve 之后」再做云端回探——`ready` 之前隧道几乎不可能 online，提前探只会浪费轮询。第 2 层 `confirmLanproxyHealthy` 的 1s 稳定窗口正好给 lanproxy 首次连接 server 的时间，往往第 3 层首轮就命中。
6. **如后端契约不同**：当前实现假设 `GET` 且 envelope `{code,success,data.online}`。若 nuwaclaw 后端实际为 `POST` 或健康字段在别处（如 `data.status === "UP"`），仅需调整 `waitForLanproxyTunnel` 里的 method 与判定表达式，轮询骨架不变。

## 涉及文件

| 文件 | 改动 |
|---|---|
| `src/core/serve/fileServer.ts` | 新增 `waitForFileServerHealth(port, timeoutMs, intervalMs)`：轮询 `GET /health` |
| `src/core/serve/lanproxyProcess.ts` | 新增 `confirmLanproxyHealthy(pid, stabilizeMs)`（进程稳定存活）与 `waitForLanproxyTunnel(domain, configKey, …)`（云端隧道回探） |
| `src/commands/serve.ts` | 启动后 `await` 上述探测；健康打印绿色就绪，未通过打印黄色警告（不 fatal）；`debugLog` 记录 `healthy` 字段 |
| `tests/fileServer.test.ts` | `waitForFileServerHealth`：首次即 ok / 重试后 ok / 超时 false |
| `tests/lanproxyProcess.test.ts` | `confirmLanproxyHealthy`：pid 缺失 / 存活 / 稳定窗口内死亡；`waitForLanproxyTunnel`：code 0000 / 重试后 online / 超时 false / 参数缺失不发请求 |
| `tests/serveCommand.test.ts` | mock 工厂补上 `waitForFileServerHealth` / `confirmLanproxyHealthy` / `waitForLanproxyTunnel` |

## 决策记录

- **为什么 file-server 用 HTTP、lanproxy 用云端回探**：file-server 是本地 HTTP 服务、有 `/health`，本地探最直接；lanproxy 是纯 TCP 隧道客户端、本机无任何 HTTP/控制端口，本地根本无法判断隧道是否连通，只能问云端。
- **为什么 lanproxy 要三层**：`ready` 只保证「拉起来」，`confirmLanproxyHealthy` 廉价捕捉「延迟崩溃」，`waitForLanproxyTunnel` 才是「隧道真通」的强保证。三层由廉到贵，第 2 层失败可直接跳过第 3 层省时间。
- **为什么健康判定用三选一容错**：后端 envelope 的健康字段可能演进（`code` / `success` / `data.online`），任一为「健康」即认定 online，减少因后端字段微调导致的误判。
- **为什么失败只警告不 fatal**：本地 HTTP API 不依赖隧道，lanproxy 不通时本地调试仍可用；是否升级为 fatal 留给产品决策。
