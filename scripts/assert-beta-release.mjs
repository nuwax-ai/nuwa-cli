import { readFile } from "node:fs/promises";

const pkg = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf-8"),
);

if (!/^\d+\.\d+\.\d+-beta\.\d+$/.test(pkg.version)) {
  throw new Error(
    `拒绝发布：当前版本 ${pkg.version} 不是 x.y.z-beta.n 格式。`,
  );
}

if (pkg.publishConfig?.tag !== "beta") {
  throw new Error(
    `拒绝发布：publishConfig.tag 必须是 beta，当前为 ${String(pkg.publishConfig?.tag)}。`,
  );
}

console.log(`Beta 发布校验通过：${pkg.name}@${pkg.version}（tag: beta）`);
