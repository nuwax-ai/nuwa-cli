# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.6-beta.1] - 2026-08-21

### Fixed

- **codex 系统提示词变更 + auto-resume：** codex 在 `thread/start` 时把指令物化为 rollout 首条 `developer` 消息，`thread/resume` 传入的 `developerInstructions` 会被静默忽略。discovery 从 transcript 头部提取 `developerPrompt`，serve chat 在 auto-resume 前与请求 `system_prompt` 比对，不一致则改走 `startSession` 开新 thread（读不到旧提示词时仍 resume）。
- **日志密文脱敏：** daemon 启动横幅的 `X-Nuwax-Internal-Secret` 非 TTY 只打掩码（避免明文写入 `serve.<date>.log`）；新增 `secretScrub`，`logSweep` 对 serve / main / codex `app-server*.log` 做值级兜底清洗（`ak-` token、Internal-Secret 头、Bearer、JSON 密键长值）。

## [0.2.6-beta.0] - 2026-08-21

### Added

- `/computer/chat` 顶层 `system_prompt` 经 ACP `_meta.systemPrompt = { append }` 注入（new / load / reconfigure 全路径），对齐 nuwaclaw。
- 注册 **swarm** 引擎（`@nuwax-ai/swarm` 四专家编排 ACP）；isolation env 注入修复。
- `serve --tunnel` file-server / lanproxy 经 `@nuwax-ai/agent-kit` `withStartRetry` 完整启动重试。详见 [`docs/serve-health-check.md`](docs/serve-health-check.md)。
- `@nuwax-ai/agent-kit` 纳入 `sync:core-deps` exact-pin 清单。

### Changed

- 核心依赖：`nuwax-file-server` 1.3.4 → **1.4.2**。
- file-server 单次健康超时默认改为 kit 的 **20s**；最终不健康时跳过 lanproxy；重试前 `unregisterProcess`。

### Fixed

- 云端系统提示未下发到 agent：`parseDownstreamSessionConfig` 白名单丢弃 + 会话路径未组装 `_meta`。
- MCP：跨名等价（如 `chrome-tools` ≡ `chrome-devtools`）折叠回 DEFAULT persistent；sanitize 后同名变体（`chrome_devtools`）remap 覆盖定制 args；Rust `mcp-proxy convert`（含 Windows `.exe`）改写为本机 TS 入口；`--config` 聚合形态解包对齐 nuwaclaw。
- PersistentMcpBridge：配置未变时复用（防抖）；并行 rewrite Promise 链串行化，避免双 `start` 互踩。
- `bringUpLanproxy` SIGINT 竞态与 stabilize 窗口 abort 误判。

## [0.2.5] - 2026-08-06

### Fixed

- Windows upgrades: after stop/taskkill, **verify** `nuwax-codex.exe` / `nuwax-lanproxy.exe` are gone (retry) and fail with an actionable message instead of opaque npm `EBUSY`. Applied in `nuwa-cli update`, `install.ps1`, and S3 installers.
- Docs / CLI help / README: prefer `nuwa-cli update` over bare `npm i -g` while services are running on Windows.

## [0.2.4] - 2026-08-06

### Changed

- Align PersistentMcpBridge with nuwaclaw: warmup on Gateway/`serve` (and Console) start; keep running until active stop. `claude`/`codex` ephemeral MCP stay raw stdio; persistent defaults go through proxy→Bridge. `status` `mcp-proxy` reads `/health.mcpBridge` (running / not running only).

## [0.2.3] - 2026-08-06

### Fixed

- Windows upgrades: stop `nuwax-codex.exe` (and lanproxy) before overlaying the global package to avoid npm `EBUSY` / locked `copyfile` on vendor binaries. Applied in `nuwa-cli update`, S3/npm installers, and a best-effort `preuninstall` hook.
- Windows installers: null-safe handling of empty npm log files in PowerShell 5.1 so a blank stdout no longer surfaces as「不能对 Null 值表达式调用方法」and masks the real npm error.

## [0.2.2] - 2026-08-06

### Added

