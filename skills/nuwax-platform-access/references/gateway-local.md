# 本机网关与文件服务（nuwa-cli 常驻组件）

> 适用场景：本机是用户注册的「我的电脑」（Gateway + file-server + lanproxy 常驻）。
> 状态自检：`nuwa-cli status`。典型端口：Gateway `127.0.0.1:60016`、file-server `127.0.0.1:60015`、lanproxy `10076`（隧道到平台域）。
> 端口非固定契约，以 `nuwa-cli status` 实时输出为准；file-server 也可被其他 nuwax 组件以不同端口拉起（如 60005）。

## 工作区布局（云侧项目 ↔ 本机目录）

```
~/.nuwa-cli/workspaces/<user_id>/<cId>/      # cId = 云端 projectId / agentWorkDir
```

云侧项目文件树通过 lanproxy 隧道**直接读本机**该目录——上传即可见，无需推送。

## Gateway：POST /computer/chat（创建 / 自动续接会话）

请求体（JSON，字段名宽松、多别名兼容）：

| 字段 | 说明 |
|---|---|
| `prompt`（或 message/content） | 必填 |
| `session_id` | 续接指定会话；**不带时自动复用同 cwd 的活会话**，再退化按磁盘 transcript 续接，最后才新建 |
| `user_id` + `project_id` | cwd 解析为 `workspaces/<user_id>/<project_id>` |
| `agent_work_dir` | 等价 project_id 的另一种云端写法 |
| `cwd` / `workspace_dir` | 显式目录（传了就是项目目录本身，不再追加层级） |
| `engine` / `modelOverlay` / `engineEnv` / `mcpServers` / `systemPrompt` | 下游运行时配置（**云侧发起才带模型凭据**） |

⚠️ **本地裸调的坑**：不带模型凭据 → `{"code":"ENGINE_START_FAILED","message":"Authentication required"}`。这不是网关鉴权问题，是引擎适配器没有模型凭据可用。正路：云侧网页发起会话（自带凭据路由到本机），或请求带真实 `engineEnv`。

响应/进度：`GET /computer/progress/<sessionId>`（SSE）。其他：`GET /computer/agent/status`、`POST /computer/agent/stop`、`POST /computer/agent/session/cancel`、`POST /computer/local-sessions/list|read`。

## file-server：`/api/*` 路由表（实测自 nuwax-file-server）

挂载：`/api/computer`（computerRoutes）、`/api/project`（projectRoutes + codeRoutes）、`/api/git`、`/api/build`。

| 方法 | 路径（/api/computer 前缀） | 说明 |
|---|---|---|
| POST | `/upload-file` | multipart `file` + `userId`/`cId`/`filePath`（+可选 `customTargetDir`） |
| POST | `/upload-files` | multipart `files[]` + `filePaths[]`，批量（+可选 `customTargetDir`） |
| GET | `/get-file-list` | `userId`/`cId`（+`recursive`/`relativePath` 单层查询、`customTargetDir` 定向目录） |
| GET | `/resolve-file` | 按地址取文件（不过滤 dotfile） |
| GET | `/search-files` | 有界搜索：`kw` + 必填 `limit`/`maxVisit`/`timeoutMs`（+`customTargetDir`/`relativePath`） |
| POST | `/files-update` | 批量写文件：create/delete/rename/modify（+可选 `customTargetDir`） |
| POST | `/generate-file` | 生成文件 |
| GET | `/download-all-files` | 打包下载（+可选 `customTargetDir`） |
| POST | `/zip-workspace` / `/import-project` / `/create-workspace[-v2]` / `/delete-workspace` | 工作区生命周期 |
| POST | `/execute-command` / `/install-project` / `/init-project-template` / `/push-skills-to-workspace[-v2]` | 执行/装依赖/模板/技能下发 |
| GET | `/get-logs` | 日志拉取 |

`customTargetDir` = 会话电脑上的任意目录绝对路径：nuwax 会话文件树「打开本地目录」功能的数据面就走它（云网关 `/api/computer/static/*` 映射到本表端点）。注意版本边界：npm `latest=1.4.2` **不含** `relativePath`/`recursive` 单层查询与 `customTargetDir` 全端点支持（git main 1.4.3 起）；未升级到 1.4.3+ 前，nuwa-cli 机器上该功能不可用、文件树退化为全量扁平列表。

上传示例：

```bash
curl -s -X POST "http://127.0.0.1:60015/api/computer/upload-file" \
  -F "userId=1746495851" -F "cId=1561400" \
  -F "filePath=报告.md" -F "file=@报告.md"
# → {"success":true,"message":"File uploaded successfully","fileSize":39279}
```

⚠️ file-server **无鉴权**且监听 `0.0.0.0`，仅限本机/可信网内使用；这也是 nuwax 主线「5a 文件树」需求挂了安全整改项的地方（白名单 + 目录穿越防护），改造时同步关注。
