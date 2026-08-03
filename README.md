# nuwa-cli

[English](README.md) | [简体中文](README.zh-CN.md)

Headless multi-engine agent CLI. `nuwa-cli` bundles ACP runtimes for Codex and Claude. A locally installed CLI is optional: when present, nuwa-cli reuses its `~/.claude` / `~/.codex` history and configuration; otherwise the session can run entirely from model, environment, and MCP configuration delivered over ACP.

---

## Install

**One-line installer** (S3 mirror, CN-reachable, auto-configures PATH):

```bash
# Windows (PowerShell)
irm https://s3.nuwax.com:9443/nuwax-packages/agent-engines/nuwa-cli/install-from-s3.ps1 | iex

# macOS / Linux
curl -fsSL https://s3.nuwax.com:9443/nuwax-packages/agent-engines/nuwa-cli/install-from-s3.sh | bash
```

Or via npm (requires Node.js 22+):

```bash
npm install -g @nuwax-ai/nuwa-cli@beta --progress=true
nuwa-cli doctor
```

> npm too slow? `NUWACLI_REGISTRY=https://registry.npmmirror.com` (bash) / `$env:NUWACLI_REGISTRY='https://registry.npmmirror.com'` (PowerShell).

---

## Quick start

```bash
nuwa-cli doctor                          # check environment
nuwa-cli chat -p "list files"            # one-shot, claude engine
nuwa-cli chat --engine codex -p "hello"  # one-shot, codex engine
nuwa-cli console                         # web dashboard (browser)
nuwa-cli gateway --domain https://agent.nuwax.com --saved-key <key>  # cloud tunnel
```

---

## Commands

### Core

| Command | Description |
|---|---|
| `nuwa-cli doctor` | Check Node, engines, login state, lanproxy health |
| `nuwa-cli chat` | Interactive REPL or one-shot (`-p`) with claude/codex |
| `nuwa-cli console` | Local web dashboard with streaming chat ([docs](docs/console.md)) |
| `nuwa-cli sessions` | List/resume local claude/codex session history |
| `nuwa-cli workspaces` | List local workspace directories (cloud-session files) |
| `nuwa-cli context` | Cross-engine context reference (read/digest/handoff) |

### Cloud & lifecycle

| Command | Description |
|---|---|
| `nuwa-cli gateway` | Auto-detect engine → login → start `serve --tunnel` ([docs](docs/gateway.md)) |
| `nuwa-cli serve` | Local HTTP API for scripting / IM integration ([docs](docs/serve-lifecycle.md)) |
| `nuwa-cli login` / `logout` / `status` | Nuwax account login (headless) |
| `nuwa-cli account` | Manage multiple accounts |
| `nuwa-cli config` | Get/set domain, lanproxy path, etc. |
| `nuwa-cli service` | OS-level autostart (LaunchAgent / systemd / Scheduled Task) |
| `nuwa-cli update` | Upgrade the npm package |

### Process management

```bash
nuwa-cli start                 # daemon Gateway only
nuwa-cli start --all           # Gateway + foreground Console
nuwa-cli stop                  # stop Gateway
nuwa-cli stop --all            # stop everything
nuwa-cli restart               # force-restart Gateway (kills all old processes first)
nuwa-cli restart --all         # force-restart Gateway + Console
nuwa-cli ps                    # list running processes
```

---

## Key features

