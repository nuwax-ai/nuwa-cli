---
name: nuwa-cli-usage
version: 0.2.2
description: nuwa-cli 技能套件总入口。覆盖两块：① nuwa-cli 生命周期运维——安装、升级、登录、服务管理（gateway/file-server/lanproxy）、排障；② 通过随装的 nuwax-platform-access 使用 nuwax 平台能力——资料库文档同步、平台会话、文件上传、技能库同步发布、nuwax/nuwax-mobile 路由参数对照。当用户要求安装/升级/卸载 nuwa-cli、检查版本/服务/登录状态、排障 CLI、或任何「让 Agent 接入 nuwax 平台/同步文档到资料库/操作平台 API」的场景时触发。
metadata:
  syncedAt: "2026-09-02"
---

# nuwa-cli 技能套件（总入口）

本 skill 是 **nuwa-cli 技能套件的总入口**，一键安装时自动随装套件成员。两个成员各管一层：

| 成员 | 职责 | 位置 |
|---|---|---|
| **nuwa-cli-usage**（本 skill） | CLI 生命周期：安装/升级/登录/服务/排障 | 本目录 |
| **nuwax-platform-access** | 平台 API 能力：沙箱鉴权、资料库导入导出、平台会话、文件上传、技能库同步、路由参数对照 | 套件随装成员，安装后与本 skill 同级（直装/`--no-bundle` 时可能缺席） |

**先用谁**：装不上/起不来/版本问题 → 本 skill；CLI 能跑了要用平台功能（同步文档/建会话/传文件）→ 套件随装的 nuwax-platform-access（同级目录）体检后按其 SKILL.md 工作流走；若未随装，按 §4 一键补装。

---

## 1. 前置体检（一切之前先跑）

```bash
# nuwax-platform-access 的 scripts/check_env.py（套件随装，与本 skill 同级）
python3 <skills-dir>/nuwax-platform-access/scripts/check_env.py
# 五层门禁：L1 nuwa-cli 安装 → L2 版本升级(npm 比对) → L3 本机服务 → L4 登录态 → L5 平台 API
# FAIL 层给修复指引，退出码 1
```

## 2. nuwa-cli 命令速查

| 场景 | 命令 | 说明 |
|---|---|---|
| 新装 | `npx @nuwax-ai/nuwa-cli@latest install` | 装包 → bootstrap 向导（登录 → 启动服务） |
| 新装（S3，国内可达） | `curl -fsSL https://s3.nuwax.com:9443/nuwax-packages/agent-engines/nuwa-cli/install-from-s3.sh \| bash` | 同分流逻辑，`--yes` 静默 |
| **日常升级** | `nuwa-cli update` | 停服 → 包更新 → 已登录自动重启服务 |
| 状态自检 | `nuwa-cli status` | 登录域名/用户 + gateway(60016)/file-server(60015)/lanproxy(10076)/mcp-proxy + 开机自启 |
| 版本 | `nuwa-cli --version` | |
| 登录 | `nuwa-cli login` | ⚠️ 重登会**改注册电脑名** |
| 启动/停止 | `nuwa-cli start` / `nuwa-cli stop` | |
| 卸载 | `npx @nuwax-ai/nuwa-cli@latest uninstall` | 默认保留 `~/.nuwa-cli`（凭据/缓存）；`--purge` 才删 |

升级**永远走 `nuwa-cli update`**，不要手工 `npm i -g` 覆盖（绕过停服/重启）。

## 3. 排障速查

| 现象 | 处置 |
|---|---|
| `nuwa-cli: command not found` | `npx @nuwax-ai/nuwa-cli@latest install`；Windows 用绝对路径 `nuwa-cli.cmd` |
| status 显示服务 down | `nuwa-cli start`；仍 down 查 `~/.nuwa-cli/logs/` |
| 平台 API 4010/未登录 | nuwa-cli 登录态 ≠ 沙箱 AK：`nuwa-cli login` 后按 nuwax-platform-access 指引配 `SANDBOX_ACCESS_KEY` |
| 端口被占（60015/60016/10076） | `nuwa-cli stop` 后重启，清残留 node 进程 |
| 升级后服务没起 | update 仅**已登录**才自动 restart；未登录先 login 再 start |

## 4. 套件安装 / 升级（一键）

```bash
# 缺省=总入口：装 nuwa-cli-usage 并自动随装 nuwax-platform-access（公开读，零凭证；latest 定版 + sha256 校验）
bash <(curl -fsSL https://s3.nuwax.com:9443/nuwax-packages/agent-engines/nuwa-cli/skills/install-skill.sh)

# 只装/直装单个成员（跳过套件关联）：
bash <(curl -fsSL …install-skill.sh) nuwax-platform-access --no-bundle
# 装到某 agent 专属目录：加 --target ~/.nuwa-cli/workspaces/<user>/.agent-store/<agentId>/skills
```

安装目标目录加入 agent CLI 的 skills 搜索路径即可被发现（ZCode：`~/.zcode/skills/` 可软链）。套件成员也可从平台技能库分发（platform-access=722、nuwa-cli-usage=723，同步契约见 platform-access 的 `references/platform-skill-sync.md`）。

## 5. 逃生口

`nuwa-cli install --no-start`（只装包）｜`NUWACLI_NO_START=1`（跳过 bootstrap）｜`install --force`｜`uninstall --purge`（连用户数据删，慎用）｜install-skill.sh `--no-bundle`（不随装）

详细实现与历史坑：`references/cli-ops.md`（自包含，无需源码仓）。
