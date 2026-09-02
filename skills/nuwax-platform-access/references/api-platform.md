# 平台会话 / Agent API（前缀 `/api/v1/4sandbox/agent`）

> 契约来源：flow-debugger `debug_http.py`（已验证）。鉴权同全局：`Authorization: Bearer $SANDBOX_ACCESS_KEY`。
> 退出码/成败判断见 SKILL.md。会话执行（发消息跑 Agent）是 **SSE**（`Flux<AgentOutputDto>`），流式契约与解析参考
> `deepagents-dev-templates/packages/dev-agent-flow/orchestration/skills/flow-debugger/scripts/debug_http.py` 的 `sse_request`，
> 终止信号：`FINAL_RESULT` / `ERROR` / `completed=true` / `end_turn`。

## 常量

| 名称 | 值 | 说明 |
|---|---|---|
| AGENT_CONFIG_PATH | `/{devAgentId}` | GET agent 配置全文（含 `devConversationId`） |
| CONVERSATION_CREATE_PATH | `/conversation/create` | body `{agentId, devMode:true}`；响应 `data.id`；后端回写 `agent.devConversationId` |
| CONVERSATION_STOP_PATH | `/conversation/chat/stop/{conversationId}` | POST，无 body；等价页面「停止」 |

## 会话 ID 解析顺序（flow-debugger 语义）

1. 显式 `--conversation` / `CONVERSATION_ID` env
2. `GET /{devAgentId}` 取 `devConversationId`（**权威来源**——发消息前先 refresh）
3. 两者都在且不一致：以 devConversationId 为准并告警

## 示例

```bash
# 新建调试会话
curl -s -X POST "$BASE/api/v1/4sandbox/agent/conversation/create" \
  -H "Authorization: Bearer $SANDBOX_ACCESS_KEY" -H "Content-Type: application/json" \
  -d '{"agentId": 3912, "devMode": true}'
# → {"code":"0000","data":{"id":123456}, ...}

# 读 agent 配置（含 devConversationId）
curl -s "$BASE/api/v1/4sandbox/agent/3912" -H "Authorization: Bearer $SANDBOX_ACCESS_KEY"

# 停止会话执行
curl -s -X POST "$BASE/api/v1/4sandbox/agent/conversation/chat/stop/123456" \
  -H "Authorization: Bearer $SANDBOX_ACCESS_KEY"
```
