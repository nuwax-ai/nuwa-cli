# AGENTS.md — nuwa-cli

Agent guidance for `@nuwax-ai/nuwa-cli` (headless multi-engine ACP CLI: Gateway / Console / engines).

## Product boundaries

- **Runtime:** Node.js ≥ 22, TypeScript ESM, Vitest.
- **Package:** `@nuwax-ai/nuwa-cli`. npm dist-tags: `latest` (stable), `beta` (prerelease). S3 channel name `stable` ≡ npm `latest` (alias in `update` / `install --tag`).
- **Install backend:** global `npm install -g` only (no yarn / pnpm / brew installers in product paths).
- **Top-level `install`** = first-time product wizard (`npx … install`). Distinct from **`service install`** (OS autostart).
- **Upgrade:** `nuwa-cli update` (incremental path, stop-before-overlay). Do not reinvent update logic inside the install wizard.
- **ACP protocol strings stay English** (clients/engines). Human terminal UI uses i18n (`en` + `zh-CN`).

## Repo map

| Path | Role |
|------|------|
| `src/cli.ts` | Thin entry: create program + `parseAsync` |
| `src/cli/createProgram.ts` | Top-level commander tree |
| `src/cli/register*.ts` | Command registration by domain |
| `src/cli/options.ts` | Shared options / help text |
| `src/commands/*.ts` | Command business logic |
| `src/core/**` | Reusable core (ACP, auth, engines, serve, processes, …) |
| `src/util/i18n/` | `en.ts` / `zh-CN.ts` + `t()` — keys must stay in sync |
| `scripts/` | build, release, install/uninstall, S3 publish |
| `docs/` | Design & ops docs (`local-debugging.md` first for agents) |
| `site/` | Marketing landing (`site/index.html`) |
| `tests/` | Vitest unit / integration tests |

**Convention:** do not dump new commands into `src/cli.ts`. Add `register*.ts` + `commands/*.ts`. Shared flags → `options.ts`.

## Everyday commands

```bash
npm install
npm run build                 # tsc --noEmit + esbuild bundle → dist/cli.js
npm run dev:cli -- <args>     # run built CLI
npm test -- --run             # full suite (release gates on this)
npm run release:beta          # requires clean tree + x.y.z-beta.n
npm run release:stable        # requires clean tree + x.y.z; npm --tag latest
```

Local docs: [`docs/local-debugging.md`](docs/local-debugging.md), [`docs/distribution-s3.md`](docs/distribution-s3.md), [`docs/i18n.md`](docs/i18n.md).

## Coding rules

1. **Match existing style:** TypeScript ESM, `.js` import suffixes, detailed comments where non-obvious (especially Windows / process / upgrade paths).
2. **i18n:** every new user-facing string → `en.ts` **and** `zh-CN.ts` (same keys). ACP / protocol payloads: English only.
3. **Windows upgrades:** never recommend bare `npm i -g` while Gateway/tunnels run; prefer `nuwa-cli update` / stop-before-install (`upgradeStop.ts`). Vendor locks: `nuwax-lanproxy.exe`, `nuwax-codex.exe`.
4. **Tests:** prefer Vitest with injectable runners / mocks; `stopRuntimeProcessesForUpdate` is a no-op under `VITEST`.
5. **Docs / site:** product install entry is `npx @nuwax-ai/nuwa-cli@latest install` (no `-y` for humans). Automation: `npx -y … install --yes`. Upgrade: `nuwa-cli update`.
6. **Scope:** smallest change that solves the task. Don’t expand into unrelated refactors or extra markdown unless asked.
7. **Commits:** only when the user asks. No `Co-authored-by` trailers. Prefer clear Chinese or conventional messages consistent with recent history.
8. **Release:** worktree must be clean. Beta first (`publishConfig.tag` stays `beta`); stable uses `release:stable` (`--tag latest --ignore-scripts`). Do not invent a npm `stable` dist-tag.

## Safety

- Do not exfiltrate credentials (`~/.nuwa-cli`, env secrets). Strip secrets from env passed to npm (see `buildPackageManagerEnv`).
- No destructive git (`push --force`, hard reset) unless explicitly requested.
- Prefer `trash` over irreversible `rm` for user files when deleting outside the build tree.

## When unsure

- Prefer reading `docs/local-debugging.md` and neighboring modules over inventing new architecture.
- Ask before publishing, pushing, or changing release/publishConfig pipelines.