- Core runtime dependency sync: exact-pin the five packages (`@nuwax-ai/lanproxy`, `@nuwax-ai/mcp-proxy-ts`, `nuwax-file-server`, `claude-code-acp-ts`, `@nuwax-ai/nuwax-codex-acp-ts`) and manage them with `npm run sync:core-deps` / `sync:core-deps:check`. `release:beta` now gates on `--check`.
- Official npm installers (`install.sh` / `install.ps1`) skip `npm install` when the installed CLI version already matches the resolved tag (same policy as `nuwa-cli update` and the S3 installers).

### Changed

- Bumped pinned core adapters to current latest: `claude-code-acp-ts@0.65.0`, `@nuwax-ai/nuwax-codex-acp-ts@1.2.8`.

## [0.2.0] - 2026-08-05

First stable release. Includes everything from the `0.1.0-beta.*` line, notably:

- **i18n:** English default UI with automatic Simplified-Chinese detection and manual switching (`NUWACLI_LANG`, `nuwa-cli lang`). ACP protocol responses stay English. See [`docs/i18n.md`](docs/i18n.md).
- **UX:** spinner progress for `doctor` / `serve --tunnel` / `start` / `restart`; honest `Step n/N` progress for `update`; unified `status` & `service status` Gateway line; user cancel exits `130` instead of a red error.
- **Bilingual README** (English / 简体中文, in-page switch) shown on npm.
- Distributed as npm `latest` and an S3 `stable` channel (`channels/stable.json`); the beta channel continues for pre-releases.

## [0.1.0-beta.54] - 2026-08-04

### Added

- **Internationalization (i18n):** English is now the default UI language; Simplified Chinese is shown automatically when the system locale is `zh-CN` / `zh-Hans`. Override at any time with the `NUWACLI_LANG` env var or the new `nuwa-cli lang [en|zh-CN|auto]` command (persisted to `~/.nuwa-cli/config.json`). See [`docs/i18n.md`](docs/i18n.md).
- `nuwa-cli lang` command to show or set the UI language.
- Spinner progress feedback for `doctor` (13 checks), `serve --tunnel` bringup, and `start`/`restart` stack-readiness waits; `update` now prints honest `Step n/N` progress instead of a fake percentage bar.
- ACP permission guardrails aligned with NuwaClaw: `PermissionCoordinator`, SSE `acpRequestPermission`, real `POST /computer/notify-resolved`, and pluggable sensitive classifiers (first: local session history). `--approve` now accepts `auto|ask|deny`. See [`docs/acp-permission-guardrails.md`](docs/acp-permission-guardrails.md).
- `/computer/local-sessions/list|read` and `/computer/sensitive-access/await` for consented local-session export; non-TTY `context`/`sessions` CLI paths go through the same bus.
- A resumable `npm run release:beta` workflow now runs tests/build, publishes npm, syncs only `@nuwax-ai/nuwa-cli` through `cnpm`, verifies npmmirror, and publishes S3.
- Windows bootstrap installers now run npm through an encoded child PowerShell process instead of `Start-Job`, preserving the full argument list, progress updates, exit code, and original npm stdout/stderr.
- S3 bootstrap installers now default dependency resolution to npmmirror (overridable with `NUWACLI_REGISTRY`).

### Changed

- **ACP protocol responses are always English** (aligned with NuwaClaw / `@nuwax-ai/agent-kit`); only human-facing terminal output is localized. Chinese that previously leaked into HTTP `error.message` via thrown errors has been removed.
- `status` and `service status` now share one unified Gateway status-line format (`http://host:port  PID  started`).
- Unified UI primitives (`src/util/ui.ts`): symbols, semantic colors, `[nuwa-cli]` prefix, spinner, and cancel handling.

### Fixed

- Traditional Chinese locales (`zh-TW` / `zh-HK` / `zh-Hant`) fall back to English instead of incorrectly mapping to the Simplified Chinese bundle.
- User cancel (Esc / Ctrl+C) in `gateway` / `login` now exits silently with code 130 instead of printing a red "failed" error.

## [0.1.0-beta.53] - 2026-08-04

### Added

