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

## AI SDLC 规则层（slim）

- **小修直接改**：BUG 修复、小调整按行为风险判断，改前一句话说清「改什么、为什么」，改完跑受影响测试（入口：`npm run test:run`），不生成计划/规格工件，不按文件数量升级流程。
- **复杂需求最多一份计划**：跨模块、新契约或需拍板的需求，用 `templates/plan.md` 在 `plans/` 维护一份计划（已有计划直接更新）；不建 intent/spec 链。
- **按风险投入**：已覆盖路径的小修不强制新增测试，不为走流程写文档；重构可用已有测试或产物对比证明等价。
- **合并前查一遍**：大量代码合入主干前按 `REVIEW.md` 清单检查一次整个待合并批次；日常小 commit 不要求。
- **地板（hooks 强制，agent 无关）**：秘钥/受保护路径由 `.claude/hooks/guard-paths.mjs` 拦截（`.env*`/证书/credential 类拒读写，example 豁免）；发布/破坏性命令由 `.claude/hooks/deploy-gate.mjs` 分带拦截（force push 硬禁，发布类需 `NUWACLAW_APPROVE_DEPLOY=1` 批准，带配见 `.sdlc.json` deployGate）。
- **单一事实源**：本文件是正文（根 CLAUDE.md 已存在，建议人工收敛为单行 `@AGENTS.md` 指针）；勿复制出第二份。
- **非 Claude Code agent 兼容**：hooks 在 Claude Code 与 ZCode 均强制；codex / opencode / cursor 读本文件即可，规则即全部文字，无隐藏要求。

<!-- nuwa-sdlc-kit:end -->
