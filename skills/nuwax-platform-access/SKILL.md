---
name: nuwax-platform-access
version: 1.2.3
description: 接入 nuwax 平台底层能力的统一入口：沙箱 API 鉴权、资料库文档导入/导出、会话创建与继续、本机网关与文件服务调用、平台技能库同步发布、nuwax/nuwax-mobile 路由规则解析与两端业务参数对照（会话 Id、空间 Id 等）。当用户要求同步文档到资料库、创建/继续平台会话、上传文件到项目工作区、调用 /api/v1/4sandbox 接口、检查平台凭据可用性、解析 PC/移动端路由参数，或任何「让 Agent 具备 nuwax 平台操作能力」的场景时触发。资料库深度编辑（ops 指令级）见 library-document-management。
metadata:
  version: "1.2.3"
  syncedAt: "2026-09-02"
  platformSkillId: 722
---

# nuwax 平台能力接入

把「Agent ↔ nuwax 平台」的底层通道收敛成一个入口：**鉴权 → 探活 → 会话 → 资料库 → 文件**。本 skill 是接入底座；资料库的 ops 级深度编辑由 `library-document-management` 承担，本 skill 只负责把路打通。

## 环境契约（先检查，再干活）

| 变量 | 必填 | 说明 |
|---|---|---|
| `PLATFORM_BASE_URL` | 自动 | **不设即跟随 nuwa-cli 当前登录域名**（credentials.json 的 `domain`）——登录测试就是 `testagent.xspaceagi.com`，登录生产 `agent.nuwax.com` 自动切，多环境零配置；显式设置可强制覆盖 |
| `SANDBOX_ACCESS_KEY` | 自动 | Bearer Token，**绑定 (用户, 域名)**；未设时按当前域名取 `~/.nuwa-cli/skill-env.json` 的 `aks` 缓存，缓存未命中再在线探测登录态候选字段，探通自动按域名回写（文件 0600） |
| `DEV_AGENT_ID` | 可选 | dev 调试场景的智能体 ID（conversation.py new 用） |
| `CONVERSATION_ID` | 可选 | 继续已有会话时传入 |

> ⚠️ 已实测：**nuwa-cli 登录态（savedKey/configKey）≠ 4sandbox 的 SANDBOX_ACCESS_KEY**（后者由平台沙箱/Agent AK 体系按域名签发，跨环境不通用）。探测失败时脚本会给出补救指引：`export SANDBOX_ACCESS_KEY=<AK>`，或写 `~/.nuwa-cli/skill-env.json`：`{"aks": {"<域名>": "ak-..."}}`。每个登录过的域名配一次即可。

```bash
# 前置体检（五层门禁，用 skill 前先跑）：安装/版本升级/本机服务/登录态/平台 API
python3 scripts/check_env.py          # 任一层 FAIL 给修复指引，退出码 1
```

成败判断铁律：**看响应 JSON 的 `code`，`"0000"` 才是成功——HTTP 200 也可能是失败**（`4030`=缺 Bearer，`4000`=参数/凭据无效，`4040`=路径不存在）。AK 报 `page not found`/`4030` 多半是 AK 的 user 不在目标 space。

## 能力矩阵与脚本速查

| 能力 | 脚本 | 一句话 |
|---|---|---|
| **前置体检** | `scripts/check_env.py` | 五层门禁：L1 nuwa-cli 安装 → L2 版本升级（npm 比对）→ L3 本机服务（gateway/file-server/lanproxy）→ L4 登录态 → L5 平台 API；**核心功能前提，先跑这个**；FAIL 层给修复指引 |
| **文档导入资料库** | `scripts/library_import.py <file.md> [--title X] [--space-id N]` | 走 `POST /repo/import`，一步建页+解析+快照；不传 spaceId 自动选个人空间 |
| 文档导出 | `scripts/library_export.py <pageId> [--format markdown]` | GET /repo/pages/{id}/export，实时内容 |
| **创建会话** | `scripts/conversation.py new --agent-id N [--dev-mode]` | POST /conversation/create，打印 conversationId |
| 会话收尾 | `scripts/conversation.py cancel <conversationId>` | POST /conversation/chat/stop/{id} |
| 文件传到项目工作区 | `scripts/upload_workspace_file.sh <file> <cId> [userId]` | 本机 file-server `/api/computer/upload-file`，云侧文件树立即可见 |
| **文档定时同步** | `scripts/sync_library_doc.py <file> --title X` | 替换式同步（本地最优先）：sha 门闩，变更即删旧页+导新页，配合自动化做「有变更就同步」 |

