import type { en } from "./en.js";

/**
 * 简体中文文案包。key 集必须与 en.ts 完全一致(类型约束:缺 key 编译报错)。
 * 命中简体中文 locale(或手动切换)时使用。
 */
export const zhCN: { [K in keyof typeof en]: string } = {
  // —— common ——
  "common.tag": "[nuwa-cli]",
  "common.cancelled": "已取消。",
  "common.signal": "信号",
  "common.shuttingDown": "\n[nuwa-cli] 收到 {signal}，正在关闭...",
  // —— lang 命令 ——
  "lang.current": "当前语言：{lang}",
  "lang.resolved": "解析来源：{source}",
  "lang.sourceEnv": "NUWACLI_LANG 环境变量",
  "lang.sourceConfig": "配置文件（~/.nuwa-cli/config.json）",
  "lang.sourceDetect": "系统 locale 自动检测",
  "lang.sourceDefault": "默认",
  "lang.set": "语言已设置为 {lang}。",
  "lang.setAuto": "语言已设置为 auto（将按系统 locale 自动检测）。",
  "lang.badCode": "不支持的语言代码：{code}。可用：en、zh-CN、auto。",
  "lang.hint": "可用 NUWACLI_LANG=en|zh-CN 临时覆盖。",
  // —— cli: top-level ——
  "cli.description":
    "无头多引擎 agent CLI —— 通过 ACP 接入本机已安装的 claude/codex CLI，提供受管 Gateway、Console 与远程会话路由",
  // —— cli: shared login options ——
  "cli.login.opt.domain": "Nuwax 服务器地址；不传则使用当前默认 domain",
  "cli.login.opt.savedKey":
    "已有 savedKey；会保存为当前账号并加入多账号 JSON 映射",
  "cli.login.opt.username":
    "账号名；同 domain+username 已保存时会复用 savedKey，密码仅用于本次请求",
  "cli.login.help.block":
    "\n说明：\n  - 不使用 SQLite，凭证保存在 ~/.nuwa-cli/credentials.json。\n  - 同一 domain+username 再次登录会复用已保存 savedKey，避免后端新建电脑。\n  - 不传 --domain / -u 时，会用当前默认账号的 savedKey 免密重新注册。",
  // —— cli: model overlay ——
  "cli.opt.apiKey": "覆盖模型 API key",
  "cli.opt.baseUrl": "覆盖模型 API base URL",
  "cli.opt.model": "覆盖模型名称",
  // —— cli: ui (console) ——
  "cli.ui.opt.port": "Console 监听端口；占用时自动向后寻找可用端口",
  "cli.ui.opt.host": "Console 监听地址（仅建议 127.0.0.1）",
  "cli.ui.opt.engine": "默认引擎：claude 或 codex（界面内仍可切换）",
  "cli.ui.opt.cwd": "新会话的默认工作目录；不传时使用默认工作区",
  "cli.ui.opt.approve":
    "权限策略：auto（默认，自动批准）/ ask（逐个审批）/ deny",
  "cli.ui.opt.force": "发现已有 Console 时，先停止旧的前台实例再启动",
  "cli.ui.opt.noOpen": "启动后不自动打开浏览器",
  // —— cli: serve / service shared ——
  "cli.serve.opt.port": "HTTP API 优先监听端口；占用时自动向后寻找可用端口",
  "cli.serve.opt.host": "HTTP API 监听地址",
  "cli.serve.opt.cwd":
    "当前项目目录；不传时按 ~/.nuwa-cli/workspaces/<project_id> 自动创建",
  "cli.serve.opt.approve":
    "权限策略：auto（默认，普通工具自动批准；敏感访问仍需审批）、ask（全部人工审批）或 deny",
  "cli.serve.opt.lanproxyPath":
    "覆盖 npm 平台包：指定 lanproxy 二进制或 Electron resources 目录",
  "cli.serve.opt.lanproxyHost": "覆盖注册返回的 lanproxy serverHost",
  "cli.serve.opt.lanproxyPort": "覆盖注册返回的 lanproxy serverPort",
  "cli.serve.opt.lanproxySsl": "lanproxy 是否启用 ssl",
  "cli.serve.opt.daemon":
    "后台运行（stdout/stderr 写入 ~/.nuwa-cli/logs/ 下按天滚动的 serve.<日期>.log）",
  "cli.serve.opt.force": "发现已有 Gateway/serve 时，先停止旧实例再启动",
  "cli.service.opt.engine":
    "服务启动时使用的引擎：claude 或 codex；不传则由 Gateway 自动检测",
  "cli.service.opt.now": "安装后立即启动服务",
  // —— cli: shared option fragments ——
  "cli.opt.jsonArray": "以 JSON 数组格式输出",
  "cli.opt.json": "以 JSON 格式输出",
  "cli.opt.jsonOnly": "以 JSON 输出（当前是唯一输出格式）",
  "cli.opt.engineFilter": "只看某个引擎：claude 或 codex",
  "cli.opt.ref": "上下文引用，如 claude:xxxx",
  "cli.opt.limitMsgs": "只返回最近 N 条消息",
  "cli.cmd.engineDefault": "Gateway/Console 使用的默认引擎：claude 或 codex",
  "cli.cmd.enginePick": "使用的引擎：claude 或 codex",
  // —— service commands ——
  "cli.cmd.start.desc": "启动 Gateway（daemon）；加 --all 时再启动前台 Console",
  "cli.cmd.start.opt.all": "同时启动 Gateway 和前台 Console",
  "cli.cmd.start.opt.cwd": "Gateway 和 Console 使用的工作目录",
  "cli.cmd.start.opt.approve": "权限策略：auto（默认）/ ask（逐个审批）/ deny",
  "cli.cmd.start.opt.force":
    "强制替换现有实例（默认仅 Gateway；--all 时含 Console）",
  "cli.cmd.start.opt.noOpen":
    "仅 --all 时有效：Console 启动后不自动打开浏览器",
  "cli.cmd.start.help":
    "\n说明：\n  - 默认只启动/复用 Gateway（daemon），不占用当前终端。\n  - `--all` 才会额外启动前台 Console；也可单独用 `nuwa-cli console`。\n  - 未登录时先进入交互式登录流程，登录成功后自动继续启动。\n  - 默认复用健康实例，只补齐缺失服务；--force 会强制替换。\n  - 带 --all 时 Console 占用当前终端；Ctrl+C 只关闭 Console，Gateway 继续运行。",
  "cli.cmd.restart.desc":
    "强制重启 Gateway（daemon）；加 --all 时再重启前台 Console",
  "cli.cmd.restart.opt.all": "同时强制重启 Gateway 和前台 Console",
  "cli.cmd.restart.help":
    "\n说明：\n  - 默认只强制重启 Gateway（gateway --daemon --force）。\n  - `--all` 才会额外强制重启前台 Console。\n  - 带 --all 时 Console 占用当前终端；Ctrl+C 可关闭 Console。\n  - 如果 Gateway 重启失败，不会继续重启 Console。",
  "cli.cmd.stop.desc": "停止 Gateway 或 Console；不传范围时默认只停止 Gateway",
  "cli.cmd.stop.opt.all": "同时停止 Gateway 和 Console",
  "cli.cmd.stop.opt.gateway": "仅停止 Gateway",
  "cli.cmd.stop.opt.console": "仅停止 Console",
  "cli.cmd.stop.help":
    "\n说明：\n  - 默认只停止 Gateway（含关联的 tunnel/lanproxy）。\n  - `--all` 才会同时停止前台 Console。",
  "cli.cmd.serve.desc": "启动本机 HTTP API（chat + SSE），供脚本/云端/IM 远程调度",
  "cli.cmd.serve.opt.tunnel": "登录后启动本地 nuwax-file-server 与 lanproxy 隧道",
  "cli.cmd.gateway.desc":
    "启动 Gateway Server：检测引擎、登录/注册并运行 serve --tunnel",
  "cli.cmd.gateway.opt.engine": "使用的引擎：claude 或 codex；不传则自动选择",
  "cli.cmd.gateway.help":
    "\n说明：\n  - 不传 --domain / -u / --saved-key 时，使用当前默认账号 savedKey 免密注册。\n  - 使用 -u 时，若 credentials.json 中已有同 domain+username 的 savedKey，会随注册请求一起提交，避免新建电脑。\n  - 密码通过交互输入；CI 可用 NUWACLI_PASSWORD，且该变量不会传给 engine/lanproxy/file-server。\n  - 未传 --engine 时自动检测 claude/codex；多个可用时随机选择一个。",
  "cli.cmd.service.desc":
    "管理 Gateway 的后台常驻与开机/登录自启动（不管理 Console）",
  "cli.cmd.service.install.desc":
    "安装当前用户后台服务；默认下次用户登录启动，传 --now 立即启动",
  "cli.cmd.service.install.help":
    "\n说明：\n  - 安装前需要已有 CLI 默认账号：先运行 `nuwa-cli login` 或 `nuwa-cli gateway` 成功一次。\n  - 启动项不会保存密码、savedKey、configKey 或模型 API key；登录态仍从 ~/.nuwa-cli/credentials.json 读取。\n  - macOS 使用 LaunchAgent，Linux 使用 systemd user service，Windows 使用当前用户计划任务。\n  - Linux 默认是用户登录后启动；未登录也启动需要系统启用 linger。",
  "cli.cmd.service.start.desc": "启动已安装的后台服务",
  "cli.cmd.service.stop.desc": "停止已安装的后台服务",
  "cli.cmd.service.status.desc": "查看系统启动项与当前 serve 运行状态",
  "cli.cmd.service.uninstall.desc": "停止并移除后台服务/开机启动项",
  // —— agent commands ——
  "cli.cmd.ps.desc": "列出运行中的 Gateway、Console 和 chat 进程",
  "cli.cmd.doctor.desc":
    "检测环境、登录态与 Gateway/lanproxy 运行态；加 --fix 时自动修复可处理的问题",
  "cli.cmd.doctor.opt.fix":
    "按检测结果自动修复：补装登录自启、清理多实例、重建异常的 Gateway/lanproxy 栈",
  "cli.cmd.chat.desc":
    "与本机已登录的 claude/codex 对话（复用其登录态与本地配置）",
  "cli.cmd.chat.opt.cwd": "工作目录",
  "cli.cmd.chat.opt.print": "单次输出模式：发送一条 prompt 并退出",
  "cli.cmd.chat.opt.yolo": "自动批准所有工具调用（危险，谨慎使用）",
  "cli.cmd.chat.opt.mode":
    "设置引擎会话模式（如 acceptEdits/bypassPermissions，因引擎而异）",
  "cli.cmd.chat.opt.resume": "续接本地历史会话；不带 id 时弹出交互选择列表",
  "cli.cmd.chat.opt.refSession":
    "关联另一个引擎的历史会话作为上下文（如 claude:xxxx）；不是真续接，只在首轮提醒模型按需运行 `sessions summary` 查看",
  "cli.cmd.chat.opt.autoDigest":
    "与 --ref-session 连用时自动读取摘要并注入首轮（默认只提示模型自行查询）",
  "cli.cmd.chat.opt.handoff":
    "从另一个本地会话生成结构化交接包，并在新 ACP 会话首轮注入",
  "cli.cmd.sessions.desc": "列出本地 claude/codex 会话历史",
  "cli.cmd.sessions.opt.search": "按标题、sessionId 或路径模糊搜索",
  "cli.cmd.sessions.opt.days": "只看最近 N 天的会话",
  "cli.cmd.sessions.opt.since": "只看此日期之后的会话（ISO 格式，如 2026-07-01）",
  "cli.cmd.sessions.opt.until": "只看此日期之前的会话",
  "cli.cmd.sessions.opt.limit": "最多返回 N 个会话",
  "cli.cmd.sessions.opt.verbose": "显示更详细的信息",
  "cli.cmd.sessions.summary.desc":
    "输出某个本地会话的紧凑 JSON 摘要（供 agent 按需读取另一引擎的历史，见 chat --ref-session）",
  "cli.cmd.sessions.summary.opt.engine": "会话所属引擎：claude 或 codex",
  "cli.cmd.sessions.summary.opt.sessionId": "会话 ID",
  "cli.cmd.sessions.summary.opt.limit": "只返回最近 N 条消息",
  "cli.cmd.sessions.summary.opt.offset": "跳过前 N 条消息（与 --limit 配合分页）",
  "cli.cmd.sessions.summary.opt.format": "输出格式：json（默认）或 jsonl",
  "cli.cmd.sessions.summary.opt.reverse": "按时间逆序输出（新消息在前）",
  "cli.cmd.workspaces.desc":
    "列出本地工作空间目录（云端会话生成的文件，~/.nuwa-cli/workspaces）",
  "cli.cmd.workspaces.opt.user": "只看某个用户 ID 下的项目",
  "cli.cmd.workspaces.opt.long": "列出每个项目内的文件树",
  // —— cloud commands ——
  "cli.cmd.login.desc": "登录 Nuwax 云账号；不传 domain/username 时使用当前默认账号",
  "cli.cmd.logout.desc": "退出登录（保留 savedKey，可免密重新登录）",
  "cli.cmd.status.desc": "查看 Nuwax 登录状态以及 Gateway/Console 运行状态",
  "cli.cmd.status.opt.remote": "额外向服务器校验 savedKey 是否仍然有效",
  "cli.cmd.config.desc": "查看/修改当前默认账号配置（多账号请用 account 命令）",
  "cli.cmd.config.get.desc": "查看配置项，省略 key 时列出全部",
  "cli.cmd.config.set.desc": "设置配置项（domain/saved-key/username/lanproxy-path）",
  "cli.cmd.account.desc":
    "管理 credentials.json 中保存的多个 Nuwax 账号（轻量 JSON，无 SQLite）",
  "cli.cmd.account.list.desc": "列出已保存账号，并用 * 标记当前默认账号",
  "cli.cmd.account.switch.desc":
    "切换当前默认账号；serve 运行中会拒绝，需先 Ctrl-C 停服务",
  "cli.cmd.account.switch.help":
    "\n参数：\n  account  可用 `nuwa-cli account list` 输出的 key，例如 testagent.xspaceagi.com_18011447397；\n           也可传唯一 username。\n\n说明：\n  切换账号会重新注册当前账号，并要求重新启动 serve/file-server/lanproxy。\n  如果 Gateway 正在运行，本命令会拒绝执行；请先运行 `nuwa-cli stop --all`。",
  // —— context commands ——
  "cli.cmd.context.desc": "跨 Agent 上下文引用与交接（ACP 会话之上的只读辅助层）",
  "cli.cmd.context.list.desc": "列出本地可引用上下文",
  "cli.cmd.context.read.desc": "读取一个本地会话的规范化消息流 JSON",
  "cli.cmd.context.digest.desc": "输出一个本地会话的规则型压缩摘要 JSON",
  "cli.cmd.context.digest.opt.limit": "最多读取最近 N 条消息参与摘要",
  "cli.cmd.context.handoff.desc":
    "输出一个适合跨 Agent 接手工作的结构化交接包 JSON",
  "cli.cmd.context.handoff.opt.limit": "最多读取最近 N 条消息参与交接包",
  // —— update / console ——
  "cli.cmd.update.desc": "升级 nuwa-cli CLI（当前默认跟随 beta 通道）",
  "cli.cmd.update.opt.check": "只查询目标版本，不执行安装",
  "cli.cmd.update.opt.dryRun": "打印升级命令但不执行",
  "cli.cmd.update.opt.registry": "指定 npm registry",
  "cli.cmd.update.help":
    "\n示例：\n  nuwa-cli update\n  nuwa-cli update 0.1.0-beta.2\n  nuwa-cli update latest\n  nuwa-cli update --check\n\n说明：\n  - update 使用 npm 升级全局 CLI 包，不修改 ~/.nuwa-cli 登录数据。\n  - 当前预发布阶段默认跟随 beta；可显式指定版本或 latest tag。\n  - npx 临时运行时，建议直接使用 npx -y @nuwax-ai/nuwa-cli@beta ...。",
  "cli.cmd.console.desc":
    "启动本地 Web Console：查看/续接/新建会话并直接聊天（仅前台单例）",
  // —— update ——
  "update.emptyTarget":
    "升级版本不能为空。示例：nuwa-cli update beta 或 nuwa-cli update 0.1.0-beta.2",
  "update.noNpm": "未找到 npm。请先安装 Node.js/npm 后重试。",
  "update.queryFailed": "查询 npm 版本失败。",
  "update.currentVersion": "当前版本：{version}",
  "update.targetSpec": "{spec}：{version}",
  "update.alreadyTarget": "已是目标版本。",
  "update.canUpgrade": "可升级：{from} -> {to}",
  "update.targetVersion": "目标版本：{version}",
  "update.upgradeTarget": "升级目标：{spec}",
  "update.execute": "执行：{cmd}",
  "update.step1": "步骤 1/4：检查目标版本...",
  "update.alreadyLatest": "已是最新版本，无需重新安装。",
  "update.step2": "步骤 2/4：停止运行中的服务以释放升级文件...",
  "update.stopped": "已停止运行中的服务。",
  "update.step3": "步骤 3/4：安装 ",
  "update.installDone": "安装完成。",
  "update.doneHint":
    "升级命令已完成。请重新运行 `nuwa-cli --version` 确认当前 shell 解析到的新版本。",
  "update.step4": "步骤 4/4：重启服务（已登录时）...",
  "update.notLoggedIn":
    "未登录 Nuwax，已跳过升级后的服务自动重启。请先运行 `nuwa-cli login` 登录，再运行 `nuwa-cli gateway` 启动服务。",
  "update.restarted": "已登录，已重启所有服务（Gateway 正在后台拉起子服务）。",
  "update.restartMaybeFailed":
    "serve 自动重启可能未完成（restart 退出码 {code}）。可手动运行 `nuwa-cli gateway`。",
  "update.restartSkipped": "serve 自动重启跳过：{msg}",
  // —— config ——
  "config.domain": "域名：{value}",
  "config.username": "用户：{value}",
  "config.computerName": "电脑名：{value}",
  "config.accounts": "账号数：{n}",
  "config.savedKey": "savedKey：{state}",
  "config.lanproxyPath": "lanproxy 路径：{value}",
  "config.stateSet": "(已设置)",
  "config.stateUnset": "(未设置)",
  "config.unknownKey": "[nuwa-cli] 未知配置项 \"{key}\"，可用：{keys}",
  "config.updated": "已更新 {key}。",
  // —— processes / ps / stop ——
  "processes.none": "未发现仍在运行的 nuwa-cli 进程。",
  "processes.header": "PID\t类型\t状态\t模式\t地址\t启动时间",
  "processes.label.gateway": "网关",
  "processes.label.console": "控制台",
  "processes.label.lanproxy": "lanproxy",
  "processes.label.chat": "会话",
  "processes.label.fileServer": "文件服务",
  "processes.state.running": "运行中",
  "processes.state.starting": "启动中",
  "processes.mode.legacy": "旧版",
  "processes.mode.daemon": "后台",
  "processes.mode.foreground": "前台",
  "processes.stoppedGateway": "已停止 Gateway（PID {pids}）。",
  "processes.stoppedConsole": "已停止 Console（PID {pids}）。",
  "processes.noneInRange": "未发现选定范围内正在运行的服务。",
  "processes.stopFailed": "[nuwa-cli] 停止服务失败：{msg}",
  // —— gateway ——
  "gateway.engineSelected": "已选择引擎：{engine}",
  "gateway.engineAvailable": "已选择引擎：{engine}（可用：{available}）",
  "gateway.failed": "[nuwa-cli] gateway 失败：{msg}",
  "gateway.firstStartHint":
    "首次启动需要 --domain <host> --saved-key <key> 或 --domain <host> -u <username>，或先运行 `nuwa-cli login` 登录。",
  // —— doctor ——
  "doctor.detailSep": "；",
  "doctor.label.tcc": "macOS 权限（TCC）",
  "doctor.label.login": "Nuwax 云账号",
  "doctor.label.computer": "我的电脑",
  "doctor.label.sessions": "本地会话历史",
  "doctor.label.autostart": "开机自启",
  "doctor.label.serveSingleton": "serve 单例",
  "doctor.label.uiSingleton": "Console 单例",
  "doctor.node.detailFail": "v{version}（需要 >= 22）",
  "doctor.node.fix": "安装 Node.js 22 或更高版本：https://nodejs.org",
  "doctor.claude.detailCliVer": "运行时可用；本机 CLI：{bin} ({ver})",
  "doctor.claude.detailCli": "运行时可用；本机 CLI：{bin}",
  "doctor.claude.detailBuiltin":
    "内置运行时可用（{arg}）；未安装本机 CLI，本地历史/配置可能为空，可使用 ACP 下发配置",
  "doctor.fix.reinstall": "重新安装 nuwa-cli（不要使用 --omit=optional）",
  "doctor.codex.detailRuntime": "运行时可用（{arg}）",
  "doctor.codex.detailCliVer": "本机 CLI：{bin} ({ver})",
  "doctor.codex.detailCli": "本机 CLI：{bin}",
  "doctor.codex.detailNoCli": "未安装本机 CLI",
  "doctor.codex.detailIsolated":
    "隔离模式运行（认证经 ACP/env 下发，不复用 ~/.codex）",
  "doctor.codex.detailHasAuth": "已检测到本地登录/配置",
  "doctor.codex.detailNoAuth":
    "无本地登录/配置；本地历史与模型提示可能为空，可使用 ACP 下发配置",
  "doctor.uv.detailMissing": "未在 PATH 中找到（可选，部分 MCP 依赖需要）",
  "doctor.uv.fix":
    "安装 uv：https://docs.astral.sh/uv/getting-started/installation/",
  "doctor.tcc.detailRisky":
    "当前目录 {cwd} 在系统权限保护范围内，子进程可能因权限不足崩溃",
  "doctor.tcc.detailOk": "当前目录无已知 TCC 风险",
  "doctor.tcc.fix":
    "在「系统设置 → 隐私与安全性」授予终端对该目录的完全磁盘访问权限，或切换到非受保护目录",
  "doctor.login.detailNotLoggedIn": "未登录",
  "doctor.login.detailOk": "已登录（{domain}）",
  "doctor.login.domainUnknown": "未知域名",
  "doctor.login.detailSavedKey": "未登录（savedKey 已保存，可免密重新登录）",
  "doctor.login.detailCredNoLogin": "凭证文件存在但未登录",
  "doctor.login.detailCorrupt": "凭证文件损坏",
  "doctor.login.fixLogin": "运行 `nuwa-cli login` 免密重新登录",
  "doctor.login.fixHint":
    "运行 `nuwa-cli login --domain <host> --saved-key <key>` 登录",
  "doctor.login.fixRelogin": "运行 `nuwa-cli login` 重新登录",
  "doctor.computer.detailUnset": "尚未注册，登录后由 Nuwax 分配电脑名",
  "doctor.lanproxy.fixReinstall":
    "重新安装 nuwa-cli（不要使用 --omit=optional），并确认当前 npm 源已同步平台包",
  "doctor.lanproxy.healthNoResp": "无响应",
  "doctor.lanproxy.healthDown": "不可用",
  "doctor.lanproxy.detailRunningUnhealthy":
    "进程运行中（PID {pids}），但 Gateway /health {state}；二进制：{bin}",
  "doctor.lanproxy.detailGatewayOkNoLanproxy":
    "Gateway /health 正常，但未检测到 lanproxy 进程；二进制：{bin}",
  "doctor.lanproxy.fixRebuildGw":
    "运行 `nuwa-cli doctor --fix` 自动重建 Gateway/lanproxy；并检查 {log}",
  "doctor.lanproxy.fixRebuildTunnel":
    "运行 `nuwa-cli doctor --fix` 自动重建云端隧道；并检查 {log}",
  "doctor.lanproxy.detailRunningOk":
    "运行中（PID {pids}），Gateway /health 正常；二进制：{bin}",
  "doctor.lanproxy.detailInstalledNotRunning":
    "已安装，当前未运行；二进制：{bin}",
  "doctor.sessions.detail": "claude: {claude} 个会话，codex: {codex} 个会话",
  "doctor.autostart.fix":
    "运行 `nuwa-cli doctor --fix` 自动安装登录自启；也可手动 `nuwa-cli service install`（`--now` 立即启动）；关闭用 `nuwa-cli service uninstall`",
  "doctor.serveSingleton.detailNone": "未运行（单例状态正常）",
  "doctor.serveSingleton.detailOne": "运行中（PID {pid}）",
  "doctor.serveSingleton.detailMany": "检测到 {n} 个实例（PID {pids}）",
  "doctor.serveSingleton.fix":
    "运行 `nuwa-cli doctor --fix` 清理多余实例并重建 Gateway 栈",
  "doctor.uiSingleton.detailNone": "未运行（单例状态正常）",
  "doctor.uiSingleton.detailOne": "前台运行中（PID {pid}）",
  "doctor.uiSingleton.detailMany":
    "检测到 {n} 个前台实例（PID {pids}）",
  "doctor.uiSingleton.fix":
    "运行 `nuwa-cli doctor --fix` 清理多余 Console（不自动重开前台；需要时再 `nuwa-cli console`）",
  "doctor.mcp.detailOk": "已解析 {path}",
  "doctor.mcp.detailMissing": "未找到 @nuwax-ai/mcp-proxy-ts 入口（dist/index.js）",
  "doctor.mcp.fix": "确认已安装依赖：npm install @nuwax-ai/mcp-proxy-ts",
  "doctor.step.node": "正在检测 Node.js 版本...",
  "doctor.step.claude": "正在检测 claude CLI...",
  "doctor.step.codex": "正在检测 codex CLI...",
  "doctor.step.uv": "正在检测 uv...",
  "doctor.step.tcc": "正在检测 TCC 权限（macOS）...",
  "doctor.step.login": "正在检测 Nuwax 登录...",
  "doctor.step.computer": "正在检测 Nuwax 电脑注册...",
  "doctor.step.lanproxy": "正在检测 lanproxy / 云端隧道...",
  "doctor.step.autostart": "正在检测开机自启...",
  "doctor.step.mcp": "正在检测 mcp-proxy-ts...",
  "doctor.step.sessions": "正在检测本地 sessions...",
  "doctor.step.serveSingleton": "正在检测 serve 单例...",
  "doctor.step.uiSingleton": "正在检测 Console 单例...",
  "doctor.fixChecking": "正在检测可自动修复的问题...",
  "doctor.recheck": "正在复检环境...",
  "doctor.checking": "正在检测环境...",
  "doctor.noFixNeeded": "未发现需要自动修复的运行态问题。",
  "doctor.fixInstallAutostart": "正在安装登录自启（KeepAlive）...",
  "doctor.fixInstallAutostartFailed": "[nuwa-cli] 安装登录自启失败：{msg}",
  "doctor.fixStack": "正在修复服务运行态（清理异常进程并重建 Gateway 栈）...",
  "doctor.fixStackFailed": "[nuwa-cli] 服务修复失败。",
  "doctor.fixStackDone":
    "已重建 Gateway 栈（Gateway / file-server / lanproxy）。多余 Console 已清理，需要时请再运行 `nuwa-cli console`。",
  "doctor.fixStackError": "[nuwa-cli] 自动修复服务失败：{msg}",
  "doctor.noEngine": "✖ 没有可用的引擎：claude 和 codex 都未就绪，chat 无法运行。",
  "doctor.summary.requiredFail": "存在阻塞性问题，见上方 ✖ 标记的修复建议。",
  "doctor.summary.coreOk": "核心环境检测通过。",
  "doctor.summary.infoGapSuffix":
    "（部分可选项未配置，见上方 ○ 标记，不影响基本使用）",
  "doctor.summary.allOk": "环境检测全部通过。",
  // —— start / restart (daemon flow) ——
  "common.waitStack": "正在等待 Gateway 栈就绪...",
  "daemon.unknownHost": "未知主机",
  "daemon.unknownPort": "未知端口",
  "start.notLoggedIn": "尚未登录 Nuwax，请先完成登录。",
  "start.loginCancelled": "未完成登录，已取消启动。",
  "start.waitExisting":
    "检测到已有 Gateway（PID {pids}），正在等待 file-server / lanproxy 就绪（最多 {secs}s）...",
  "start.reusing": "Gateway 已在运行（PID {pids}），继续复用。",
  "start.lanproxyReady":
    "lanproxy 运行中（PID {pid}，{host}:{port}），Gateway /health 正常。",
  "start.forceRestartReason":
    "Gateway PID {pids} 存在，但等待超时后子服务（lanproxy/file-server）仍未就绪，正在强制重启 Gateway 以恢复完整运行环境...",
  "daemon.gatewayRestartFailed": "[nuwa-cli] Gateway 重启失败。",
  "start.gatewayStartFailed": "[nuwa-cli] Gateway 启动失败。",
  "start.gatewayStartFailedConsole":
    "[nuwa-cli] Gateway 启动失败，已取消 Console 启动。",
  "start.startingDaemon": "正在启动 Gateway Server（daemon）...",
  "start.startingDaemonForce": "正在强制启动 Gateway Server（daemon）...",
  "start.gatewayReady":
    "Gateway 已就绪。需要 Console 时请运行 `nuwa-cli start --all` 或 `nuwa-cli console`。",
  "start.stackNotReady": "[nuwa-cli] Gateway 栈未就绪，已取消 Console 启动。",
  "start.consoleAlreadyRunning":
    "Console 已在运行（PID {pids}），完整运行环境已就绪。",
  "start.startingConsole": "正在启动前台 Console...",
  "start.startingConsoleForce": "正在强制启动前台 Console...",
  "restart.notLoggedIn":
    "未登录 Nuwax，已跳过服务重启。请先运行 `nuwa-cli login` 登录，再运行 `nuwa-cli gateway` 启动服务。",
  "restart.cleaning": "正在清理所有已运行的 Gateway / Console 进程...",
  "restart.stoppedOld": "已停止 {n} 个旧进程。",
  "restart.noOldProcess": "没有需要清理的旧进程。",
  "restart.restartingGateway": "正在强制重启 Gateway Server...",
  "restart.stackNotReady":
    "[nuwa-cli] Gateway 重启后栈未就绪（exit 1）。请查看 {log} 或运行 `nuwa-cli doctor`。",
  "restart.gatewayRestarted":
    "Gateway 已重启。需要同时重启 Console 时请运行 `nuwa-cli restart --all`。",
  "restart.hintKeepAlive":
    "提示：尚未安装登录自启（KeepAlive）。需要开机自动拉起 Gateway 时请运行 `nuwa-cli service install`（加 `--now` 可立即启动）。",
  "restart.restartingConsole": "正在强制重启前台 Console...",
  // —— login / logout ——
  "login.prompt.domain": "Nuwax 服务器地址：",
  "login.prompt.username": "Nuwax 用户名：",
  "login.prompt.usernameValidate": "请输入用户名",
  "login.prompt.password": "{username}@{domain} 密码：",
  "login.loggedIn": "已登录：{name}（{domain}）",
  "login.failed": "[nuwa-cli] 登录失败：{msg}",
  "login.stoppingForNewCreds": "检测到 Gateway 正在运行，正在停止以应用新登录信息...",
  "login.restartingWithNewCreds": "正在用新登录信息重启 Gateway...",
  "login.autoRestartNoEngine":
    "Gateway 自动重启未成功（不影响登录态，可手动运行 `nuwa-cli gateway`）。",
  "login.autoRestartFailed":
    "Gateway 自动重启失败（不影响登录态，可手动 nuwa-cli gateway）：{msg}",
  "login.installingService": "正在安装系统后台服务（KeepAlive，登录自启）...",
  "logout.done":
    "已退出登录并停止全部服务（savedKey 已保留，下次可免密登录）。",
  // —— status ——
  "common.labelSep": "：",
  "common.unknownValue": "(未知)",
  "status.running": "运行中",
  "status.notRunning": "未运行",
  "status.noInstance": "无运行实例",
  "status.foregroundRunning": "前台运行中",
  "status.onDemand": "（按需启动）",
  "status.pid": "PID {pid}",
  "status.pidPort": "PID {pid}  端口 {port}",
  "status.detailSep": "，",
  "status.autostartEnabledWord": "已启用",
  "status.autostartDisabledWord": "未启用",
  "status.autostartStateUnknown": "状态未知",
  "status.autostartServiceRunning": "服务运行中",
  "status.autostartServiceStopped": "服务未运行",
  "status.autostartDisabled":
    "开机自启：{disabled}（登录后不会自动启动 Gateway，可用 `nuwa-cli service install`）",
  "status.notLoggedInSaved":
    "未登录（savedKey 已保存，运行 `nuwa-cli login` 免密重新登录）。",
  "status.notLoggedInNone":
    "未登录。运行 `nuwa-cli login --domain <host> --saved-key <key>` 登录。",
  "status.savedKeySaved": "savedKey：已保存",
  "status.lastReg": "上次注册：{value}",
  "status.remoteValid": "远程校验：savedKey 有效。",
  "status.remoteFailed": "远程校验失败：{msg}",
  // —— service manager ——
  "service.method.system": "系统启动项",
  "service.method.startupFolder": "启动文件夹",
  "service.method.taskScheduler": "计划任务",
  "service.method.taskSchedulerNamed": "计划任务（{task}）",
  "service.summary.disabled":
    "未启用（登录后不会自动启动 Gateway，可用 `nuwa-cli service install`）",
  "service.runFailed": "{cmd} 执行失败：{msg}",
  "service.runExitCode": "{cmd} 退出码 {status}：{output}",
  "service.unsupportedPlatform": "暂不支持当前平台：{platform}",
  "service.notInstalled": "尚未安装服务。",
  "service.noCliEntry": "无法定位当前 nuwa-cli CLI 入口文件。",
  "service.noUid": "当前 Node 运行时无法获取用户 UID。",
  "service.noAppdata":
    "无法定位 Windows 启动文件夹：APPDATA 环境变量未设置。",
  "service.schtasksDenied":
    "Windows 计划任务创建被拒绝（常见原因：杀毒/EDR 拦截了 schtasks.exe，或需要管理员权限）。可改用「以管理员身份运行的终端」重试 nuwa-cli service install，或在杀毒软件中放行 schtasks.exe。",
  "service.schtasksFallback":
    "计划任务创建被拒（{reason}），已改用「启动文件夹」自启：{vbsPath}",
  "service.startupFolderDetail":
    "启动文件夹自启（用户登录时静默启动 gateway）",
  // —— service command ——
  "service.install.installedNow": "Gateway 后台服务已安装并启动。",
  "service.install.installedLater":
    "Gateway 后台服务已安装，将在下次用户登录时自动启动。",
  "service.install.failed": "[nuwa-cli] 安装后台服务失败：{msg}",
  "service.install.failedHint":
    "（后台服务用于开机/登录自启动；此步骤失败不影响登录态，可手动运行 nuwa-cli serve 启动 Gateway。）",
  "service.start.done": "Gateway 后台服务已启动。",
  "service.start.failed": "[nuwa-cli] 启动后台服务失败：{msg}",
  "service.stop.done": "Gateway 后台服务已停止。",
  "service.stop.failed": "[nuwa-cli] 停止后台服务失败：{msg}",
  "service.uninstall.done": "Gateway 后台服务已卸载。",
  "service.uninstall.failed": "[nuwa-cli] 卸载后台服务失败：{msg}",
  "service.status.failed": "[nuwa-cli] 查看后台服务失败：{msg}",
  "service.requireAccount":
    "未找到可用于启动的默认账号。请先运行 `nuwa-cli login --domain <host> --saved-key <key>`，或 `nuwa-cli gateway --domain <host> -u <username>` 成功注册一次。",
  "service.note.macos":
    "macOS 使用当前用户 LaunchAgent：用户登录后自动启动；未登录前不会运行。",
  "service.note.linux":
    "Linux 使用 systemd user service：默认用户登录后启动；如需未登录也随系统启动，请在系统上启用 linger（例如 `loginctl enable-linger $USER`，可能需要管理员权限）。",
  "service.note.windows":
    "Windows 使用当前用户计划任务：用户登录时自动启动；不需要把密码写入计划任务。若计划任务被杀软/EDR 拦截，会自动改用「启动文件夹」自启。",
  "service.status.installedWord": "已安装",
  "service.status.notInstalledWord": "未安装",
  "service.status.activeUnknown": "未知",
  "service.status.activeRunning": "运行中",
  "service.status.activeStopped": "未运行",
  "service.status.line": "系统启动项：{installed}，{active}",
  "service.status.configPath": "配置文件：{path}",
  "service.status.taskNameLine": "计划任务：{name}",
  "service.status.autostartMethodLine": "自启方式：{method}",
  "service.status.consoleRunning": "Console：前台运行中（pid {pids}）",
  "service.status.consoleIdle":
    "Console：未运行（Console 不由系统后台服务管理）",
  "service.status.detailsHeader": "\n系统状态详情：",
};
