# nuwa-cli

[English](README.md) | [简体中文](README.zh-CN.md)

Headless multi-engine agent CLI. `nuwa-cli` attaches to the `claude` and `codex` CLIs you've already installed and logged into — no separate login, no bundled Claude/Codex runtime, no isolated config directory. It reads the exact same `~/.claude` / `~/.codex` state your terminal already uses.

**One-line installer** — installs from the Nuwax S3 mirror (reachable in mainland China; no GitHub or npm login needed) and configures PATH automatically (Windows / macOS / Linux), so `nuwa-cli` works in a new terminal without any manual env editing:

```bash
# Windows (PowerShell)
irm https://s3.nuwax.com:9443/nuwax-packages/agent-engines/nuwa-cli/install-from-s3.ps1 | iex

# macOS / Linux
curl -fsSL https://s3.nuwax.com:9443/nuwax-packages/agent-engines/nuwa-cli/install-from-s3.sh | bash
```

> Slow `npm install` for dependencies? Set a mirror — `NUWACLI_REGISTRY=https://registry.npmmirror.com` (bash) or `$env:NUWACLI_REGISTRY='https://registry.npmmirror.com'` (PowerShell); the installer forwards it to `npm install --registry`.
> Self-signed S3 endpoint? Set `NUWAX_S3_INSECURE=1`; the installer also auto-retries with certificate checks disabled.

Or install manually from the npm registry (requires Node.js 22+):

```bash
npm install -g @nuwax-ai/nuwa-cli@beta
nuwa-cli doctor
nuwa-cli chat -p "list the files in this directory"
```

## Developer Quick Start

For local development in this repository:

```bash
npm install
npm run build
npm run dev:cli -- --version
npm run dev:doctor
npm run dev:chat -- -p "hello"
```

More local debugging scripts and step-by-step workflows live in [`docs/local-debugging.md`](docs/local-debugging.md).

## Why

`nuwa-cli` installs both ACP engine adapters as normal package dependencies while preserving the user's existing local state:

- **Local config remains the default.** When a session supplies no runtime configuration, `HOME`, `~/.claude`, `~/.codex`, MCP servers, skills, environment variables, and model preferences remain untouched.
- **ACP session config wins when supplied.** Per-session model credentials/provider/model, engine environment variables, and MCP servers override Gateway flags and local settings for that session only.
- **Uses normal package dependencies.** ACP adapters, `nuwax-file-server`, and `@nuwax-ai/lanproxy` are installed by npm with `nuwa-cli`; lanproxy uses platform-specific optional dependencies so each machine receives only its OS/CPU binary.
- **Talks ACP.** Both engines are driven over the [Agent Client Protocol](https://agentclientprotocol.com), the same protocol editors like Zed use — not a scraped CLI wrapper.

## Commands

### `nuwa-cli doctor`

Checks Node version, packaged Claude/Codex ACP runtimes, optional local CLI/login data, `uv`, macOS TCC risk, Nuwax cloud login/computer name, lanproxy runtime health, and local session history.

Exit code only reflects checks that actually block core functionality: Node version, and having *at least one* of claude/codex usable. Everything else (`uv`, TCC risk, Nuwax login) is opt-in and shown as `○` rather than `✖` when unmet — `doctor` still exits `0` in that case, so it's safe to use in scripts/CI without false positives from features you haven't opted into.

### `nuwa-cli chat`

```bash
nuwa-cli chat                                  # interactive REPL, claude engine
nuwa-cli chat --engine codex -p "explain this diff"
nuwa-cli chat --resume                         # pick a past session to continue
nuwa-cli chat --resume <sessionId>              # continue a specific one
nuwa-cli chat --yolo                           # auto-approve tool calls
nuwa-cli chat --mode acceptEdits               # engine-specific session mode
nuwa-cli chat --handoff claude:<sessionId> -p "keep going"
```

Flags:

| Flag | Meaning |
|---|---|
| `--engine <claude\|codex>` | Which engine to attach to (default `claude`) |
| `--cwd <dir>` | Working directory for the session |
| `-p, --print <prompt>` | Send one prompt and exit (non-interactive) |
| `--yolo` | Auto-approve every tool call the engine asks about |
| `--mode <modeId>` | Set an engine session mode (`acceptEdits`, `bypassPermissions`, `read-only`, `full-access`, ... — varies by engine) |
| `--resume [sessionId]` | Resume a session from your local `claude`/`codex` history; omit the id to pick interactively |
| `--ref-session <engine>:<sessionId>` | Point the model at a session from the *other* engine as background context (not a true resume — see below). Mutually exclusive with `--resume` |
| `--handoff <engine>:<sessionId>` | Generate a structured handoff package from another local session and inject it into the first turn of a new ACP session. Mutually exclusive with `--resume` / `--ref-session` |
| `--api-key` / `--base-url` / `--model` | Override model connection — only needed if you don't want the engine's own configured provider |

By default nuwa-cli injects **no** credentials and overrides **no** model/skill/MCP configuration — the engine runs with whatever you already have configured. A remote ACP session may explicitly supply per-session model/MCP/environment configuration; that session-scoped configuration takes precedence without rewriting the user's local files.

### `nuwa-cli sessions`

Lists local `claude`/`codex` session history (read directly from `~/.claude/projects` and `~/.codex/sessions`), so you can find a session id to resume.

`nuwa-cli sessions summary --engine <claude|codex> --session-id <id> [--limit N]` prints a compact, engine-agnostic JSON digest of one session's full transcript (`{engine, sessionId, cwd, title, messages, hasMore}`). This is kept as a low-level compatibility command; the newer cross-agent context surface is `nuwa-cli context`.

### `nuwa-cli console`

Starts a **local-only** lightweight web dashboard (default `127.0.0.1:60017`) and opens it in your browser: view / resume / new claude·codex sessions, switch engine / model / ACP mode, and chat with streaming — all from one page. Zero extra dependencies; the page is bundled with the CLI.

```bash
nuwa-cli console                         # default claude engine, opens a browser
nuwa-cli console --engine codex          # default to codex (still switchable in-page)
nuwa-cli console --no-open               # don't auto-open; open the printed URL yourself
nuwa-cli console --approve ask           # approve every tool call in-browser
```

What you get:

- **Left · session list**: local `claude`/`codex` history (with engine + model badges) plus live sessions. **Resume** does a real ACP `session/load`; **View** browses the transcript read-only; **+ New** starts a fresh session.
- **Top controls**: engine, **mode** dropdown (from the engine's `modes.availableModes`, e.g. `default`/`acceptEdits`/`plan`/`bypassPermissions`), **model** dropdown (switchable when the engine exposes a model selector via ACP `configOptions`, otherwise read-only).
- **Center chat**: send a message and stream the reply over SSE; tool calls and thoughts render inline.
- **Permission prompts**: under `--approve ask` or for sensitive categories, tool calls surface approve/reject buttons in the chat area (reusing `serve`'s `acpRequestPermission` + approval channel).

Flags:

| Flag | Meaning |
|---|---|
| `--engine <claude\|codex>` | Default engine (still switchable in-page) |
| `--port <port>` | Listen port, auto-increments if busy (default `60017`) |
| `--host <host>` | Listen address (default `127.0.0.1`; loopback only recommended) |
| `--cwd <dir>` | Default working directory for new sessions; defaults to the workspace dir |
| `--approve <auto\|ask\|deny>` | Permission policy: `auto` (default; auto-approves ordinary tools, still prompts for sensitive ones) / `ask` (prompt for each) / `deny` (reject all) |
| `--no-open` | Don't auto-open the browser |
| `--api-key` / `--base-url` / `--model` | Override model connection (same as `chat`) |

On startup it prints a local URL carrying a one-shot token, e.g. `http://127.0.0.1:60017/?t=<token>`: the token is embedded in the page (no manual entry) and also blocks drive-by requests from other web pages.

`console` is a **foreground** process — closing the terminal or `Ctrl+C` stops it. For unattended remote/cloud scheduling use Gateway. Full notes in [`docs/console.md`](docs/console.md).

### `nuwa-cli context`

An ACP-adjacent context reference layer. It does not replace ACP session lifecycle and does not perform cross-engine native resume; it only turns local session history into JSON a target agent can read on demand:

```bash
nuwa-cli context list --json
nuwa-cli context read --ref claude:<sessionId> --limit 40 --json
nuwa-cli context digest --ref claude:<sessionId> --json
nuwa-cli context handoff --ref claude:<sessionId> --json
```

- `read`: normalized message stream, close to `sessions summary`.
- `digest`: rule-based compact summary with recent goal, tool calls, file paths, decisions, open tasks, and risks.
- `handoff`: structured package for another agent to take over the work.

#### Cross-engine context with `chat --ref-session`

ACP's `session/load` is engine-native — a `claude-code-acp-ts` session can't be resumed by `nuwax-codex-acp` and vice versa, since each only understands its own on-disk transcript format and tool-calling conventions. There's no true cross-engine resume, and `nuwa-cli` doesn't pretend otherwise.

Instead, `chat --ref-session <engine>:<sessionId>` prepends a one-line reminder to the *first* prompt of a **new** session, pointing the model at `nuwa-cli context digest/read` so it can pull the other engine's history on demand — via its own already-available Bash tool, with no new MCP server or protocol needed:

```bash
nuwa-cli chat --engine codex --ref-session claude:c6e84245-a81c-4563-b0c8-2f0e2cf4682a \
  -p "what did we decide about the API shape in that session?"
```

This mirrors how [tutti](https://tutti.sh) bridges context between claude-code/codex/cursor/etc: a short routing hint rather than eagerly dumping the whole transcript into the prompt, so the model reads only as much as it actually needs.

`--handoff <engine>:<sessionId>` first generates a structured handoff package (goal, decisions, open tasks, files, risks, recent messages) and injects it into the first turn of a new ACP session. It is for "let another agent take over", but it is still not native resume.

`--ref-session` / `--handoff` cannot be combined with `--resume`, and they are mutually exclusive with each other — they represent native resume, read-only reference, and handoff start respectively.

This is local-only, read-only context sharing between two engines' history on the same machine — it's unrelated to (and doesn't require) the Nuwax cloud login below. There's no unified local+cloud session list yet; `sessions`/`sessions summary` only ever see local `~/.claude`/`~/.codex` history.

### `nuwa-cli login` / `logout` / `status` / `config`

Headless login to a Nuwax account, so cloud/remote features can be enabled without any UI:

```bash
nuwa-cli login --help
nuwa-cli login --domain https://agent.nuwax.com --saved-key <key>   # already have a key
nuwa-cli login --domain https://agent.nuwax.com -u <username>       # first time (prompts for password)
nuwa-cli status --remote     # re-validate the stored key against the server
nuwa-cli logout              # clears the session but keeps the saved key
nuwa-cli config get
nuwa-cli config set domain <host>
```

Credentials live in `~/.nuwa-cli/credentials.json` (mode `0600`). Passwords are never persisted. The CLI does not use SQLite; to match the Electron client's behavior, `credentials.json` keeps a lightweight JSON account map keyed by `domain + username`. Logging in again with the same domain/account reuses that savedKey so the backend renews the same computer instead of creating a new one; omitting domain/account uses the current default account.

`nuwa-cli status` also reports whether a local `serve` is running and on which port — read from a lockfile `serve` writes on listen. The `X-Nuwax-Internal-Secret` itself is still never persisted, so to actually call `/computer/chat` you must grab the secret from the serve process's startup output.

CLI login state is intentionally isolated from the NuwaClaw Electron client. `nuwa-cli login` never reads the Electron client's SQLite database and never reuses its savedKey; run it with `--saved-key` or `-u` to create CLI-owned credentials and a CLI-owned device id.

### `nuwa-cli account`

Manage multiple accounts stored in `~/.nuwa-cli/credentials.json`:

```bash
nuwa-cli account --help
nuwa-cli account list
nuwa-cli account switch --help
nuwa-cli account switch <account-key>
```

`account list` prints switchable account keys such as `testagent.xspaceagi.com_18011447397` and marks the current default with `*`. `account switch` re-registers with that account's savedKey and makes it the current default.

Account switching affects Gateway, file-server, lanproxy, and backend registration, so it is **not hot-swapped**. Run `nuwa-cli stop --all` before switching accounts.

### `nuwa-cli gateway`

One command to detect an available engine, log in/register, and start `serve --tunnel`:

```bash
nuwa-cli gateway --help
nuwa-cli gateway --domain https://agent.nuwax.com --saved-key <key>
nuwa-cli gateway --domain https://agent.nuwax.com -u <username>
NUWACLI_PASSWORD='<password>' nuwa-cli gateway --domain https://agent.nuwax.com -u <username>
```

When `--engine` is omitted, nuwa-cli checks the packaged Claude/Codex ACP runtimes: it uses the only available engine and randomly selects one when both are available. System `claude`/`codex` commands and local login/config files are optional; without them, local history/model hints may be empty, but sessions can still run when ACP supplies model configuration. `NUWACLI_PASSWORD` is only read for Nuwax registration, is never written to credentials, and is stripped from child environments.

After npm publish, clean machines can use the zero-install entry:

```bash
npx -y @nuwax-ai/nuwa-cli@beta gateway --domain https://agent.nuwax.com --saved-key <key>
```

For local debugging before npm publish, see [`docs/local-debugging.md`](docs/local-debugging.md). Full design notes live in [`docs/gateway.md`](docs/gateway.md).

Persistent run modes:

```bash
nuwa-cli gateway --engine claude --daemon          # detach from this terminal
nuwa-cli service install --engine claude --now # install current-user autostart and start now
nuwa-cli service status
nuwa-cli service stop
nuwa-cli service uninstall
```

`--daemon` is the lightweight "keep running after this terminal closes" mode. It still exits on reboot/logoff. `nuwa-cli service` installs an OS-managed current-user service: macOS LaunchAgent, Linux systemd user service, or Windows Scheduled Task. The service config stores only runtime flags such as engine/port/cwd/lanproxy overrides; it does **not** store passwords, savedKey/configKey, or model API keys. Login state remains in `~/.nuwa-cli/credentials.json`.

### Runtime lifecycle

```bash
nuwa-cli ps                    # list Gateway, Console, and chat processes
nuwa-cli start                 # daemon Gateway only
nuwa-cli start --all           # Gateway + foreground Console
nuwa-cli start --force         # replace Gateway (add --all to replace Console too)
nuwa-cli stop                  # stop Gateway by default
nuwa-cli stop --console        # stop only Console
nuwa-cli stop --all            # stop Gateway and Console
nuwa-cli restart               # force-restart Gateway daemon only
nuwa-cli restart --all         # force-restart Gateway + foreground Console
nuwa-cli doctor --fix          # repair duplicate instances without restarting
```

`start` / `restart` / `stop` default to Gateway only; pass `--all` to include the foreground Console. `Ctrl+C` on Console stops only Console while Gateway keeps running. Gateway can run in the foreground, daemonize, or be managed by the OS service. Console never daemonizes.

### `nuwa-cli service`

Manage background persistence and login/startup autostart:

```bash
nuwa-cli service install --help
nuwa-cli service install --engine claude --now
nuwa-cli service start
nuwa-cli service stop
nuwa-cli service status
nuwa-cli service uninstall
```

Install requires an existing CLI default account. Run `nuwa-cli login` or `nuwa-cli gateway` successfully once first. On macOS and Windows the service starts when the current user logs in. On Linux it uses `systemd --user`; starting before login requires enabling linger on the machine, for example `loginctl enable-linger $USER` where allowed.

### `nuwa-cli update`

Upgrade the npm-installed CLI package:

```bash
nuwa-cli update --help
nuwa-cli update                 # upgrade to the newest beta
nuwa-cli update 0.1.0-beta.2    # upgrade to a specific version
nuwa-cli update latest          # explicitly switch to the stable channel
nuwa-cli update --check         # only query the target version
```

`update` uses npm to upgrade the package. It does not modify `~/.nuwa-cli/credentials.json`, savedKeys, accounts, or service locks. During the prerelease phase it follows npm's `beta` tag by default. For temporary runs, prefer `npx -y @nuwax-ai/nuwa-cli@beta ...` directly.

### `nuwa-cli serve`

Starts a local-only HTTP API (`127.0.0.1` by default) for scripting or remote/IM integration:

```bash
nuwa-cli serve --port 60016
# -> POST /computer/chat            { prompt, session_id?, cwd?, acp_config? } -> { session_id }
# -> GET  /computer/progress/:id    SSE stream of session updates
# -> GET/POST /computer/agent/status
# -> POST /computer/agent/stop      { session_id }
# -> POST /computer/agent/session/cancel
# -> POST /computer/notify-resolved (accepted as a no-op in headless mode)
# -> GET  /health                   (no auth required)
```

`serve` prefers the CLI-owned `agentPort=60016` by default; if that port is already occupied it automatically advances to the next available port and prints the actual address. Under `--tunnel`, `nuwax-file-server` similarly prefers `fileServerPort=60015`, advances when occupied, and reports the final port in `sandboxConfigValue`.

For a new session, the NuwaClaw-compatible contract uses `agent_config.agent_server.command` to select the engine, `model_provider` for model settings, `agent_config.agent_server.env` for engine environment variables, and `agent_config.context_servers` for MCP. Recognized Claude commands are `claude-code` / `claude-code-acp-ts`; recognized Codex commands are `codex`, `codex-cli`, `codex-acp`, and `nuwax-codex-acp`. Missing or unknown engines fall back to Codex. The generic `acp_config` shape remains accepted. Precedence is: session configuration > Gateway `--api-key/--base-url/--model` > local environment and `~/.claude` / `~/.codex`. Omitting session configuration preserves local behavior exactly.

#### Model protocol routing

When the downstream `model_provider` includes a model, nuwa-cli auto-routes the engine based on protocol:

- `api_protocol: "openai"` (or inferred from model name / base URL) → **codex** engine
- `api_protocol: "anthropic"` (or model name starts with `claude-`) → **claude** engine
- No model sent → uses the locally selected engine (default codex)

Protocol is resolved from `model_provider.api_protocol` (or `protocol` / `provider`), falling back to base URL / model name inference, defaulting to `openai`.

When routing to **codex** with an OpenAI-protocol model, nuwa-cli injects:
- `OPENAI_API_KEY` + `CODEX_API_KEY` (same value)
- `OPENAI_BASE_URL` + `CODEX_BASE_URL` (same value)
- `CODEX_MODEL` (raw model name)
- `CODEX_WIRE_API=chat` (forces Chat Completions API; most third-party providers don't support Responses API)
- `CODEX_MODEL_CONTEXT_WINDOW=200000`

When routing to **claude** with an anthropic-protocol model, nuwa-cli injects:
- `ANTHROPIC_API_KEY` + `ANTHROPIC_AUTH_TOKEN` (same value)
- `ANTHROPIC_BASE_URL`
- `ANTHROPIC_MODEL`
- `CLAUDE_CONFIG_DIR` pointing to `~/.nuwa-cli/claude-config` — this prevents `claude` from reading the user's global `~/.claude/settings.json` `env` block, which could override our injected credentials with a different provider's keys.

The model is also applied to the running engine via ACP `session/set_config_option` (configId `model`) after session creation, so the engine uses the downstream model instead of its local default.

If `--cwd` is not provided, the default workspace root is `~/.nuwa-cli/workspaces`, and Cloud/Electron-style requests create project workspaces as `~/.nuwa-cli/workspaces/<project_id>`. `agent_work_dir` / `session_id` are only compatibility fallbacks when `project_id` is missing. `user_id` is kept as request metadata but is not used in the local path. If `--cwd <dir>` is provided, that directory is treated as the project directory itself; nuwa-cli does not append `project_id` under it. `nuwax-file-server` is pointed at the same active directory/root.

For plain local `serve`, every route except `/health` and the read-only SSE `/computer/progress/:session_id` requires authentication. The preferred form is `X-Nuwax-Internal-Secret`, with `Authorization: Bearer <secret>` and `?apiKey=<secret>` accepted for clients that cannot set custom headers. In `--tunnel` mode, `/computer/*` and `/devcomputer/*` follow the Electron client's contract: the lanproxy connection is authenticated with the savedKey/configKey client key, and the forwarded local HTTP calls do not carry another per-request savedKey. The server still prints a fresh local debug secret on startup; it is never written to disk.

`--approve` controls tool-call approval: `auto` (default) auto-approves ordinary tool calls (`yolo`) but **sensitive classifiers** (e.g. local session history) still require human approval via SSE `acpRequestPermission` + `POST /computer/notify-resolved`; `ask` requires approval for every tool call; `deny` refuses them all. Any other value is rejected rather than silently treated as `auto`. See [`docs/acp-permission-guardrails.md`](docs/acp-permission-guardrails.md).

Lifecycle:

- `POST /computer/agent/stop` interrupts the session — it aborts the engine connection (SIGTERM to the engine child) and waits up to ~3s for it to exit, rather than blocking until an in-flight tool call finishes on its own.
- A session whose engine dies is evicted and emits a terminal `session_ended` event (SSE `subType` `error` or `ended`) to `/computer/progress` clients, so subscribers learn the session is gone instead of waiting forever.
- On `SIGINT`/`SIGTERM` the server stops every active session (tearing down their engine children), stops the `--tunnel` `nuwax-file-server` and lanproxy child, then closes the HTTP listener — engine children and helper services are no longer orphaned.

`--tunnel` requires `nuwa-cli login` first. It re-registers the CLI with the backend, starts local `nuwax-file-server`, then starts the platform binary installed by `@nuwax-ai/lanproxy`:

```bash
nuwa-cli config set lanproxy-path /path/to/nuwax-lanproxy
nuwa-cli serve --tunnel --lanproxy-host agent.nuwax.com --lanproxy-port 443
```

If the register response includes `serverHost`/`serverPort`, the explicit host/port flags can be omitted. CLI runtime logs follow the Electron client's shape: structured JSONL entries go to `~/.nuwa-cli/logs/main.YYYY-MM-DD.log`, and `latest.log` points at today's active log. `--daemon` still appends raw stdout/stderr to `serve.log` for startup-output capture.

## Known limitations

- **Process-tree teardown on exit**: only the direct engine child receives `SIGTERM`; grandchildren (for example, the `claude` binary the `claude-code-acp-ts` adapter spawns) aren't signalled and may be orphaned. `serve` shutdown still stops its own HTTP sessions, but stray grandchildren can linger.
- **No path-confinement in `yolo`**: `--approve auto` auto-approves ordinary tool calls regardless of target path; there is no writable-root guard yet. Sensitive access (local sessions) is still forced to ask — see [`docs/acp-permission-guardrails.md`](docs/acp-permission-guardrails.md).
- **Autostart is current-user scoped**: `service install` uses LaunchAgent / systemd user service / Scheduled Task. It is not a privileged system-wide daemon. On Linux, true boot-before-login requires systemd linger configured outside the CLI.
- **Custom/third-party ACP engines** (pi-acp, hermes, kilo, openclaw, ...) aren't supported yet — only `claude` and `codex`.
- **Optional dependencies**: installing with `npm install --omit=optional` omits the platform lanproxy binary. Reinstall normally, or use `--lanproxy-path` / `NUWACLI_LANPROXY_PATH` to provide one explicitly.
- **Cloud session sync/listing**: `sessions`/`status` are local-only for now: there's no confirmed backend API yet for cross-device session history.
- **Prompt timeout**: each prompt has a 5-minute timeout. If the engine hangs (e.g. MCP server initialization blocks or API is unreachable), the session reports an error instead of waiting forever.
- **MCP server startup**: engines (especially claude-code) wait for all MCP servers to initialize before processing the first prompt. If MCP servers require downloading packages (`npm exec`), the first session may take several minutes to start.

## How it works

- ACP connection: `@agentclientprotocol/sdk`'s `client().connectWith(...)` builder, spawning the engine over stdio NDJSON.
- `claude` engine: spawns [`claude-code-acp-ts`](https://www.npmjs.com/package/claude-code-acp-ts). It prefers a system `claude` binary when present; otherwise its Claude Agent SDK platform package provides the runtime.
- `codex` engine: spawns the package dependency [`nuwax-codex-acp`](https://www.npmjs.com/package/nuwax-codex-acp); that package pulls the matching platform binary through npm optional dependencies.
- `serve --tunnel`: starts [`nuwax-file-server`](https://www.npmjs.com/package/nuwax-file-server), resolves the current platform binary through `@nuwax-ai/lanproxy`, then launches it with the registered savedKey. file-server PID/lock temp files are scoped per port under `~/.nuwa-cli/tmp/file-server-<port>`, so CLI shutdown does not target the Electron client's instance or another CLI tunnel instance.
- **Health checks**: `serve --tunnel` performs real readiness probes after starting file-server (`GET /health` polling) and lanproxy (process liveness + cloud tunnel endpoint). Failed health checks produce a warning but do not block the local HTTP API.
- **Engine stderr logging**: all engine child process stderr is streamed line-by-line to `~/.nuwa-cli/logs/main.YYYY-MM-DD.log` under scope `engine.stderr`, so codex/claude errors are visible without waiting for a crash.
- **Windows**: all child process spawns use `windowsHide: true` to suppress `cmd.exe` console window popups. `.cmd`/`.bat` shims (e.g. `npm.cmd`) are auto-detected and spawned with `shell: true`.
- `service install`: writes a current-user OS service that runs `nuwa-cli gateway` on login/startup. It reuses CLI-owned credentials at runtime instead of embedding secrets into the OS service definition.
- Nothing is installed into your shell's global `node_modules`, and nuwa-cli stores its own credentials, device id, cache, logs, and serve lock under `~/.nuwa-cli/`. If you also run the NuwaClaw Electron app, the two coexist on the same machine without sharing savedKey or local state; `serve` prefers CLI-only ports 60016/60015 and automatically moves forward on conflicts, separate from Electron's 60005–60009 range.

## Requirements

- Node.js >= 22
- Platform optional dependencies must be installed (do not use `--omit=optional`). System `claude`/`codex` CLIs are optional; local login/config is only required when ACP does not supply model credentials.

## Development

Local debugging commands and step-by-step workflows live in [`docs/local-debugging.md`](docs/local-debugging.md).

Design docs (rationale, alternatives, deferred items) live in [`docs/`](docs/) — start with [`docs/serve-lifecycle.md`](docs/serve-lifecycle.md) for the `serve` lifecycle and permission-model design.
