# @nuwax-ai/agent-kit

Shared logic for `@nuwax-ai/nuwa-cli` and `@nuwax-ai/nuwaclaw`. The single place
to maintain the agent/ACP behaviour both hosts need, so they stay in lockstep.

**Boundary principle.** agent-kit holds *isomorphic primitives + shared-package
adapters*. Hosts keep *process model + env strategy + lifecycle + product
extensions*. Concretely: agent-kit depends on **no** host runtime package — the
codex adapter is a `require.resolve`'d `peerDependency`, and the MCP bridge is
**injected** (`@nuwax-ai/mcp-proxy-ts` is never imported here).

## Status

Shared slices, dual-format (ESM + CJS) build:

- codex engine resolution
- file-server / lanproxy health polling
- `PersistentMcpBridge` singleton lifecycle

## Exports

### Engine resolution (`src/index.ts`)
- `resolvePackageEntry(packageName, entrySpecifier)` — `require.resolve` a dependency entry (ESM+CJS safe via `createRequire(import.meta.url)` + tsup shims).
- `resolveCodexAcp({ entryOverride? })` — resolve the codex ACP adapter (`@nuwax-ai/nuwax-codex-acp-ts`) to a spawn target `{ command, args }`. `entryOverride` is for hosts that bundle the adapter by a non-`require.resolve` mechanism (e.g. nuwaclaw's Electron `resources/`); defaults to `require.resolve` for npm-installed hosts (nuwa-cli).
- `EngineResolution` — type (`{ command; args; envOverlay? }`), structurally compatible with nuwa-cli's `ResolvedEngine`.

### Health primitives (`src/health.ts`)
- `waitForFileServerHealth({ port, fetchImpl?, signal?, … })` — poll `GET /health` until ok / timeout / abort.
- `waitForLanproxyTunnel({ domain, configKey, fetchImpl?, signal?, … })` — poll the cloud tunnel health endpoint.
- `isLanproxyTunnelEnvelopeHealthy(envelope)` — pure predicate; `LANPROXY_OK_CODE` (`"0000"`) exported for the magic code.
- `confirmProcessHealthy({ pid, isAlive, … })` — process liveness across a stabilize window.
- `delay(ms, signal?)` — abortable sleep.

Host differences (`fetch` vs `http.request`; `isPidAlive` vs `process.kill(0)`) are injected via `fetchImpl` / `isAlive`.

### Persistent bridge (`src/proxyBridge.ts`)
- `createPersistentBridge({ create, logger, … })` — manage one bridge across config changes. Returns a handle with `ensureStarted(servers)` / `stop()` / `isRunning()`.

> **Contract:** the injected bridge's `start(servers)` MUST be idempotent / diff-aware.
> `ensureStarted` forwards every call to `start` (no internal dedup); the host calls it
> on every MCP rewrite, so change-detection lives in the bridge. nuwa-cli's
> `PersistentMcpBridge` satisfies this; a host whose `start` is not idempotent must diff
> before calling `ensureStarted`.

`createPersistentBridge` is generic over the concrete bridge type, so `ensureStarted`'s
parameter is type-checked against exactly what the injected bridge's `start` accepts —
no `any` / host-side casts, and agent-kit still names no host type.

## Build

```
npm run build   # tsup → dist/index.js (esm) + dist/index.cjs (cjs) + dist/index.d.ts
```

The dual-format build is guarded by `tests/agentKit.test.ts`, which `require()`s
`dist/index.cjs` — that is nuwaclaw's consumption path. A vitest `globalSetup`
builds the artifact if missing.

## Requirements

- Node `>= 20.3` (uses `AbortSignal.any`, available since 20.3). Both hosts run Node 22+.
- `@nuwax-ai/nuwax-codex-acp-ts` is a **peerDependency** — the host must provide it.
