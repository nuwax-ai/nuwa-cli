# nuwax(PC) / nuwax-mobile 路由规则与业务参数对照

> 快照提取日期：**2026-09-02**（源：`nuwax/src/routes/index.ts` 729 行 + `nuwax-mobile/pages.json` + 页面 onLoad/跳转 URL 实测）。仓库路由变更后重新提取，解析脚本 `scripts/parse_route.py` 内置快照同步更新。

## 两端路由架构差异

| | nuwax（PC，umi4） | nuwax-mobile（uni-app x） |
|---|---|---|
| 路由形态 | 集中表 `src/routes/index.ts`，`:param` 动态段在**路径**里 | `pages.json` 静态页路径，业务参数走 **query**（navigateTo / H5 hash） |
| URL 形态 | `https://host/home/chat/{conversationId}/{agentId}` | 原生：`page-path?id=...`；H5：`{API_BASE}/m/?_rs=<nonce>#/page-path?query` |
| 会话宿主 | `/home/chat/:id/:agentId`（Chat 页） | `agent-detail` 是 web-view 壳（加载 H5 同页地址），壳参数非业务参数 |

## 核心业务参数对照

| 业务实体 | PC | Mobile | 备注 |
|---|---|---|---|
| **会话 conversationId** | path 段 `:id`（`/home/chat/:id/:agentId`；`/app/chat/:agentId/:id` 中居末） | query `conversationId`（agent-detail） | ⚠️ PC 用 `:id` 命名 |
| **智能体 agentId** | path 段 `:agentId`（`/agent/:agentId`、`/space/:s/agent/:a`、`/app` 前缀等） | query `agentId`；⚠️ **agent-detail 页用 `id=<agentId>`** | 同名 `id` 两端语义相反 |
| **空间 spaceId** | path 段 `:spaceId`（`/space/**` 全域） | **无对应原生页**（移动端弱化空间域） | |
| 技能 skillId | `:skillId`（skill-details 三个变体 + publish） | 无独立页 | |
| 设备 deviceId | — | query `deviceId`（terminal-device-detail） | |
| 绑定 bindingId | — | query `bindingId` | |
| 订阅/积分 | 页内状态（无路由段） | query `planId` / `packageId` / `payMode` | |
| 实物 goodsId | — | query `goodsId`（terminal-goods-detail） | |
| 文件工作区会话 cId | — | query `cId` | nuwax file-server 体系 |
| 临时会话 | `/chat-temp/:chatKey` 路径段 | `chat-temp` 页 query | |

## ⚠️ 跨端三坑

1. **`id` 语义漂移**：PC `/home/chat/:id` = conversationId；mobile `agent-detail?id=` = agentId。跨端拼接 URL 必须换名。
2. **顺序漂移**：`/home/chat/:id/:agentId` vs `/app/chat/:agentId/:id` 两段顺序相反。
3. **壳参数混入**：mobile H5 形态的 `_rs`（nonce）、`statusBarHeight`、`accessToken`、`noTicket`、`hideShare`、`subview` 是壳/UI 参数，不是业务参数（解析脚本自动归 `_shell_*`）。`accessToken` 出现在 query 属敏感面，勿入日志。

## PC 动态段路由全集（30 pattern）

```
/home/chat/:id/:agentId          /app/chat/:agentId/:id
/agent/:agentId                  /chat-temp/:chatKey
/open-iframe-page/:menuCode      /app/open-iframe-page/:agentId
/history/conversation/:agentId   /app/history/conversation/:agentId
/space/:spaceId/agent/:agentId   /space/:spaceId/:agentId/log
/space/:spaceId/skill-details/:skillId（+ apply/、published/、-conversation/ 变体）
/space/:spaceId/plugin/:pluginId（+ /cloud-tool）
/space/:spaceId/mcp/edit/:mcpId  /space/:spaceId/knowledge/:knowledgeId
/space/:spaceId/table/:tableId   /space/:spaceId/workflow/:workflowId
/space/:spaceId/app-dev/:projectId（+ -design 变体）
/space/original-text/:segmentId/:agentId
/space|/square/publish/{plugin|workflow|skill}/:id
/app/:agentId（开放应用前缀：my-subscriptions / my-orders / credit-records / usage-stats 等）
```

## Mobile 已实证页面参数（其余以页面代码为准）

```
subpackages/pages/agent-detail/agent-detail   id=agentId⚠️, conversationId, accessToken*, statusBarHeight*
subpackages/pages/terminal/terminal-device-detail  deviceId
subpackages/pages/terminal-goods-detail       goodsId
subpackages/pages/my-subscriptions|my-orders  planId / orderId / payMode
pages/chat-temp                                chatKey
跳转实测出现过的 query 键：agentId conversationId spaceId deviceId bindingId planId
  packageId goodsId payMode categoryKey orderId cId chatKey fileProxyUrl url title
  hideShare noTicket subview redirect   （* = 壳参数）
```

## 用法

```bash
python3 scripts/parse_route.py "https://host/home/chat/123/456"          # → conversationId=123, agentId=456
python3 scripts/parse_route.py "https://host/m/?_rs=n#/subpackages/pages/agent-detail/agent-detail?id=456&conversationId=123"
python3 scripts/parse_route.py --compare                                  # 两端对照表
python3 scripts/parse_route.py --routes pc                                # 路由快照
```