所有 Python 脚本：纯标准库、零依赖；退出码 `0` 成功 | `1` 参数错 | `2` 缺环境 | `3` HTTP 失败/超时 | `4` 业务错误；`--quiet` 输出裸值方便管道。

## 端点地图（详细格式见 references/）

- **平台会话/Agent**（`references/api-platform.md`）：`POST /conversation/create`、`POST /conversation/chat/stop/{id}`、agent 配置读取。
- **资料库**（`references/api-library.md`）：repo 前缀 13 端点速查 + `/import` 的 `text`/`content`/`fileKey` 语义；**深度 ops 编辑直接读 `library-document-management` 的 references，勿在此重复**。
- **本机网关/文件**（`references/gateway-local.md`）：`POST :60016/computer/chat`（创建/自动续接同 cwd 会话）、`GET :60016/computer/progress/{id}` SSE、`POST :60015/api/computer/upload-file`；workspaces 布局 `~/.nuwa-cli/workspaces/<user_id>/<cId>/`。
- **技能库同步**（`references/platform-skill-sync.md`）：沙箱前缀 `/api/v1/4sandbox` 下 `skill/add|update|export` + `publish/apply` 全 REST 链路；UI 直连 `/api/skill/*` 恒 4010；契约正源 `test-nvwa-api.xspaceagi.com/doc.html`。
- **路由解析与两端参数对照**（`references/route-mapping.md`）：`parse_route.py` 把 nuwax(PC, umi 路径段)/nuwax-mobile(静态页+query) 的 URL 解析为统一业务参数字典（conversationId/agentId/spaceId/...），`--compare` 出两端对照表；⚠️ `id` 参数两端语义相反、`/app/chat` 与 `/home/chat` 段顺序相反。

## 必踩的坑（先读再写代码）

1. **本地裸起网关会话会 `ENGINE_START_FAILED: Authentication required`**——云端发起的会话请求自带 `modelOverlay`/`engineEnv`（模型凭据），本地裸调没有。要本地起网关会话：云侧网页发起（推荐），或请求里带真实模型凭据。「创建/继续会话」走平台 API（conversation.py）没有此问题。
2. **AK 是用户级不是全局**：换 space 报找不到页面，先查 AK 的 user 是否在 space 里，别怀疑接口。
3. **`/import` 的文本类走 `text` 字段**（md/txt/html/csv），`content`（base64）只给二进制深度解析用；只传 `fileKey` 会得到占位页。
4. **file-server 监听本机且无鉴权**（`0.0.0.0:60015`），只能在本机/可信网内用；上传目标 `cId` 必须是已存在的项目工作区。
5. 平台接口返回体包一层 `{code, message, data, success}`，脚本已统一剥 `data`；自己写 curl 记得取 `data`。

## 推荐工作流

**同步本地文档到资料库**（最高频）：
```bash
export PLATFORM_BASE_URL=https://testagent.xspaceagi.com
export SANDBOX_ACCESS_KEY=<AK>
python3 scripts/check_env.py                              # 1. 体检
python3 scripts/library_import.py 报告.md --title 报告      # 2. 导入，回显 pageId/slugId
```

**创建会话**：`conversation.py new --agent-id $DEV_AGENT_ID` 拿 conversationId → 消息执行/调试走业务 SSE（dev 调试进阶，未配置前可先用网页端）→ 结束 `conversation.py cancel <id>`。

**文件给云侧项目**：`upload_workspace_file.sh 文件 <cId> <userId>` → 云侧文件树即刻可见（经 lanproxy 隧道读本机）。

## 安装 / 升级（套件一键）

套件总入口是 **nuwa-cli-usage**——缺省安装即装齐套件（usage + 本 skill）：

```bash
bash <(curl -fsSL https://s3.nuwax.com:9443/nuwax-packages/agent-engines/nuwa-cli/skills/install-skill.sh)
# 只装本 skill（跳过套件关联）：…install-skill.sh nuwax-platform-access --no-bundle
# 指定 agent 专属目录：…install-skill.sh --target ~/.nuwa-cli/workspaces/<user>/.agent-store/<agentId>/skills
```

安装目标目录加入 agent CLI 的 skills 搜索路径即可被发现（ZCode：`~/.zcode/skills/`，可软链）。套件成员亦可经平台技能库分发（本 skill=722、usage=723，`references/platform-skill-sync.md`）。
