/**
 * 英文文案包(base / source of truth / 默认语言)。
 *
 * key 集是权威:zh-CN.ts 用 `{ [K in keyof typeof en]: string }` 约束,
 * 缺 key 会**编译报错**(比运行时一致性测试更强)。新增文案时先在此加 key,
 * 再在 zh-CN.ts 补对应中文。命名空间用 flat 点分(common.* / cli.* / doctor.* ...)。
 */
export const en = {
  // —— common ——
  "common.tag": "[nuwa-cli]",
  "common.cancelled": "Cancelled.",
  "common.signal": "signal",
  "common.shuttingDown": "\n[nuwa-cli] received {signal}, shutting down...",
  // —— lang 命令 ——
  "lang.current": "Current language: {lang}",
  "lang.resolved": "Resolved from: {source}",
  "lang.sourceEnv": "NUWACLI_LANG env",
  "lang.sourceConfig": "config (~/.nuwa-cli/config.json)",
  "lang.sourceDetect": "auto-detected from system locale",
  "lang.sourceDefault": "default",
  "lang.set": "Language set to {lang}.",
  "lang.setAuto": "Language set to auto (will detect from system locale).",
  "lang.badCode": "Unsupported language code: {code}. Supported: en, zh-CN, auto.",
  "lang.hint": "Override temporarily with NUWACLI_LANG=en|zh-CN.",
  // —— cli: top-level ——
  "cli.description":
    "Headless multi-engine agent CLI — attaches to your already-installed claude/codex CLIs over ACP, with a managed Gateway, Console, and remote session routing",
  // —— cli: shared login options ——
  "cli.login.opt.domain":
    "Nuwax server address; uses the current default domain if omitted",
  "cli.login.opt.savedKey":
    "Existing savedKey; saved as the current account and added to the multi-account JSON map",
  "cli.login.opt.username":
    "Account name; reuses savedKey for an existing domain+username, password is used only for this request",
  "cli.login.help.block":
    "\nNotes:\n  - No SQLite; credentials are stored in ~/.nuwa-cli/credentials.json.\n  - Logging in again with the same domain+username reuses the saved savedKey to avoid the backend creating a new computer.\n  - Without --domain / -u, the current default account's savedKey is used to re-register without a password.",
  // —— cli: model overlay ——
  "cli.opt.apiKey": "Override the model API key",
  "cli.opt.baseUrl": "Override the model API base URL",
  "cli.opt.model": "Override the model name",
  // —— cli: ui (console) ——
  "cli.ui.opt.port":
    "Console listen port; finds the next available port if busy",
  "cli.ui.opt.host": "Console listen address (127.0.0.1 recommended)",
  "cli.ui.opt.engine":
    "Default engine: claude or codex (still switchable in the UI)",
  "cli.ui.opt.cwd":
    "Default working directory for new sessions; uses the default workspace if omitted",
  "cli.ui.opt.approve":
    "Permission policy: auto (default, auto-approve) / ask (approve each) / deny",
  "cli.ui.opt.force":
    "If an existing Console is found, stop the old foreground instance before starting",
  "cli.ui.opt.noOpen": "Do not auto-open the browser after start",
  // —— cli: serve / service shared ——
  "cli.serve.opt.port":
    "Preferred HTTP API listen port; finds the next available port if busy",
  "cli.serve.opt.host": "HTTP API listen address",
  "cli.serve.opt.cwd":
    "Current project directory; auto-created under ~/.nuwa-cli/workspaces/<project_id> if omitted",
  "cli.serve.opt.approve":
    "Permission policy: auto (default; ordinary tools auto-approved, sensitive access still requires approval), ask (all manual), or deny",
  "cli.serve.opt.lanproxyPath":
    "Override the npm platform package: specify the lanproxy binary or Electron resources directory",
  "cli.serve.opt.lanproxyHost": "Override the registered lanproxy serverHost",
  "cli.serve.opt.lanproxyPort": "Override the registered lanproxy serverPort",
  "cli.serve.opt.lanproxySsl": "Whether lanproxy enables ssl",
  "cli.serve.opt.daemon":
    "Run in the background (stdout/stderr to the daily-rotated serve.<date>.log under ~/.nuwa-cli/logs/)",
  "cli.serve.opt.force":
    "If an existing Gateway/serve is found, stop the old instance before starting",
  "cli.service.opt.engine":
    "Engine used when the service starts: claude or codex; auto-detected by the Gateway if omitted",
  "cli.service.opt.now": "Start the service immediately after install",
  // —— cli: shared option fragments ——
  "cli.opt.jsonArray": "Output as a JSON array",
  "cli.opt.json": "Output as JSON",
  "cli.opt.jsonOnly": "Output as JSON (currently the only format)",
  "cli.opt.engineFilter": "Filter to one engine: claude or codex",
  "cli.opt.ref": "Context reference, e.g. claude:xxxx",
  "cli.opt.limitMsgs": "Return only the last N messages",
  "cli.cmd.engineDefault": "Default engine for the Gateway/Console: claude or codex",
  "cli.cmd.enginePick": "Engine to use: claude or codex",
  // —— service commands ——
  "cli.cmd.start.desc":
    "Start the Gateway (daemon); with --all also starts a foreground Console",
  "cli.cmd.start.opt.all": "Start both the Gateway and a foreground Console",
  "cli.cmd.start.opt.cwd":
    "Working directory used by the Gateway and Console",
  "cli.cmd.start.opt.approve":
    "Permission policy: auto (default) / ask (approve each) / deny",
  "cli.cmd.start.opt.force":
    "Force-replace existing instances (Gateway only by default; includes Console with --all)",
  "cli.cmd.start.opt.noOpen":
    "Only with --all: do not auto-open the browser after the Console starts",
  "cli.cmd.start.help":
    "\nNotes:\n  - By default only starts/reuses the Gateway (daemon); the current terminal is not occupied.\n  - `--all` additionally starts a foreground Console; you can also run `nuwa-cli console` separately.\n  - When not logged in, an interactive login flow runs first and start continues after success.\n  - Healthy instances are reused and only missing services are filled in; --force force-replaces them.\n  - With --all the Console occupies the current terminal; Ctrl+C only closes the Console, the Gateway keeps running.",
  "cli.cmd.restart.desc":
    "Force-restart the Gateway (daemon); with --all also restarts a foreground Console",
  "cli.cmd.restart.opt.all":
    "Force-restart both the Gateway and a foreground Console",
  "cli.cmd.restart.help":
    "\nNotes:\n  - By default only force-restarts the Gateway (gateway --daemon --force).\n  - `--all` additionally force-restarts the foreground Console.\n  - With --all the Console occupies the current terminal; Ctrl+C closes the Console.\n  - If the Gateway restart fails, the Console is not restarted.",
  "cli.cmd.stop.desc":
    "Stop the Gateway or Console; defaults to Gateway only when no scope is given",
  "cli.cmd.stop.opt.all": "Stop both the Gateway and Console",
  "cli.cmd.stop.opt.gateway": "Stop only the Gateway",
  "cli.cmd.stop.opt.console": "Stop only the Console",
  "cli.cmd.stop.help":
    "\nNotes:\n  - By default only stops the Gateway (including the associated tunnel/lanproxy).\n  - `--all` also stops the foreground Console.",
  "cli.cmd.serve.desc":
    "Start the local HTTP API (chat + SSE) for script/cloud/IM remote scheduling",
  "cli.cmd.serve.opt.tunnel":
    "After login, start the local nuwax-file-server and lanproxy tunnel",
  "cli.cmd.gateway.desc":
    "Start the Gateway Server: detect the engine, login/register, and run serve --tunnel",
  "cli.cmd.gateway.opt.engine":
    "Engine to use: claude or codex; auto-selected if omitted",
  "cli.cmd.gateway.help":
    "\nNotes:\n  - Without --domain / -u / --saved-key, the current default account's savedKey is used to register without a password.\n  - With -u, if a savedKey for the same domain+username exists in credentials.json, it is submitted with the register request to avoid creating a new computer.\n  - The password is entered interactively; in CI use NUWACLI_PASSWORD, which is never passed to the engine/lanproxy/file-server.\n  - Without --engine, claude/codex is auto-detected; when multiple are available one is chosen at random.",
  "cli.cmd.service.desc":
    "Manage the Gateway's persistent background service and boot/login auto-start (does not manage the Console)",
  "cli.cmd.service.install.desc":
    "Install the current user's background service; starts on next login by default, or immediately with --now",
  "cli.cmd.service.install.help":
    "\nNotes:\n  - Requires an existing CLI default account: run `nuwa-cli login` or `nuwa-cli gateway` successfully once first.\n  - The startup entry never stores passwords, savedKey, configKey, or model API keys; login state is still read from ~/.nuwa-cli/credentials.json.\n  - macOS uses a LaunchAgent, Linux a systemd user service, Windows a per-user scheduled task.\n  - On Linux it starts after user login by default; to start without login, enable linger on the system.",
  "cli.cmd.service.start.desc": "Start the installed background service",
  "cli.cmd.service.stop.desc": "Stop the installed background service",
  "cli.cmd.service.status.desc":
    "Show the system startup entry and the current serve run state",
  "cli.cmd.service.uninstall.desc":
    "Stop and remove the background service / startup entry",
  // —— agent commands ——
  "cli.cmd.ps.desc":
    "List running Gateway, Console, and chat processes",
  "cli.cmd.doctor.desc":
    "Check environment, login state, and Gateway/lanproxy run state; with --fix auto-resolves fixable issues",
  "cli.cmd.doctor.opt.fix":
    "Auto-fix by check results: install login auto-start, clean up duplicate instances, rebuild a broken Gateway/lanproxy stack",
  "cli.cmd.chat.desc":
    "Chat with the locally-logged-in claude/codex (reuses its login state and local config)",
  "cli.cmd.chat.opt.cwd": "Working directory",
  "cli.cmd.chat.opt.print":
    "One-shot mode: send a single prompt and exit",
  "cli.cmd.chat.opt.yolo":
    "Auto-approve all tool calls (dangerous; use with caution)",
  "cli.cmd.chat.opt.mode":
    "Set the engine session mode (e.g. acceptEdits/bypassPermissions; engine-specific)",
  "cli.cmd.chat.opt.resume":
    "Resume a local history session; interactively choose when no id is given",
  "cli.cmd.chat.opt.refSession":
    "Reference another engine's history session as context (e.g. claude:xxxx); not a real resume — only reminds the model on the first turn to run `sessions summary` as needed",
  "cli.cmd.chat.opt.autoDigest":
    "With --ref-session, auto-read the digest and inject it on the first turn (by default only prompts the model to query)",
  "cli.cmd.chat.opt.handoff":
    "Build a structured handoff bundle from another local session and inject it on the first turn of a new ACP session",
  "cli.cmd.sessions.desc": "List local claude/codex session history",
  "cli.cmd.sessions.opt.search":
    "Fuzzy-search by title, sessionId, or path",
  "cli.cmd.sessions.opt.days": "Only sessions from the last N days",
  "cli.cmd.sessions.opt.since":
    "Only sessions after this date (ISO, e.g. 2026-07-01)",
  "cli.cmd.sessions.opt.until": "Only sessions before this date",
  "cli.cmd.sessions.opt.limit": "Return at most N sessions",
  "cli.cmd.sessions.opt.verbose": "Show more detail",
  "cli.cmd.sessions.summary.desc":
    "Print a compact JSON digest of a local session (for an agent to read another engine's history on demand; see chat --ref-session)",
  "cli.cmd.sessions.summary.opt.engine":
    "Engine the session belongs to: claude or codex",
  "cli.cmd.sessions.summary.opt.sessionId": "Session ID",
  "cli.cmd.sessions.summary.opt.limit": "Return only the last N messages",
  "cli.cmd.sessions.summary.opt.offset":
    "Skip the first N messages (paginates with --limit)",
  "cli.cmd.sessions.summary.opt.format":
    "Output format: json (default) or jsonl",
  "cli.cmd.sessions.summary.opt.reverse":
    "Output in reverse chronological order (newest first)",
  "cli.cmd.workspaces.desc":
    "List local workspace directories (files generated by cloud sessions, under ~/.nuwa-cli/workspaces)",
  "cli.cmd.workspaces.opt.user": "Only projects under a given user id",
  "cli.cmd.workspaces.opt.long": "List the file tree inside each project",
  // —— cloud commands ——
  "cli.cmd.login.desc":
    "Log in to a Nuwax cloud account; uses the current default account when domain/username are omitted",
  "cli.cmd.logout.desc":
    "Log out (keeps savedKey, so you can log back in without a password)",
  "cli.cmd.status.desc":
    "Show the Nuwax login state and the Gateway/Console run state",
  "cli.cmd.status.opt.remote":
    "Additionally verify with the server whether savedKey is still valid",
  "cli.cmd.config.desc":
    "View/change the current default account config (use the account command for multiple accounts)",
  "cli.cmd.config.get.desc":
    "View a config key, or list all when the key is omitted",
  "cli.cmd.config.set.desc":
    "Set a config key (domain/saved-key/username/lanproxy-path)",
  "cli.cmd.account.desc":
    "Manage multiple Nuwax accounts saved in credentials.json (lightweight JSON, no SQLite)",
  "cli.cmd.account.list.desc":
    "List saved accounts and mark the current default with *",
  "cli.cmd.account.switch.desc":
    "Switch the current default account; refused while serve is running — Ctrl-C the service first",
  "cli.cmd.account.switch.help":
    "\nArgs:\n  account  a key from `nuwa-cli account list`, e.g. testagent.xspaceagi.com_18011447397;\n           a unique username is also accepted.\n\nNotes:\n  Switching re-registers the current account and requires restarting serve/file-server/lanproxy.\n  If the Gateway is running, this command refuses to run; run `nuwa-cli stop --all` first.",
  // —— context commands ——
  "cli.cmd.context.desc":
    "Cross-agent context reference and handoff (a read-only helper layer on top of ACP sessions)",
  "cli.cmd.context.list.desc": "List locally referenceable contexts",
  "cli.cmd.context.read.desc":
    "Read the normalized message-stream JSON of a local session",
  "cli.cmd.context.digest.desc":
    "Print a rule-based compressed digest JSON of a local session",
  "cli.cmd.context.digest.opt.limit":
    "Read at most the last N messages for the digest",
  "cli.cmd.context.handoff.desc":
    "Print a structured handoff-bundle JSON suitable for another agent to take over",
  "cli.cmd.context.handoff.opt.limit":
    "Read at most the last N messages for the handoff bundle",
  // —— update / console ——
  "cli.cmd.update.desc":
    "Upgrade the nuwa-cli CLI (currently follows the beta channel by default)",
  "cli.cmd.update.opt.check": "Only query the target version; do not install",
  "cli.cmd.update.opt.dryRun":
    "Print the upgrade command without running it",
  "cli.cmd.update.opt.registry": "Specify the npm registry",
  "cli.cmd.update.help":
    "\nExamples:\n  nuwa-cli update\n  nuwa-cli update 0.1.0-beta.2\n  nuwa-cli update latest\n  nuwa-cli update --check\n\nNotes:\n  - update uses npm to upgrade the global CLI package; it does not modify ~/.nuwa-cli login data.\n  - During the pre-release phase it follows beta by default; you can pass an explicit version or the latest tag.\n  - When running via npx, prefer npx -y @nuwax-ai/nuwa-cli@beta ... directly.",
  "cli.cmd.console.desc":
    "Start the local Web Console: view/resume/create sessions and chat directly (foreground single-instance only)",
  // —— update ——
  "update.emptyTarget":
    "Upgrade target cannot be empty. Example: nuwa-cli update beta or nuwa-cli update 0.1.0-beta.2",
  "update.noNpm": "npm not found. Please install Node.js/npm first and retry.",
  "update.queryFailed": "Failed to query the npm version.",
  "update.currentVersion": "Current version: {version}",
  "update.targetSpec": "{spec}: {version}",
  "update.alreadyTarget": "Already the target version.",
  "update.canUpgrade": "Can upgrade: {from} -> {to}",
  "update.targetVersion": "Target version: {version}",
  "update.upgradeTarget": "Upgrade target: {spec}",
  "update.execute": "Run: {cmd}",
  "update.step1": "Step 1/4: Checking target version...",
  "update.alreadyLatest": "Already the latest version; no reinstall needed.",
  "update.step2": "Step 2/4: Stopping running services to release upgrade files...",
  "update.stopped": "Stopped running services.",
  "update.step3": "Step 3/4: Installing ",
  "update.installDone": "Installation complete.",
  "update.doneHint":
    "Upgrade complete. Re-run `nuwa-cli --version` to confirm the version the current shell resolves to.",
  "update.step4": "Step 4/4: Restarting services (if logged in)...",
  "update.notLoggedIn":
    "Not logged in to Nuwax; skipped auto-restart after upgrade. Run `nuwa-cli login` first, then `nuwa-cli gateway` to start services.",
  "update.restarted":
    "Logged in; all services restarted (the Gateway is bringing up sub-services in the background).",
  "update.restartMaybeFailed":
    "serve auto-restart may be incomplete (restart exit code {code}). Run `nuwa-cli gateway` manually.",
  "update.restartSkipped": "serve auto-restart skipped: {msg}",
  // —— config ——
  "config.domain": "Domain: {value}",
  "config.username": "Username: {value}",
  "config.computerName": "Computer name: {value}",
  "config.accounts": "Accounts: {n}",
  "config.savedKey": "savedKey: {state}",
  "config.lanproxyPath": "lanproxy path: {value}",
  "config.stateSet": "(set)",
  "config.stateUnset": "(not set)",
  "config.unknownKey":
    "[nuwa-cli] Unknown config key \"{key}\". Available: {keys}.",
  "config.updated": "Updated {key}.",
  // —— processes / ps / stop ——
  "processes.none": "No running nuwa-cli processes found.",
  "processes.header": "PID\tType\tState\tMode\tAddress\tStarted",
  "processes.label.gateway": "Gateway",
  "processes.label.console": "Console",
  "processes.label.lanproxy": "lanproxy",
  "processes.label.chat": "chat",
  "processes.label.fileServer": "file-server",
  "processes.state.running": "running",
  "processes.state.starting": "starting",
  "processes.mode.legacy": "legacy",
  "processes.mode.daemon": "daemon",
  "processes.mode.foreground": "foreground",
  "processes.stoppedGateway": "Stopped Gateway (PID {pids}).",
  "processes.stoppedConsole": "Stopped Console (PID {pids}).",
  "processes.noneInRange": "No running services found in the selected scope.",
  "processes.stopFailed": "[nuwa-cli] Failed to stop services: {msg}",
  // —— gateway ——
  "gateway.engineSelected": "Engine selected: {engine}",
  "gateway.engineAvailable": "Engine selected: {engine} (available: {available})",
  "gateway.failed": "[nuwa-cli] gateway failed: {msg}",
  "gateway.firstStartHint":
    "First start requires --domain <host> --saved-key <key> or --domain <host> -u <username>, or run `nuwa-cli login` first.",
  // —— doctor ——
  "doctor.detailSep": "; ",
  "doctor.label.tcc": "macOS permissions (TCC)",
  "doctor.label.login": "Nuwax cloud account",
  "doctor.label.computer": "My computer",
  "doctor.label.sessions": "Local session history",
  "doctor.label.autostart": "Boot auto-start",
  "doctor.label.serveSingleton": "serve singleton",
  "doctor.label.uiSingleton": "Console singleton",
  "doctor.node.detailFail": "v{version} (requires >= 22)",
  "doctor.node.fix": "Install Node.js 22 or later: https://nodejs.org",
  "doctor.claude.detailCliVer":
    "Runtime available; local CLI: {bin} ({ver})",
  "doctor.claude.detailCli": "Runtime available; local CLI: {bin}",
  "doctor.claude.detailBuiltin":
    "Built-in runtime available ({arg}); local CLI not installed, local history/config may be empty — configure via ACP",
  "doctor.fix.reinstall": "Reinstall nuwa-cli (do not use --omit=optional)",
  "doctor.codex.detailRuntime": "Runtime available ({arg})",
  "doctor.codex.detailCliVer": "local CLI: {bin} ({ver})",
  "doctor.codex.detailCli": "local CLI: {bin}",
  "doctor.codex.detailNoCli": "local CLI not installed",
  "doctor.codex.detailIsolated":
    "running in isolation mode (auth via ACP/env, does not reuse ~/.codex)",
  "doctor.codex.detailHasAuth": "local login/config detected",
  "doctor.codex.detailNoAuth":
    "no local login/config; local history and model hints may be empty — configure via ACP",
  "doctor.uv.detailMissing":
    "Not found on PATH (optional; some MCP dependencies require it)",
  "doctor.uv.fix":
    "Install uv: https://docs.astral.sh/uv/getting-started/installation/",
  "doctor.tcc.detailRisky":
    "The current directory {cwd} is in a system-protected scope; child processes may crash due to insufficient permissions",
  "doctor.tcc.detailOk": "No known TCC risk in the current directory",
  "doctor.tcc.fix":
    "Grant the terminal Full Disk Access to this directory under System Settings → Privacy & Security, or switch to a non-protected directory",
  "doctor.login.detailNotLoggedIn": "Not logged in",
  "doctor.login.detailOk": "Logged in ({domain})",
  "doctor.login.domainUnknown": "unknown domain",
  "doctor.login.detailSavedKey":
    "Not logged in (savedKey saved; you can log back in without a password)",
  "doctor.login.detailCredNoLogin":
    "Credentials file exists but not logged in",
  "doctor.login.detailCorrupt": "Credentials file corrupted",
  "doctor.login.fixLogin":
    "Run `nuwa-cli login` to log in without a password",
  "doctor.login.fixHint":
    "Run `nuwa-cli login --domain <host> --saved-key <key>` to log in",
  "doctor.login.fixRelogin": "Run `nuwa-cli login` to log in again",
  "doctor.computer.detailUnset":
    "Not registered yet; a computer name is assigned by Nuwax after login",
  "doctor.lanproxy.fixReinstall":
    "Reinstall nuwa-cli (do not use --omit=optional) and ensure the current npm source has synced the platform package",
  "doctor.lanproxy.healthNoResp": "not responding",
  "doctor.lanproxy.healthDown": "unavailable",
  "doctor.lanproxy.detailRunningUnhealthy":
    "Process running (PID {pids}), but Gateway /health {state}; binary: {bin}",
  "doctor.lanproxy.detailGatewayOkNoLanproxy":
    "Gateway /health is OK, but no lanproxy process detected; binary: {bin}",
  "doctor.lanproxy.fixRebuildGw":
    "Run `nuwa-cli doctor --fix` to rebuild Gateway/lanproxy; and check {log}",
  "doctor.lanproxy.fixRebuildTunnel":
    "Run `nuwa-cli doctor --fix` to rebuild the cloud tunnel; and check {log}",
  "doctor.lanproxy.detailRunningOk":
    "Running (PID {pids}), Gateway /health OK; binary: {bin}",
  "doctor.lanproxy.detailInstalledNotRunning":
    "Installed, not currently running; binary: {bin}",
  "doctor.sessions.detail":
    "claude: {claude} sessions, codex: {codex} sessions",
  "doctor.autostart.fix":
    "Run `nuwa-cli doctor --fix` to install login auto-start; you can also run `nuwa-cli service install` (`--now` to start immediately); uninstall with `nuwa-cli service uninstall`",
  "doctor.serveSingleton.detailNone": "Not running (singleton state OK)",
  "doctor.serveSingleton.detailOne": "Running (PID {pid})",
  "doctor.serveSingleton.detailMany":
    "Detected {n} instances (PID {pids})",
  "doctor.serveSingleton.fix":
    "Run `nuwa-cli doctor --fix` to clean up extra instances and rebuild the Gateway stack",
  "doctor.uiSingleton.detailNone": "Not running (singleton state OK)",
  "doctor.uiSingleton.detailOne": "Foreground running (PID {pid})",
  "doctor.uiSingleton.detailMany":
    "Detected {n} foreground instances (PID {pids})",
  "doctor.uiSingleton.fix":
    "Run `nuwa-cli doctor --fix` to clean up extra Console instances (foreground is not auto-reopened; run `nuwa-cli console` if needed)",
  "doctor.mcp.detailOk": "Resolved {path}",
  "doctor.mcp.detailMissing":
    "@nuwax-ai/mcp-proxy-ts entry (dist/index.js) not found",
  "doctor.mcp.fix":
    "Ensure the dependency is installed: npm install @nuwax-ai/mcp-proxy-ts",
  "doctor.step.node": "Checking Node.js version...",
  "doctor.step.claude": "Checking claude CLI...",
  "doctor.step.codex": "Checking codex CLI...",
  "doctor.step.uv": "Checking uv...",
  "doctor.step.tcc": "Checking TCC permissions (macOS)...",
  "doctor.step.login": "Checking Nuwax login...",
  "doctor.step.computer": "Checking Nuwax computer registration...",
  "doctor.step.lanproxy": "Checking lanproxy / cloud tunnel...",
  "doctor.step.autostart": "Checking boot auto-start...",
  "doctor.step.mcp": "Checking mcp-proxy-ts...",
  "doctor.step.sessions": "Checking local sessions...",
  "doctor.step.serveSingleton": "Checking serve singleton...",
  "doctor.step.uiSingleton": "Checking Console singleton...",
  "doctor.fixChecking": "Checking for auto-fixable issues...",
  "doctor.recheck": "Re-checking environment...",
  "doctor.checking": "Checking environment...",
  "doctor.noFixNeeded": "No runtime issues found that need auto-fixing.",
  "doctor.fixInstallAutostart": "Installing login auto-start (KeepAlive)...",
  "doctor.fixInstallAutostartFailed":
    "[nuwa-cli] Failed to install login auto-start: {msg}",
  "doctor.fixStack":
    "Fixing service runtime state (cleaning abnormal processes and rebuilding the Gateway stack)...",
  "doctor.fixStackFailed": "[nuwa-cli] Service fix failed.",
  "doctor.fixStackDone":
    "Rebuilt the Gateway stack (Gateway / file-server / lanproxy). Extra Console instances cleaned up; run `nuwa-cli console` if needed.",
  "doctor.fixStackError": "[nuwa-cli] Failed to auto-fix services: {msg}",
  "doctor.noEngine":
    "✖ No engine available: neither claude nor codex is ready, chat cannot run.",
  "doctor.summary.requiredFail":
    "Blocking issues found — see the ✖ fix suggestions above.",
  "doctor.summary.coreOk": "Core environment checks passed.",
  "doctor.summary.infoGapSuffix":
    " (some optional items are unconfigured — see the ○ marks above; does not affect basic use)",
  "doctor.summary.allOk": "All environment checks passed.",
  // —— start / restart (daemon flow) ——
  "common.waitStack": "Waiting for the Gateway stack to be ready...",
  "daemon.unknownHost": "unknown host",
  "daemon.unknownPort": "unknown port",
  "start.notLoggedIn": "Not logged in to Nuwax yet; please log in first.",
  "start.loginCancelled": "Login not completed; start cancelled.",
  "start.waitExisting":
    "Found an existing Gateway (PID {pids}); waiting for file-server / lanproxy to be ready (up to {secs}s)...",
  "start.reusing": "Gateway already running (PID {pids}); reusing it.",
  "start.lanproxyReady":
    "lanproxy running (PID {pid}, {host}:{port}), Gateway /health OK.",
  "start.forceRestartReason":
    "Gateway PID {pids} exists, but sub-services (lanproxy/file-server) are still not ready after the wait timeout; force-restarting the Gateway to restore a full runtime...",
  "daemon.gatewayRestartFailed": "[nuwa-cli] Gateway restart failed.",
  "start.gatewayStartFailed": "[nuwa-cli] Gateway failed to start.",
  "start.gatewayStartFailedConsole":
    "[nuwa-cli] Gateway failed to start; Console start cancelled.",
  "start.startingDaemon": "Starting the Gateway Server (daemon)...",
  "start.startingDaemonForce": "Force-starting the Gateway Server (daemon)...",
  "start.gatewayReady":
    "Gateway is ready. Run `nuwa-cli start --all` or `nuwa-cli console` when you need the Console.",
  "start.stackNotReady":
    "[nuwa-cli] Gateway stack is not ready; Console start cancelled.",
  "start.consoleAlreadyRunning":
    "Console already running (PID {pids}); the full runtime is ready.",
  "start.startingConsole": "Starting the foreground Console...",
  "start.startingConsoleForce": "Force-starting the foreground Console...",
  "restart.notLoggedIn":
    "Not logged in to Nuwax; service restart skipped. Run `nuwa-cli login` first, then `nuwa-cli gateway` to start services.",
  "restart.cleaning": "Cleaning all running Gateway / Console processes...",
  "restart.stoppedOld": "Stopped {n} old process(es).",
  "restart.noOldProcess": "No old processes to clean.",
  "restart.restartingGateway": "Force-restarting the Gateway Server...",
  "restart.stackNotReady":
    "[nuwa-cli] Gateway stack is not ready after restart (exit 1). Check {log} or run `nuwa-cli doctor`.",
  "restart.gatewayRestarted":
    "Gateway restarted. Run `nuwa-cli restart --all` to also restart the Console.",
  "restart.hintKeepAlive":
    "Hint: login auto-start (KeepAlive) is not installed. Run `nuwa-cli service install` (add `--now` to start immediately) if you want the Gateway to auto-start on boot.",
  "restart.restartingConsole": "Force-restarting the foreground Console...",
  // —— login / logout ——
  "login.prompt.domain": "Nuwax server address:",
  "login.prompt.username": "Nuwax username:",
  "login.prompt.usernameValidate": "Please enter a username",
  "login.prompt.password": "{username}@{domain} password:",
  "login.loggedIn": "Logged in: {name} ({domain})",
  "login.failed": "[nuwa-cli] Login failed: {msg}",
  "login.stoppingForNewCreds":
    "Gateway is running; stopping it to apply the new login...",
  "login.restartingWithNewCreds":
    "Restarting the Gateway with the new login...",
  "login.autoRestartNoEngine":
    "Gateway auto-restart did not succeed (login state is unaffected; run `nuwa-cli gateway` manually).",
  "login.autoRestartFailed":
    "Gateway auto-restart failed (login state is unaffected; run `nuwa-cli gateway` manually): {msg}",
  "login.installingService":
    "Installing the system background service (KeepAlive, login auto-start)...",
  "logout.done":
    "Logged out and stopped all services (savedKey kept; you can log back in without a password).",
  // —— status ——
  "common.labelSep": ":",
  "common.unknownValue": "(unknown)",
  "status.running": "running",
  "status.notRunning": "not running",
  "status.noInstance": "no running instance",
  "status.foregroundRunning": "foreground running",
  "status.onDemand": " (on demand)",
  "status.pid": "PID {pid}",
  "status.pidPort": "PID {pid}  port {port}",
  "status.detailSep": ", ",
  "status.autostartEnabledWord": "enabled",
  "status.autostartDisabledWord": "disabled",
  "status.autostartStateUnknown": "state unknown",
  "status.autostartServiceRunning": "service running",
  "status.autostartServiceStopped": "service stopped",
  "status.autostartDisabled":
    "Boot auto-start: {disabled} (the Gateway will not auto-start after login; run `nuwa-cli service install`)",
  "status.notLoggedInSaved":
    "Not logged in (savedKey saved; run `nuwa-cli login` to log back in without a password).",
  "status.notLoggedInNone":
    "Not logged in. Run `nuwa-cli login --domain <host> --saved-key <key>` to log in.",
  "status.savedKeySaved": "savedKey: saved",
  "status.lastReg": "Last registered: {value}",
  "status.remoteValid": "Remote check: savedKey is valid.",
  "status.remoteFailed": "Remote check failed: {msg}",
  // —— service manager ——
  "service.method.system": "system startup entry",
  "service.method.startupFolder": "startup folder",
  "service.method.taskScheduler": "scheduled task",
  "service.method.taskSchedulerNamed": "scheduled task ({task})",
  "service.summary.disabled":
    "disabled (the Gateway will not auto-start after login; run `nuwa-cli service install`)",
  "service.runFailed": "{cmd} failed: {msg}",
  "service.runExitCode": "{cmd} exit code {status}: {output}",
  "service.unsupportedPlatform":
    "Current platform is not supported: {platform}",
  "service.notInstalled": "The service is not installed.",
  "service.noCliEntry": "Cannot locate the current nuwa-cli CLI entry file.",
  "service.noUid": "Cannot get the user UID in the current Node runtime.",
  "service.noAppdata":
    "Cannot locate the Windows Startup folder: the APPDATA environment variable is not set.",
  "service.schtasksDenied":
    "Windows scheduled-task creation was refused (common causes: antivirus/EDR blocked schtasks.exe, or administrator privileges are required). Retry `nuwa-cli service install` in a terminal run as administrator, or allow schtasks.exe in your antivirus.",
  "service.schtasksFallback":
    "Scheduled-task creation refused ({reason}); fell back to the Startup folder: {vbsPath}",
  "service.startupFolderDetail":
    "Startup folder auto-start (silently starts the gateway at user logon)",
  // —— service command ——
  "service.install.installedNow": "Gateway background service installed and started.",
  "service.install.installedLater":
    "Gateway background service installed; it will auto-start on the next user login.",
  "service.install.failed": "[nuwa-cli] Failed to install the background service: {msg}",
  "service.install.failedHint":
    " (the background service provides boot/login auto-start; this failure does not affect login state — you can run `nuwa-cli serve` manually to start the Gateway.)",
  "service.start.done": "Gateway background service started.",
  "service.start.failed": "[nuwa-cli] Failed to start the background service: {msg}",
  "service.stop.done": "Gateway background service stopped.",
  "service.stop.failed": "[nuwa-cli] Failed to stop the background service: {msg}",
  "service.uninstall.done": "Gateway background service uninstalled.",
  "service.uninstall.failed":
    "[nuwa-cli] Failed to uninstall the background service: {msg}",
  "service.status.failed": "[nuwa-cli] Failed to inspect the background service: {msg}",
  "service.requireAccount":
    "No usable default account found. Run `nuwa-cli login --domain <host> --saved-key <key>` first, or `nuwa-cli gateway --domain <host> -u <username>` to register once.",
  "service.note.macos":
    "macOS uses the current user's LaunchAgent: it auto-starts after the user logs in; it will not run before login.",
  "service.note.linux":
    "Linux uses a systemd user service: it starts after the user logs in by default; to also start it before login, enable linger on the system (e.g. `loginctl enable-linger $USER`, may require admin rights).",
  "service.note.windows":
    "Windows uses a per-user scheduled task: it starts at user logon and does not need the password stored in the task. If the task is blocked by antivirus/EDR, it automatically falls back to the Startup folder.",
  "service.status.installedWord": "installed",
  "service.status.notInstalledWord": "not installed",
  "service.status.activeUnknown": "unknown",
  "service.status.activeRunning": "running",
  "service.status.activeStopped": "not running",
  "service.status.line": "System startup entry: {installed}, {active}",
  "service.status.configPath": "Config file: {path}",
  "service.status.taskNameLine": "Scheduled task: {name}",
  "service.status.autostartMethodLine": "Auto-start method: {method}",
  "service.status.consoleRunning":
    "Console: foreground running (pid {pids})",
  "service.status.consoleIdle":
    "Console: not running (the Console is not managed by the system background service)",
  "service.status.detailsHeader": "\nSystem status details:",
} as const;