- `nuwa-cli status` and `doctor` now show login/boot KeepAlive (autostart) status.
- `nuwa-cli doctor --fix` detects first, then auto-remediates: install KeepAlive if missing, rebuild Gateway/lanproxy stack when runtime anomalies (multi-instance, tunnel mismatch) are found; skips restart when healthy. Re-checks after fixes.

## [0.1.0-beta.52] - 2026-08-04

### Fixed

- Windows S3 installer: decode `nuwa-cli restart` UTF-8 output correctly (set console encoding when capturing) and strip ANSI color codes so post-upgrade restart no longer prints mojibake / `[22m` residue.
- Daemon serve logs: write UTF-8 BOM on new log files and set `NO_COLOR=1` so Windows `Get-Content` reads Chinese correctly and logs stay free of picocolors escape sequences.

## [0.1.0-beta.51] - 2026-08-04

### Fixed

- Fix daemon handoff race: child `serve` waited for `serve.guard` transfer before acquiring the singleton. Without this, removing `--force` from the daemon child caused immediate exit on Windows (`start` printed a pid then `status` showed nothing running).
- `start` / `restart` now exit `1` when Gateway+/lanproxy are not ready (no more false “Gateway 已就绪”); S3 installers stop the full runtime before upgrade and surface restart output/exit code.

## [0.1.0-beta.50] - 2026-08-04

### Fixed

- Force `start` / `restart` now explicitly stop registered `lanproxy` and detached `file-server` (Windows also `taskkill`s `nuwax-lanproxy.exe`), wait up to ~30s for Gateway `/health` + lanproxy registry after daemon handoff, and no longer forward `--force` into the daemon child. After reboot, `start` also waits the full readiness window before treating an already-running KeepAlive Gateway as “missing children” and force-replacing it—avoiding races that killed a just-started tunnel and printed「未检测到运行中的 lanproxy」。

## [0.1.0-beta.17] - 2026-07-28

### Added

- Show a default progress bar with percentage, numbered stages, and elapsed dependency-install time in the official Windows, macOS, Linux, and S3 bootstrap installers.
- Make `nuwa-cli update` check the selected channel first and skip npm installation when the current version already matches.
- Enable npm's native interactive progress display as additional feedback for first-time installs and `nuwa-cli update`.
- Document `--progress=true` on the direct npm installation command.

## [0.1.0-beta.16] - 2026-07-28

### Fixed

- Ignore Commander's trailing `Command` action argument when invoking `updateCommand`; older direct command registrations no longer fail with `runner is not a function`.
- Lock the Windows updater regression test to the reported `C:\Program Files\nodejs\npm.cmd` path and verify npm runs through `node.exe` without `shell:true`.

## [0.1.0-beta.15] - 2026-07-28

### Fixed

- Recreate an in-memory logical session with the cloud-provided `session_id` after Gateway restart instead of rejecting the first continued message with `ERR_SESSION_NOT_FOUND` / SSE 404.
- Restore the established file-server workspace layout at `<workspace>/<user_id>/<agent_work_dir>`. Automatically migrate files created under beta.14's accidental extra `computer-project-workspace` directory.

## [0.1.0-beta.14] - 2026-07-28

### Fixed

- Preserve the public session ID when switching model providers or Agent engines. Runtime changes now send ACP `session/cancel`, replace the engine runner in place, and apply the newly delivered model, environment, and MCP configuration instead of returning SSE 404.
- Emit ACP session-update subtypes as SSE event names (while retaining the aggregate Console event), allowing interactive `nuwax_ask_question` forms and tool updates to reach cloud clients.
- Align Agent cwd with `nuwax-file-server`: `computer-project-workspace/<user_id>/<agent_work_dir>`. Generated files, prompts, tools, skills, and plugin outputs are now visible to file preview and packaging APIs.
- Sanitize and deduplicate ACP MCP server names to the OpenAI/Anthropic tool-name character set, including non-Latin names delivered by agent development flows.
- On Windows, run `npm-cli.js` through `node` instead of invoking a spaced `.cmd` path via a shell. `update` stops Gateway, Console, lanproxy, and file-server before installing so executable files are not locked.
- `logout` now stops all services before clearing the active session. A successful `login` automatically restarts an already-running Gateway so the new account takes effect immediately.

