import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

/**
 * Stable (latest) release pipeline. Mirrors release-beta.mjs but:
 * - version must be x.y.z (no prerelease)
 * - publishes with `--tag latest` and `--ignore-scripts` (prepublishOnly
 *   asserts beta-only to prevent accidental latest publishes from beta flow)
 * - S3 channel is `stable` (also updates latest.json)
 *
 * publishConfig.tag stays `beta` in package.json by project convention —
 * the CLI `--tag latest` overrides it for this publish.
 */

const root = new URL("../", import.meta.url);
const pkg = JSON.parse(
  await readFile(new URL("package.json", root), "utf8"),
);
const packageSpec = `${pkg.name}@${pkg.version}`;
const npmRegistry = "https://registry.npmjs.org";
const mirrorRegistry = "https://registry.npmmirror.com";
const dryRun = process.argv.includes("--dry-run");

function step(number, message) {
  console.log(`\n[${number}/7] ${message}`);
}

function run(command, args, options = {}) {
  console.log(`> ${command} ${args.join(" ")}`);
  if (dryRun && options.mutating !== false) return "";
  const result = spawnSync(command, args, {
    cwd: new URL(".", root),
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(
      `${command} ${args.join(" ")} 失败（exit ${result.status}）${detail ? `：${detail}` : ""}`,
    );
  }
  return (result.stdout || "").trim();
}

function viewVersion(spec, registry) {
  const result = spawnSync(
    "npm",
    ["view", spec, "version", "--registry", registry],
    {
      cwd: new URL(".", root),
      encoding: "utf8",
      stdio: "pipe",
    },
  );
  return result.status === 0 ? (result.stdout || "").trim() : "";
}

async function waitForMirror() {
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    const exact = viewVersion(packageSpec, mirrorRegistry);
    const latest = viewVersion(`${pkg.name}@latest`, mirrorRegistry);
    if (exact === pkg.version && latest === pkg.version) {
      console.log(`npmmirror 已就绪：${packageSpec}（latest）`);
      return;
    }
    console.log(
      `npmmirror 尚未刷新（${attempt}/12，exact=${exact || "-"}，latest=${latest || "-"}）`,
    );
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error(`npmmirror 在超时前未同步到 ${packageSpec}`);
}

if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) {
  throw new Error(
    `拒绝发布：${pkg.version} 不是正式版 x.y.z 格式（勿带 -beta）。`,
  );
}

if (dryRun) {
  console.log(`Stable 发布计划：${packageSpec}`);
  console.log("1. 校验干净工作树与正式版本");
  console.log("2. 核验核心依赖 exact pin 与 registry latest 对齐");
  console.log("3. 运行完整测试/构建");
  console.log("4. 发布 npm（--tag latest，已存在则跳过）并校正 latest dist-tag");
  console.log(`5. cnpm sync ${pkg.name}`);
  console.log("6. 核验 npmmirror exact version 与 latest dist-tag");
  console.log("7. 发布 S3 tarball、stable channel 与 latest.json");
  process.exit(0);
}

step(1, "检查工作树与正式版本");
const worktree = run("git", ["status", "--porcelain"], {
  capture: true,
  mutating: false,
});
if (worktree) {
  throw new Error("拒绝发布：工作树存在未提交修改，请先 commit。");
}
console.log(`Stable 发布校验通过：${packageSpec}（tag: latest）`);

step(2, "核验核心依赖 exact pin");
run("node", ["scripts/sync-core-deps.mjs", "--check"], { mutating: false });

step(3, "运行完整测试与构建");
run("npm", ["test", "--", "--run", "--no-file-parallelism"], {
  mutating: false,
});
run("npm", ["run", "build"], { mutating: false });

step(4, "发布 npm latest");
// --ignore-scripts: prepublishOnly 只允许 beta；正式版已在上面显式 build。
if (viewVersion(packageSpec, npmRegistry) === pkg.version) {
  console.log(`npm 已存在 ${packageSpec}，跳过重复 publish。`);
} else {
  run("npm", [
    "publish",
    "--tag",
    "latest",
    "--access",
    "public",
    "--ignore-scripts",
    "--registry",
    npmRegistry,
  ]);
}
if (viewVersion(`${pkg.name}@latest`, npmRegistry) !== pkg.version) {
  run("npm", [
    "dist-tag",
    "add",
    packageSpec,
    "latest",
    "--registry",
    npmRegistry,
  ]);
}

step(5, "同步 npmmirror");
run("cnpm", ["sync", pkg.name]);

step(6, "核验 npmmirror");
await waitForMirror();

step(7, "发布 S3 stable");
run("bash", [
  "scripts/publish-s3.sh",
  "--version",
  pkg.version,
  "--channel",
  "stable",
]);

console.log(`\n发布完成：${packageSpec}（npm latest + S3 stable）`);