- **Inherits your environment.** No API key injection by default — engines see your existing `~/.claude` / `~/.codex` config, MCP servers, skills, and model preferences.
- **ACP protocol.** Both engines driven over [Agent Client Protocol](https://agentclientprotocol.com), not CLI text scraping.
- **Model protocol routing.** When a session supplies `model_provider`, nuwa-cli auto-selects the engine: `api_protocol: openai` → codex, `api_protocol: anthropic` → claude. See [`docs/serve-lifecycle.md`](docs/serve-lifecycle.md).
- **Cloud tunnel.** `--tunnel` registers with Nuwax backend, starts file-server + lanproxy, and exposes the local agent to the cloud. See [`docs/gateway.md`](docs/gateway.md).
- **Health checks.** file-server HTTP `/health` polling + lanproxy cloud tunnel probe after startup. See [`docs/serve-health-check.md`](docs/serve-health-check.md).
- **Cross-platform.** Windows / macOS / Linux, arm64 / x64. All spawns use `windowsHide`. `.cmd` shims auto-detected.
- **S3 distribution.** One-line installer from Nuwax S3 mirror; no GitHub or npm login needed. See [`docs/distribution-s3.md`](docs/distribution-s3.md).
- **Engine stderr logging.** All engine stderr streamed to `~/.nuwa-cli/logs/` for diagnostics.

---

## `nuwa-cli serve` API

```bash
nuwa-cli serve --port 60016
# POST /computer/chat            → { session_id }
# GET  /computer/progress/:id    SSE stream
# GET/POST /computer/agent/status
# POST /computer/agent/stop
# GET  /health                   (no auth)
```

Accepts NuwaClaw-compatible `model_provider` / `agent_config` / `context_servers`. Precedence: session config > Gateway flags > local environment. ACP `mcpServers` / `context_servers` are passed to the engine as raw stdio MCP servers; both TS adapters (`claude-code-acp-ts` / `@nuwax-ai/nuwax-codex-acp-ts`) handle ACP `mcpServers` natively at the adapter layer.

Cloud-session files are stored under:

```text
~/.nuwa-cli/workspaces/<user_id>/<agent_work_dir>/
```

Use `nuwa-cli status` to view the registered computer name and service state.

### Browsing local session files

Files generated by cloud sessions are written under the workspace directory `~/.nuwa-cli/workspaces/<user_id>/<agent_work_dir>/`:

- `<user_id>` is your numeric Nuwax user ID;
- `<agent_work_dir>` is the project ID (a numeric directory) for each session.

Both IDs are visible in `nuwa-cli status` output or in `~/.nuwa-cli/logs/serve.*.log`.

You can also list workspace directories directly from the terminal with `nuwa-cli workspaces` (supports `--user <id>`, `--json`, and `--long` to print a per-project file tree) — no need to construct the path by hand:

```bash
nuwa-cli workspaces                  # list all users / projects
nuwa-cli workspaces --user <id>      # only one user
nuwa-cli workspaces --long           # print a file tree per project
```

Open the workspace directory on each platform:

```bash
# macOS (Finder)
open ~/.nuwa-cli/workspaces

# Windows (PowerShell, File Explorer)
explorer "$env:USERPROFILE\.nuwa-cli\workspaces"

# Linux
xdg-open ~/.nuwa-cli/workspaces
```

Or list all session directories for a user from the command line:

```bash
ls -la ~/.nuwa-cli/workspaces/<user_id>/
```

nuwa-cli also runs a local **file-server** (HTTP, default port `60015`, printed at `serve`/`gateway` startup) that mirrors the same workspace layout and exposes file list / preview / upload / tar endpoints — same paths the engine writes to. While `serve` is running it is reachable at `http://127.0.0.1:60015`.

See [`docs/serve-lifecycle.md`](docs/serve-lifecycle.md) for full lifecycle, auth, and permission details.

---

## Documentation

| Doc | Content |
|---|---|
| [`docs/gateway.md`](docs/gateway.md) | Gateway architecture, tunnel, daemon, service |
| [`docs/serve-lifecycle.md`](docs/serve-lifecycle.md) | serve lifecycle, auth, permission model, model routing |
| [`docs/console.md`](docs/console.md) | Web dashboard |
| [`docs/serve-health-check.md`](docs/serve-health-check.md) | file-server + lanproxy health probes |
| [`docs/distribution-s3.md`](docs/distribution-s3.md) | S3 distribution, publish, install |
| [`docs/acp-permission-guardrails.md`](docs/acp-permission-guardrails.md) | ACP permission flow |
| [`docs/local-debugging.md`](docs/local-debugging.md) | Local dev setup |

---

## Requirements

- Node.js >= 22
- `claude` and/or `codex` CLI installed and logged in (optional when ACP supplies model config)

## Known limitations

- **Process-tree teardown**: grandchild processes (e.g. `claude` binary under `claude-code-acp-ts`) aren't signalled and may be orphaned on exit.
- **No path confinement in yolo**: `--approve auto` auto-approves all ordinary tool calls regardless of target path.
- **Prompt timeout**: 5 minutes per prompt; engine hangs produce an error instead of infinite wait.
- **MCP startup**: engines wait for MCP servers to initialize before first prompt; `npm exec` MCP servers may take minutes on first run. MCP servers are injected as raw stdio; both TS adapters handle ACP `mcpServers` natively at the adapter layer. `chrome-devtools` is always enabled by default as a raw stdio MCP (`npx -y chrome-devtools-mcp@latest`, one per session, no cross-session persistence, no `--isolated`). `@nuwax-ai/mcp-proxy-ts` remains a dependency for host adapter tool / default service merging, but is no longer used to inject a proxy entry for the engine.
- **Custom ACP engines** (pi-acp, hermes, kilo, etc.) not supported — only `claude` and `codex`.