## [0.1.0-beta.3] - 2026-07-23

### Changed

- 依赖 `which` / `write-file-atomic` 降级到 v5(engines 覆盖 Node 18.17+/20.5+,消除 v24.13 等版本的 EBADENGINE 警告);`engines.node` 回退为 `>=22.0.0`。
- serve/console 的 `process.on("exit")` 兜底清理加 `shuttingDown` 守卫,避免正常 SIGINT 退出时与 `shutdown` 重复执行 `stopFileServer` 等。

### Added

- **Nuwax S3 分发**:`scripts/publish-s3.sh` 把 npm tarball + 安装器发布到 `s3.nuwax.com:9443`(`nuwax-packages` 桶,`agent-engines/nuwa-cli` 前缀),维护 `channels/{stable,beta}.json` 指针与 `latest.json`,并覆盖 prefix 根的 bootstrap 安装器;凭证只从环境 / `~/.aws` profile 读取(`.env` 已 gitignore)。详见 [`docs/distribution-s3.md`](docs/distribution-s3.md)。
- `scripts/install-from-s3.sh`(macOS/Linux)与 `scripts/install-from-s3.ps1`(Windows):从公开 S3 读 channel 指针 → 下载 tarball → `npm install -g` → 配置 PATH;零凭证(公开读)、无需 aws-cli、自签证书自动降级 `-k`;支持 `NUWACLI_CHANNEL` / `NUWACLI_VERSION` / `NUWACLI_REGISTRY`。
- 跨平台一键安装脚本 `scripts/install.sh`(macOS/Linux)与 `scripts/install.ps1`(Windows,走 npm registry):自动 `npm install -g` + 配置 PATH(Windows 写用户级注册表、Unix 写 shell rc)+ 校验,幂等;支持 `NUWACLI_REGISTRY` 镜像透传。
- README(中英)安装段以 S3 一键命令为主(国内可达、无需 npm 登录),npm registry / jsDelivr 作为备选。

## [0.1.0-beta.2] - 2026-07-23

### Changed

- `start` / `restart` / `stop` 默认只作用于 Gateway；加 `--all` 才包含前台 Console（`stop` 原本即如此，现与 start/restart 语义统一）。
- 依赖改为直接使用 `which` / `write-file-atomic`；`engines.node` 提升为 `>=22.22.2`。

### Fixed

- serve/console 在 process `exit` 时尽力清理 file-server、lanproxy 与 UI 单例锁。
- file-server 进程注册进 process registry，便于 `ps` 识别。

## [0.1.0-beta.0] - 2026-07-07

- Moved the ~78 MB bundled lanproxy resource set into the stable `@nuwax-ai/lanproxy@1.0.0` package family. npm now installs only the current OS/CPU binary through exact-version optional dependencies.
- Added `nuwa-cli start` as the full-runtime entry point: it keeps Gateway in daemon mode and Console in the foreground, reuses healthy instances by default, and supports `--force` replacement.

Initial release.

### Added

- `nuwa-cli doctor` — environment check: Node version, `claude`/`codex` install & login state, `uv`, macOS TCC risk, Nuwax login state, local session counts.
- `nuwa-cli chat` — interactive REPL and `-p` one-shot mode against the `claude` or `codex` engine, inheriting the user's own environment (no isolated `HOME`, no injected credentials by default).
  - `--mode` / `--yolo` session-mode control, with a per-engine mode-name fallback list.
  - `--resume [sessionId]` to continue a session from local `claude`/`codex` history (interactive picker when no id is given).
- `nuwa-cli sessions` — lists local `claude`/`codex` session history.
  - `sessions summary --engine <claude|codex> --session-id <id> [--limit N]` — compact JSON digest of one session's full transcript, meant to be read by an agent's own shell tool rather than a human.
