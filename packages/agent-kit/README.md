# @nuwax-ai/agent-kit

Shared agent/ACP logic for `@nuwax-ai/nuwa-cli` and `@nuwax-ai/nuwaclaw`, to avoid
duplicating engine-resolution and (later) agent-install logic across the two hosts.

## Status

PoC — first slice only: **codex engine resolution**.

## Exports

- `resolvePackageEntry(packageName, entrySpecifier)` — `require.resolve` a dependency entry (ESM+CJS safe).
- `resolveCodexAcp()` — resolve the codex ACP adapter (`@nuwax-ai/nuwax-codex-acp-ts`) to a spawn target `{ command, args }`.
- `EngineResolution` — type (`{ command; args; envOverlay? }`), structurally compatible with nuwa-cli's `ResolvedEngine`.

## Build

```
npm run build   # tsup → dist/index.js (esm) + dist/index.cjs (cjs) + dist/index.d.ts
```

`@nuwax-ai/nuwax-codex-acp-ts` is a **peerDependency** — the host must provide it.
