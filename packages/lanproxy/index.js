import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

const PLATFORM_PACKAGES = Object.freeze({
  "darwin-arm64": "@nuwax-ai/lanproxy-darwin-arm64",
  "darwin-x64": "@nuwax-ai/lanproxy-darwin-x64",
  "linux-arm64": "@nuwax-ai/lanproxy-linux-arm64",
  "linux-x64": "@nuwax-ai/lanproxy-linux-x64",
  "win32-x64": "@nuwax-ai/lanproxy-win32-x64",
});

export const supportedPlatforms = Object.freeze(
  Object.keys(PLATFORM_PACKAGES),
);

export function packageNameForPlatform(
  platform = process.platform,
  arch = process.arch,
) {
  return PLATFORM_PACKAGES[`${platform}-${arch}`];
}

export function resolveBinaryPath(
  platform = process.platform,
  arch = process.arch,
) {
  const key = `${platform}-${arch}`;
  const packageName = packageNameForPlatform(platform, arch);
  if (!packageName) {
    throw new Error(
      `@nuwax-ai/lanproxy 暂不支持当前平台 (${key})；支持：${supportedPlatforms.join(", ")}`,
    );
  }

  let packageJson;
  try {
    packageJson = require.resolve(`${packageName}/package.json`);
  } catch (error) {
    // The platform packages are intentionally not root npm workspaces because
    // npm rejects incompatible os/cpu workspaces. This sibling lookup is only
    // reachable in the source monorepo; published consumers resolve the
    // matching optionalDependency above.
    const localPackageJson = new URL(
      `../lanproxy-${platform}-${arch}/package.json`,
      import.meta.url,
    );
    if (fs.existsSync(localPackageJson)) {
      packageJson = fileURLToPath(localPackageJson);
    } else {
      throw new Error(
        `缺少 ${packageName}。请重新运行 npm install，且不要使用 --omit=optional。`,
        { cause: error },
      );
    }
  }

  const binaryName = platform === "win32" ? "nuwax-lanproxy.exe" : "nuwax-lanproxy";
  const binaryPath = path.join(path.dirname(packageJson), "bin", binaryName);
  if (!fs.existsSync(binaryPath)) {
    throw new Error(`${packageName} 中缺少二进制文件：${binaryPath}`);
  }
  return binaryPath;
}