- `nuwa-cli chat --ref-session <engine>:<sessionId>` — points a **new** session at another engine's local history as background context. Not a true resume (ACP `session/load` is engine-native); instead it prepends a one-line reminder to the first prompt telling the model to run `sessions summary` on demand via its own Bash tool. Local-only, read-only; unrelated to the Nuwax cloud login. Mutually exclusive with `--resume` (see Fixed). Covered by `tests/resolveRefSessionReminder.test.ts` and `tests/sessionsSummary.test.ts`.
- `nuwa-cli login` / `logout` / `status` / `config` — headless Nuwax account login (`domain` + `savedKey` model), no UI required.
  - CLI credentials, savedKey, device id, tools/cache, logs, and serve lock live under `~/.nuwa-cli/` and are isolated from the NuwaClaw Electron client. `login` does not read the Electron client's SQLite DB; when no CLI savedKey exists, pass `--saved-key` or `-u`.
  - `credentials.json` now supports multiple accounts without SQLite. Each `domain + username` keeps its own savedKey, repeated username/password login for the same account reuses that savedKey to avoid creating another computer, and omitting domain/account uses the current default account.
- `nuwa-cli account list` / `account switch <account>` — list saved CLI accounts and switch the current default account. Switching re-registers with the selected account and refuses to run while `serve` is active, because serve/file-server/lanproxy/backend registration must be restarted together.
  - `status` also reports whether a local `serve` is running and on which port, via a pid/port lockfile `serve` writes on listen (the `X-Nuwax-Internal-Secret` itself is still never persisted); a stale lock whose PID is dead is auto-cleaned. Covered by `tests/serveLock.test.ts`.
- `nuwa-cli gateway` — one command to detect a usable local engine, log in/register with Nuwax, and start `serve --tunnel`. It supports `--saved-key`, `-u/--username` with interactive password, `NUWACLI_PASSWORD` for non-interactive username/password registration, explicit `--engine`, and automatic engine selection when omitted.
- `nuwa-cli update [version]` — upgrades the npm-installed CLI package, with `--check`, `--dry-run`, and `--registry`. It does not touch CLI credentials or service state.
- `nuwa-cli serve` — local HTTP API (`/computer/chat`, SSE `/computer/progress/:id`, `/computer/agent/status|stop|session/cancel`, `/computer/notify-resolved`, `/health`) for scripting/remote integration; `--tunnel` starts `nuwax-file-server` and a preintegrated lanproxy binary after login.

### Fixed

Pre-release review of the `serve` lifecycle and permission model. Design rationale, alternatives, and deferred items: [`docs/serve-lifecycle.md`](docs/serve-lifecycle.md).

