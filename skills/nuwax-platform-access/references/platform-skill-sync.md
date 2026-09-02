# 平台技能库同步（skill 库 API 契约）

> 把本仓库 `skills/` 下的 skill 同步/更新/发布到 nuwax 平台技能库的实测契约（2026-09-02 实弹定版，skillId=722 全链路验证）。
>
> 接口契约正源：**`https://test-nvwa-api.xspaceagi.com/v3/api-docs`**（knife4j 界面 `https://test-nvwa-api.xspaceagi.com/doc.html#/home`）——能力边界问题先来这里查 DTO 定义，再看平台源码（`SkillController.java` / `PublishController.java`）。

## 鉴权铁律（4010 的根因）

- `/api/skill/*`、`/api/publish/*` 这类 **UI 直连接口一律 4010**：`AuthInterceptor` 要求 token 是 Redis 会话键且 `Authorization` 头长度 >35；nuwa-cli 的 savedKey（32hex，客户端注册体系）与 Agent AK（沙箱域）都过不去。
- **正路：沙箱 AK + `/api/v1/4sandbox` 前缀**。白名单在平台源码 `application.yml` 的 `sandbox.api.rewrite.allow-path`（含 `skill/**`、`publish/apply`、`file/upload`、`agent/conversation/**`、`space/list`）。
- 响应码：`0000` 成功；`4030` 缺 Bearer；`4000` 参数错（看 message）；`4040` 路径不在白名单；`4010` 未登录。

## 可用端点（前缀 `/api/v1/4sandbox`）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/skill/list?pageNum=&pageSize=` | 列表。⚠️ 该路由实测间歇 502（网关「页面已失效」页），重试或绕过（详情单个查） |
| GET | `/skill/{id}` | 详情：name/description/publishStatus/permissions/files（**contents 恒为空串，裁剪非丢失**） |
| POST | `/skill/add` | 建 skill，返回 data=新 skillId |
| POST | `/skill/update` | 改 skill（同 add body + `id`；文件 `operation` 合法值 **create/modify/delete/rename**） |
| GET | `/skill/export/{id}` | **可用**！octet-stream zip（带一层 skill 名顶层目录），用于逐字节核验 |
| POST | `/publish/apply` | 发布，见下 |

不暴露：下架（offShelf）——需平台 UI。

## add/update 请求体（SkillAddDto / SkillUpdateDto）

```jsonc
{
  "name": "nuwax-platform-access",
  "description": "…frontmatter 的 description…",
  "spaceId": 752,                    // 个人空间；见 GET /space/list
  "usageScenarios": ["TaskAgent", "ChatBot"],  // 枚举仅收：TaskAgent|PageApp|ChatBot|OpenApi|Workflow
  "files": [                          // SkillFileDto[]
    {"name": "SKILL.md", "contents": "<全文>", "operation": "create", "isDir": false}
  ]
}
```

- 文本文件直接内嵌 `contents`；`name` 用相对路径（`scripts/xxx.py`）。
- 排除 `.DS_Store`、`__pycache__`。

## 发布（publish/apply，实测成功）

```python
api_ok("POST", "/publish/apply", body={
  "targetType": "Skill", "targetId": 722,
  "remark": "nuwax-platform-access v1.0.2（…变更说明…）",
  "items": [{"scope": "Space", "allowCopy": 1, "onlyTemplate": 0}],
}, prefix="/api/v1/4sandbox")
# → "发布成功"；随后 GET /skill/{id} 见 publishStatus: Developing → Published
# publishedSpaceIds/publishDate 回填有延迟（已知现象）
```

## 标准同步流程（本 skill 已走通）

1. 本地改 `skills/<name>/`（正本），bump SKILL.md frontmatter `version`/`metadata.syncedAt`。
2. `POST /skill/add`（首次）或 `/skill/update`（后续，文件 operation=modify）。
3. `GET /skill/export/{id}` 下载 zip → 解包与本地 `find | sort -z | xargs shasum -a 256` diff → 逐字节一致。
4. `POST /publish/apply` 发布 → `GET /skill/{id}` 确认 `publishStatus: Published`。
5. 本地 frontmatter `metadata.platformSkillId` 回写真实 skillId，再 update+publish 一次补齐（保持逐字节一致的验收口径）。

## 备选链路（REST 不够用时）

驱动「技能开发」agent（agentId=2844）的会话链路（nuwa-browser skill 同步 721 时验证）：`conversation/create {agentId, devMode:true}` → SSE chat → 文本文件内嵌消息（4 反引号围栏）、二进制 cp 进本机网关工作区 `~/.nuwa-cli/workspaces/<userId>/<conversationId>/` → agent 复核。大文件 base64 经 LLM 转抄 >8K 字符必丢字节，勿用。

## 版本维护

SKILL.md frontmatter：`version` + `metadata.{version, syncedAt, platformSkillId}`。本地（nuwa-cli 仓正本）、ZCode 安装位（symlink → 正本）、S3 分发、平台技能库四处同号；改动后 bump 重同步。
