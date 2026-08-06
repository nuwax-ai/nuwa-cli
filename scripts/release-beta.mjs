import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

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
    const beta = viewVersion(`${pkg.name}@beta`, mirrorRegistry);
    if (exact === pkg.version && beta === pkg.version) {
      console.log(`npmmirror 已就绪：${packageSpec}（beta）`);
      return;
    }
    console.log(
      `npmmirror 尚未刷新（${attempt}/12，exact=${exact || "-"}，beta=${beta || "-"}）`,
    );
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error(`npmmirror 在超时前未同步到 ${packageSpec}`);
}

if (!/^\d+\.\d+\.\d+-beta\.\d+$/.test(pkg.version)) {
  throw new Error(`拒绝发布：${pkg.version} 不是 x.y.z-beta.n 格式。`);
}
if (pkg.publishConfig?.tag !== "beta") {
  throw new Error("拒绝发布：publishConfig.tag 必须为 beta。");
}

if (dryRun) {
  console.log(`Beta 发布计划：${packageSpec}`);
  console.log("1. 校验干净工作树与 beta 版本");
  console.log("2. 核验核心依赖 exact pin 与 registry latest 对齐");
  console.log("3. 运行完整测试/构建");
  console.log("4. 发布 npm（已存在则跳过）并校正 beta dist-tag");
  console.log(`5. cnpm sync ${pkg.name}`);
  console.log("6. 核验 npmmirror exact version 与 beta dist-tag");
  console.log("7. 发布 S3 tarball、channel 和安装脚本");
  process.exit(0);
}

step(1, "检查工作树与 beta 版本");
const worktree = run("git", ["status", "--porcelain"], {
  capture: true,
  mutating: false,
});
if (worktree) {
  throw new Error("拒绝发布：工作树存在未提交修改，请先 commit。");
}
run("node", ["scripts/assert-beta-release.mjs"], { mutating: false });

step(2, "核验核心依赖 exact pin");
run("node", ["scripts/sync-core-deps.mjs", "--check"], { mutating: false });

step(3, "运行完整测试与构建");
run("npm", ["test", "--", "--run"], { mutating: false });
run("npm", ["run", "build"], { mutating: false });

step(4, "发布 npm beta");
if (viewVersion(packageSpec, npmRegistry) === pkg.version) {
  console.log(`npm 已存在 ${packageSpec}，跳过重复 publish。`);
} else {
  run(
    "npm",
    [
      "publish",
      "--tag",
      "beta",
      "--access",
      "public",
      "--registry",
      npmRegistry,
    ],
  );
}
if (viewVersion(`${pkg.name}@beta`, npmRegistry) !== pkg.version) {
  run("npm", [
    "dist-tag",
    "add",
    packageSpec,
    "beta",
    "--registry",
    npmRegistry,
  ]);
}

step(5, "同步 npmmirror");
run("cnpm", ["sync", pkg.name]);

step(6, "核验 npmmirror");
await waitForMirror();

step(7, "发布 S3 beta");
run("bash", [
  "scripts/publish-s3.sh",
  "--version",
  pkg.version,
  "--channel",
  "beta",
]);

console.log(`\n发布完成：${packageSpec}`);