- `serve` shutdown now tears down the whole session tree: `SIGINT`/`SIGTERM` stops every active engine session (`SessionHub.stopAll()`) and the `--tunnel` `nuwax-file-server`, then closes the HTTP listener with `closeAllConnections()` so open SSE/keepalive sockets no longer hang shutdown. Previously only the HTTP listener was closed, orphaning engine child processes and the file server. Covered by `tests/server.test.ts`.
- `POST /computer/agent/stop` now actually interrupts: it aborts the session's engine connection (SIGTERM to the engine child) and waits up to ~3s for the runner to exit, instead of blocking until the in-flight tool call finished on its own. Covered by `tests/connection.test.ts` ("interrupts a hung prompt when the abort signal fires").
- A session whose engine dies after it became ready is now evicted from the registry and emits a terminal `session_ended` SSE event (`subType` `error`/`ended`) to `/computer/progress` clients; previously it stayed in the registry forever, `/computer/agent/status` reported it alive, and later `POST /computer/chat?session_id=…` returned `202` for a session that never ran.
- `serve --approve` is validated against `{auto, deny}`; an unrecognized value (e.g. a typo) errors out instead of silently falling through to `yolo` (full auto-approve). When `yolo` is active (the default) the server prints a startup warning that all tool calls — including destructive writes/shell/network — are auto-approved with no path confinement (confinement itself is still pending — see README's Known limitations).
- `withEngineConnection` accepts an optional `AbortSignal` (4th arg); aborting kills the engine child so a parked `op` (e.g. an in-flight `session/prompt`) stops promptly. `chat` does not use it; `serve` uses it for `/computer/agent/stop` and shutdown.
- `chat --resume` combined with `--ref-session` is now rejected up front instead of silently prepending the ref-session reminder into a resumed conversation's next turn: the reminder is only meaningful on a brand-new session's first turn, and a resumed session already has real history to continue, so mixing in a reminder about an unrelated third session would pollute it. Covered by `tests/chatRefSessionResumeConflict.test.ts`.
- `doctor`'s exit code no longer fails on unmet checks that are opt-in by design (`uv`, TCC risk, Nuwax login) — previously *any* unmet check set exit code `1`, so a perfectly working setup that simply hadn't opted into Nuwax cloud login reported failure (and broke non-interactive use, e.g. `npm run dev:doctor` exiting nonzero and tripping package-manager lifecycle errors). Only Node version and "at least one of claude/codex usable" now count as blocking; unmet optional checks print `○` instead of `✖` and the summary line distinguishes "blocking problem" from "core passed, some optional items unconfigured." Covered by `tests/doctor.test.ts`.
- `doctor`'s Nuwax-login fix hint now always points at manual CLI login (`--domain`/`--saved-key`) and no longer checks Electron client data.

### Design notes

- The `claude` engine spawns the npm package dependency `claude-code-acp-ts` with `CLAUDE_CODE_EXECUTABLE` pointed at the user's own `claude` binary.
- The `codex` engine spawns the npm package dependency `nuwax-codex-acp`; the package pulls its platform binary through npm optional dependencies.
- `serve --tunnel` now starts the npm package dependency `nuwax-file-server` instead of installing it lazily at runtime.
- `serve --tunnel` now starts lanproxy with Electron-compatible `-s/-p/-k/--ssl` arguments, reports the serve secret as `sandboxConfigValue.apiKey`, and supports `--lanproxy-path`, `--lanproxy-host`, `--lanproxy-port`, `--lanproxy-ssl`, and `--daemon`.
- `serve` now prefers CLI-owned ports 60016/60015 but automatically advances to the next available ports when they are occupied; the final agent/file-server ports are the ones used for HTTP listen, local file-server startup, and `sandboxConfigValue` registration.
- CLI child processes strip Electron/client runtime variables (`NUWAX_*` login/port values, `NUWACLI_SERVE_*`, ACP binary overrides, npm lifecycle noise) so a terminal-launched CLI does not accidentally inherit desktop-client state.
- `NUWACLI_PASSWORD` is stripped from engine, lanproxy, file-server, and daemon child environments after being used for non-interactive login/up registration.
- `login --help`, `up --help`, and `account switch --help` document default-account reuse, multi-account JSON storage, `NUWACLI_PASSWORD`, and the service-restart requirement for account switching.
- `--version` and update/version-related output now use a build-injected package version instead of a manually duplicated constant in `src/cli.ts`.
- `nuwax-file-server` now runs with `TMPDIR`/`TMP`/`TEMP` scoped per port under `~/.nuwa-cli/tmp/file-server-<port>`, isolating its package-level PID/lock files from any Electron-client, standalone file-server, or other CLI tunnel instance using a different port.
- CLI command wiring is split into `src/cli/createProgram.ts`, grouped `register*.ts` modules, and shared option helpers, leaving `src/cli.ts` as a thin executable entry. Empty placeholder source directories were removed.
- Both engines run with the caller's real environment inherited — no `HOME`/`XDG`/`CLAUDE_CONFIG_DIR` redirection, no default credential injection.
- Cross-engine context (`--ref-session`) deliberately avoids eagerly expanding the referenced transcript into the prompt (prompt bloat, stale snapshots) in favor of an on-demand pull via the model's own shell tool — the same pattern the [tutti](https://tutti.sh) multi-agent workspace uses for cross-provider session references.
- nuwa-cli deliberately does not import Electron-client login data. Keeping CLI savedKey/device id/local state under `~/.nuwa-cli/` and preferring ports 60016/60015 keeps it separated from the Electron client's `~/.nuwaclaw/` data and 60005-60009 port range.
