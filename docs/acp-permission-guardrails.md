# ACP 通用权限审批护栏

> 行为契约（用户视角）见 README `serve` / `--approve` 段。  
> 协议对齐 NuwaClaw / RCoder：`session/request_permission` → SSE `acpRequestPermission` → `POST /computer/notify-resolved`。

## 目标

在 `nuwa-cli serve` / `gateway` 暴露引擎能力后，提供与 NuwaClaw 同构的 **HITL 权限审批总线**，避免 yolo 静默放行一切副作用。本地 sessions 拉取是挂在总线上的**第一块敏感护栏**，不是方案边界。

## 分层

| 层 | 职责 |
|---|---|
| **审批总线** | `PermissionCoordinator` + `ApprovalPendingService` + SSE + `notify-resolved` |
| **敏感分类器** | 命中则强制 ask（yolo 也不能跳过）；首版：`session-history` |
| **旁路闸门** | 非 TTY 的 `context` / `sessions` CLI、以及 `/computer/local-sessions/*`，一律合成 ACP permission |

## `--approve`

| 值 | 行为 |
|---|---|
| `auto`（默认） | 普通工具自动放行；**敏感分类仍 ask** |
| `ask` | 全部工具走 SSE 人工审批 |
| `deny` | 全部拒绝 |

## 协议（与 NuwaClaw 对齐）

### SSE

```json
{
  "messageType": "acpRequestPermission",
  "subType": "request_permission",
  "data": {
    "request_permission_request": { /* ACP RequestPermissionRequest */ },
    "tool_call_id": "..."
  }
}
```

### 回执

`POST /computer/notify-resolved`

```json
{
  "permission_resolve_request": {
    "session_id": "<acpSessionId>",
    "tool_call_id": "<toolCallId>",
    "request_permission_response": {
      "outcome": { "Selected": { "option_id": "allow_once" } }
    }
  }
}
```

兼容 legacy：`outcome: { outcome: "selected", optionId: "..." }`。  
无 `permission_resolve_request` 时仍返回 `ignored: true`（向后兼容）。

## 敏感分类：session-history

命中条件（任一）：

- 命令含 `nuwa-cli context|sessions`
- 路径触及 `~/.claude/projects` 或 `~/.codex/sessions`
- 合成 title：`local_sessions_*`

## 旁路与无审批通道

- **TTY / `chat --resume`**：放行（用户主动）
- **非 TTY（Agent Bash）**：`POST /computer/sensitive-access/await` 阻塞等待审批；无 serve → `CONSENT_REQUIRED`
- **无 SSE 订阅**：不干等 120s，立即 `cancelled` / HTTP `503 NO_APPROVAL_CHANNEL`（须先打开 `/computer/progress`）
- **`sensitive-access/await` 鉴权**：仅 loopback 可无 secret；非本机回环必须带内部 secret

分类器为 best-effort（命令/路径正则）；直接执行构建产物或经其他包管理器间接执行也会命中。拷贝到 `/tmp` 再读无法靠正则完备覆盖。

## HTTP 导出

- `GET|POST /computer/local-sessions/list`
- `POST /computer/local-sessions/read`

均先 `awaitSensitiveAccess`，通过后再读盘。

## 代码入口

| 文件 | 作用 |
|---|---|
| `src/core/permissions/coordinator.ts` | 决策链 |
| `src/core/permissions/classifiers/` | 可插拔敏感分类 |
| `src/core/permissions/approvalPending.ts` | pending 状态机 |
| `src/core/permissions/notifyResolved.ts` | 回执解析 / SSE data |
| `src/core/permissions/sensitiveAccessGate.ts` | CLI 闸门 |
| `src/core/serve/sessionHub.ts` | ask → SSE |
| `src/core/serve/server.ts` | notify-resolved / local-sessions / sensitive-access |

## 后续（有意未做）

- Electron `strictPermissionGuard` / 可写根目录
- 服务端 `tool_approval_rules` 同步
- 更多敏感分类（破坏性 shell、家目录外写入等）：实现 `SensitiveClassifier` 并 `registerClassifier` 即可
