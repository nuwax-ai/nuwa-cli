import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const packageDirs = [
  "./packages/lanproxy-darwin-arm64",
  "./packages/lanproxy-darwin-x64",
  "./packages/lanproxy-linux-arm64",
  "./packages/lanproxy-linux-x64",
  "./packages/lanproxy-win32-x64",
  // Publish the resolver only after every optional platform package exists.
  "./packages/lanproxy",
];

const dryRun = process.argv.includes("--dry-run");
const packages = packageDirs.map((packageDir) => ({
  packageDir,
  pkg: JSON.parse(readFileSync(`${packageDir}/package.json`, "utf8")),
}));
const resolver = packages.at(-1).pkg;
const releaseVersion = resolver.version;
if (!/^\d+\.\d+\.\d+$/.test(releaseVersion)) {
  throw new Error(`lanproxy 必须发布正式 SemVer，当前为 ${releaseVersion}`);
}
for (const { packageDir, pkg } of packages) {
  if (pkg.version !== releaseVersion) {
    throw new Error(
      `${pkg.name}@${pkg.version} 与入口包版本 ${releaseVersion} 不一致`,
    );
  }
  if (
    pkg !== resolver &&
    resolver.optionalDependencies?.[pkg.name] !== releaseVersion
  ) {
    throw new Error(
      `入口包必须精确依赖 ${pkg.name}@${releaseVersion}`,
    );
  }
  const args = [
    "publish",
    packageDir,
    "--access",
    "public",
    "--registry",
    "https://registry.npmjs.org",
  ];
  if (dryRun) args.push("--dry-run");
  console.log(`\n发布 ${pkg.name}@${pkg.version}${dryRun ? "（dry-run）" : ""}`);
  const result = spawnSync("npm", args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
