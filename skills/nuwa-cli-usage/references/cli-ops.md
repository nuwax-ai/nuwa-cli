# nuwa-cli 运维操作手册（references）

> 本文件自包含（基于实测与产品设计口径整理，2026-09-02，CLI 0.2.9），不依赖源码仓库。

## 服务拓扑

| 组件 | 端口 | 职责 |
|---|---|---|
| gateway | 127.0.0.1:60016 | `POST /computer/chat`（建会话）、`GET /computer/progress/{id}`（SSE）、`GET /computer/agent/status` |
| file-server | 0.0.0.0:60015 | `POST /api/computer/upload-file` 直传云端项目工作区；**本机监听无鉴权**，勿暴露公网 |
| lanproxy | 10076 | 隧道到平台域（云侧反连本机文件/工作区） |
| mcp-proxy | — | 消费侧：把对话所需的外部 MCP server 代理给 agent（`@nuwax-ai/mcp-proxy-ts`）。**nuwa-cli 自身不是 MCP server** |

## 安装/升级实现要点（排障时读）

- 新装：装包 → bootstrap 向导（flags `--bootstrap`/`--no-start`/`--force`）
- 升级：停服 → 增量/全量包更新 → **已登录才自动重启服务**（未登录需手动 start）
- S3 一键脚本：未装→装；异版本→`update <VERSION> --yes`；同版本→skip
- 自启动：LaunchAgent（`Boot auto-start: enabled/disabled`，status 可见；`service uninstall` 卸自启）

## 已知坑

1. **`nuwa-cli login` 重登会改注册电脑名**（credentials.json `computerName`）——多机/重装系统场景注意。
2. **登录态 ≠ 沙箱 AK**：credentials.json 的 savedKey 是客户端注册 key（32hex），调不了平台 UI 接口；平台 API 要 nuwax-platform-access 的 `SANDBOX_ACCESS_KEY`（skill-env.json 按域名缓存）。
3. **升级后服务未起**：`restartServeIfLoggedIn` 仅登录态触发；`NUWACLI_NO_START=1` 也会跳过。`nuwa-cli start` 手动补。
4. **卸载优先 npx 入口**：`npx … uninstall`（全局进程自我 `npm uninstall -g` 在 Windows 不稳，npx 路径规避）。
5. **Windows PATH**：S3/升级脚本二次调用用已刷新 PATH 或 `nuwa-cli.cmd` 绝对路径。
6. **Windows 中文乱码**：Python 脚本（platform_http 的 configure_stdio_utf8）按平台自适应——Windows 不强设 UTF-8（GBK 控制台强设反而乱码），只兜底 errors=replace；脚本控制台输出已避开 GBK 外字符（⚠️ 等）。bash 脚本（install-skill.sh）在 Git Bash/WSL 下运行，UTF-8 无此问题。

## S3 分发（skill 与 CLI 同一套桶约定）

```
s3://nuwax-packages/agent-engines/nuwa-cli/
  ├── install-from-s3.sh            # CLI 新装/升级一键脚本
  └── skills/
      ├── install-skill.sh          # skill 一键安装（公开读，零凭证）
      └── <skillName>/
          ├── latest.json           # {name, version, sha256, artifact}（max-age=60）
          └── versions/<v>/manifest.json + artifacts/<skillName>-<v>.zip(.sha256)
```

发布：`bash skills/scripts/publish-skill.sh <skillDir> --version x.y.z`（多 skill 必须显式传 skillDir；凭证走 NUWAX_S3_* 或 ~/.aws profile）。versions/ 不可变，改内容必须 bump 版本重发。

## 本地调试安装/升级

要点：升级链路回归覆盖在 CLI 包的安装向导与 update 测试中；手工调试先 `nuwa-cli stop`，用 `npx @nuwax-ai/nuwa-cli@<version> install --no-start` 验装包，再 `nuwa-cli start` 验拉起。
