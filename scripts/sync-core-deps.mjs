/**
 * 同步 nuwa-cli 的「核心运行时依赖」到 registry 目标通道。
 *
 * 约定（CLI 发布即兼容单元）：
 * - 这 5 个包在 package.json 里必须用精确版本（exact pin），不能用 ^/~。
 * - 核心包各自独立 semver；关系靠「某版 nuwa-cli 锁定的一组 pin」表达。
 * - 用户只升 nuwa-cli，不单独升这些子依赖。
 *
 * 用法：
 *   node scripts/sync-core-deps.mjs --check [--tag latest]
 *   node scripts/sync-core-deps.mjs --apply [--tag latest] [--dry-run]
 *   node scripts/sync-core-deps.mjs --dry-run   # 等价于 --apply --dry-run
 *
 * 退出码：有落后 / 非 exact / major 待人工处理时 --check 返回 1。
 */

import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

/** 核心运行时依赖清单（不含 agent-kit 等共享库）。 */
const CORE_DEPS = [
  "@nuwax-ai/lanproxy",
  "@nuwax-ai/mcp-proxy-ts",
  "nuwax-file-server",
  "claude-code-acp-ts",
  "@nuwax-ai/nuwax-codex-acp-ts",
];

const root = new URL("../", import.meta.url);
const packageJsonUrl = new URL("package.json", root);
const argv = process.argv.slice(2);

const wantCheck = argv.includes("--check");
const wantApply = argv.includes("--apply");
/** 单独 `--dry-run` 视为 apply 预览；可与 `--apply` 组合。 */
const dryRun = argv.includes("--dry-run");
const tag = readFlagValue("--tag") ?? "latest";

function readFlagValue(flag) {
  const idx = argv.indexOf(flag);
  if (idx === -1) return undefined;
  const value = argv[idx + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`${flag} 需要一个参数（例如 ${flag} latest）`);
  }
  return value;
}

function usageAndExit(code = 1) {
  console.error(`用法:
  node scripts/sync-core-deps.mjs --check [--tag <dist-tag>]
  node scripts/sync-core-deps.mjs --apply [--tag <dist-tag>] [--dry-run]
  node scripts/sync-core-deps.mjs --dry-run [--tag <dist-tag>]

核心依赖（exact pin）:
  ${CORE_DEPS.join("\n  ")}
`);
  process.exit(code);
}

/** 解析 npm 版本字符串为 [major, minor, patch]；预发后缀忽略，只比核心三段。 */
function parseSemverCore(version) {
  const match = String(version)
    .trim()
    .match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** @returns {-1|0|1|null} null 表示无法比较 */
function compareSemver(a, b) {
  const pa = parseSemverCore(a);
  const pb = parseSemverCore(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] < pb[i]) return -1;
    if (pa[i] > pb[i]) return 1;
  }
  return 0;
}

function isExactPin(range) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(String(range).trim());
}

/** 从 ^1.2.3 / ~1.2.3 / 1.2.3 等声明里抽出可比较的版本核。 */
function declaredVersionCore(range) {
  const match = String(range)
    .trim()
    .match(/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/);
  return match ? match[1] : "";
}

function npmViewVersion(name, distTag) {
  const result = spawnSync(
    "npm",
    ["view", `${name}@${distTag}`, "version"],
    {
      cwd: new URL(".", root),
      encoding: "utf8",
      stdio: "pipe",
    },
  );
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(
      `无法查询 ${name}@${distTag}${detail ? `：${detail}` : ""}`,
    );
  }
  return (result.stdout || "").trim();
}

function runNpmInstall() {
  console.log("> npm install");
  const result = spawnSync("npm", ["install"], {
    cwd: new URL(".", root),
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`npm install 失败（exit ${result.status}）`);
  }
}

/**
 * 对每个核心依赖收集：当前声明、远端目标、是否 exact、是否落后、是否跨 major。
 */
function collectStatuses(pkg) {
  const deps = pkg.dependencies ?? {};
  /** @type {Array<{
   *   name: string,
   *   declared: string,
   *   declaredCore: string,
   *   remote: string,
   *   exact: boolean,
   *   cmp: number|null,
   *   majorBump: boolean,
   * }>} */
  const rows = [];
  for (const name of CORE_DEPS) {
    const declared = deps[name];
    if (declared == null) {
      throw new Error(`package.json dependencies 缺少核心依赖 ${name}`);
    }
    const remote = npmViewVersion(name, tag);
    const declaredCore = declaredVersionCore(declared);
    const exact = isExactPin(declared);
    const cmp = compareSemver(declaredCore, remote);
    const declaredMajor = parseSemverCore(declaredCore)?.[0];
    const remoteMajor = parseSemverCore(remote)?.[0];
    const majorBump =
      declaredMajor != null &&
      remoteMajor != null &&
      remoteMajor > declaredMajor;
    rows.push({
      name,
      declared: String(declared),
      declaredCore,
      remote,
      exact,
      cmp,
      majorBump,
    });
  }
  return rows;
}

