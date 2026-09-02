# AGENTS.md — nuwa-cli

Agent guidance for `@nuwax-ai/nuwa-cli` (headless multi-engine ACP CLI: Gateway / Console / engines).

## Product boundaries

- **Runtime:** Node.js ≥ 22, TypeScript ESM, Vitest.
- **Package:** `@nuwax-ai/nuwa-cli`. npm dist-tags: `latest` (stable), `beta` (prerelease). S3 channel name `stable` ≡ npm `latest` (alias in `update` / `install --tag`).
- **Install backend:** global `npm install -g` only (no yarn / pnpm / brew installers in product paths).
- **Top-level `install`** = first-time product wizard (`npx … install` → package + login/start). Distinct from **`service install`** (OS autostart).
- **Top-level `uninstall`** = remove global package (`npx … uninstall`). Keeps `~/.nuwa-cli` by default; `--purge` deletes user data. Distinct from **`service uninstall`**.
- **Upgrade:** `nuwa-cli update` only (incremental, stop-before-overlay, logged-in restart). S3 scripts: not installed → tarball + `install --yes --bootstrap`; already installed → `update <version> --yes`. See [`docs/install-upgrade-split.md`](docs/install-upgrade-split.md).
- **Do not** reinvent update stop/lock/restart logic inside parallel S3 overlay paths.
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

Local docs: [`docs/local-debugging.md`](docs/local-debugging.md), [`docs/distribution-s3.md`](docs/distribution-s3.md), [`docs/install-upgrade-split.md`](docs/install-upgrade-split.md), [`docs/i18n.md`](docs/i18n.md).

## Coding rules

1. **Match existing style:** TypeScript ESM, `.js` import suffixes, detailed comments where non-obvious (especially Windows / process / upgrade paths).
2. **i18n:** every new user-facing string → `en.ts` **and** `zh-CN.ts` (same keys). ACP / protocol payloads: English only.
3. **Windows upgrades:** never recommend bare `npm i -g` while Gateway/tunnels run; prefer `nuwa-cli update` / stop-before-install (`upgradeStop.ts`). Vendor locks: `nuwax-lanproxy.exe`, `nuwax-codex.exe`.
4. **Tests:** prefer Vitest with injectable runners / mocks; `stopRuntimeProcessesForUpdate` is a no-op under `VITEST`.
5. **Docs / site:** product install entry is `npx @nuwax-ai/nuwa-cli@latest install` (no `-y` for humans). Automation: `npx -y … install --yes`. Upgrade: `nuwa-cli update`. S3 = mirror entry with the same new/upgrade split.
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

<!-- nuwa-sdlc-kit:begin v1（安装器托管区间，勿手工增删行；本节外的 AGENTS.md 内容归仓库所有） -->

## AI SDLC 规则层

- 需求→规格→计划链：skills `requirement-analysis` → `plans/*-intent.md`、`grill-with-docs` → `specs/<slug>.md` → Plan mode 产物 `plans/*-plan.md`（模板在 `templates/`）。
- 源码首改会被 `.claude/hooks/plan-gate.mjs` 追问一次计划工件（同会话只问一次；`NUWACLAW_SKIP_PLAN_GATE=1` 停用）；秘钥由 `.claude/hooks/guard-paths.mjs` 拦截（`.env*`/证书/credential 类拒读写，example 豁免）。
- PR 评审对照根目录 `REVIEW.md` 五遍清单（nit≤5；writer 不自批）。
- **单一事实源**：本文件是正文（根 CLAUDE.md 已存在，建议人工收敛为单行 `@AGENTS.md` 指针）；勿复制出第二份。

### 非 Claude Code agent 兼容

- 本文件、`templates/`、`REVIEW.md`、skills 正文全是纯 markdown：codex / opencode / cursor 等**直接读即可**；需要某条流程时让 agent `cat .claude/skills/<name>/SKILL.md` 照做。
- 强制机制差异：PreToolUse hooks 仅 Claude Code 执行；其他 agent 的兜底 = 提交前按同一规则自查，非协商护栏建议下沉 git pre-commit / CI（agent 无关的强制地板）。
- verifier 等价物：任何 agent 跑 `npm run test:run` 按报告格式贴结论即可，不必有子代理机制。

<!-- nuwa-sdlc-kit:end -->