function printTable(rows) {
  console.log(`通道: ${tag}`);
  console.log(
    "包名".padEnd(36) +
      "声明".padEnd(16) +
      "远端".padEnd(16) +
      "状态",
  );
  console.log("-".repeat(80));
  for (const row of rows) {
    let status = "ok";
    if (!row.exact) status = "非 exact";
    else if (row.cmp === null) status = "无法比较";
    else if (row.majorBump) status = "major 落后（需人工）";
    else if (row.cmp < 0) status = "落后";
    else if (row.cmp > 0) status = "声明新于远端";
    console.log(
      row.name.padEnd(36) +
        row.declared.padEnd(16) +
        row.remote.padEnd(16) +
        status,
    );
  }
}

function hasCheckFailures(rows) {
  return rows.some(
    (row) =>
      !row.exact ||
      row.cmp === null ||
      row.cmp < 0 ||
      row.majorBump,
  );
}

async function main() {
  if (!wantCheck && !wantApply && !dryRun) {
    usageAndExit(1);
  }
  if (wantCheck && (wantApply || dryRun)) {
    console.error("不能同时指定 --check 与 --apply/--dry-run");
    usageAndExit(1);
  }

  const pkgRaw = await readFile(packageJsonUrl, "utf8");
  const pkg = JSON.parse(pkgRaw);
  const rows = collectStatuses(pkg);
  printTable(rows);

  // 仅检查：非 exact、同 major 落后、或存在更新的 major 都失败
  if (wantCheck) {
    if (hasCheckFailures(rows)) {
      console.error(
        "\n核心依赖未对齐。请阅读 changelog 后执行：\n  npm run sync:core-deps -- --apply",
      );
      console.error(
        "跨 major 时 apply 会跳过该包，需人工改 pin 并验证后再发布。",
      );
      process.exit(1);
    }
    console.log("\n核心依赖已与通道对齐（exact pin）。");
    return;
  }

  // apply 或 dry-run：钉到目标通道；跨 major 只报告不自动升
  let changed = 0;
  let skippedMajor = 0;
  for (const row of rows) {
    if (row.majorBump) {
      console.log(
        `跳过 major：${row.name} ${row.declared} -> ${row.remote}（需人工确认）`,
      );
      skippedMajor += 1;
      // 仍把非 exact 的当前 major 声明钉成 exact（不升到新 major）
      if (!row.exact && row.declaredCore) {
        const next = row.declaredCore;
        console.log(
          `${dryRun ? "[dry-run] " : ""}钉死（不升 major）：${row.name} ${row.declared} -> ${next}`,
        );
        if (!dryRun) pkg.dependencies[row.name] = next;
        changed += 1;
      }
      continue;
    }

    const target = row.remote;
    if (row.exact && row.declared === target) continue;

    console.log(
      `${dryRun ? "[dry-run] " : ""}更新：${row.name} ${row.declared} -> ${target}`,
    );
    if (!dryRun) pkg.dependencies[row.name] = target;
    changed += 1;
  }

  if (changed === 0) {
    console.log(
      skippedMajor
        ? "\n无需写入（仅有需人工处理的 major 落后）。"
        : "\n无需更新，核心依赖已是目标 exact pin。",
    );
    if (skippedMajor > 0) process.exit(1);
    return;
  }

  if (dryRun) {
    console.log(
      `\n[dry-run] 将改动 ${changed} 个依赖；跳过写入与 npm install。`,
    );
    if (skippedMajor > 0) process.exit(1);
    return;
  }

  // 保持原文件末尾换行风格
  const trailingNewline = pkgRaw.endsWith("\n") ? "\n" : "";
  await writeFile(
    packageJsonUrl,
    `${JSON.stringify(pkg, null, 2)}${trailingNewline}`,
    "utf8",
  );
  console.log(`已写入 package.json（${changed} 处）。`);
  runNpmInstall();
  console.log("完成：核心依赖已钉到目标通道版本。");
  if (skippedMajor > 0) {
    console.error(`另有 ${skippedMajor} 个 major 升级被跳过，请人工处理。`);
    process.exit(1);
  }
}

try {
  await main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
