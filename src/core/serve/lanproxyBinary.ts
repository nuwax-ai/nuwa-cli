import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveBinaryPath as resolvePackageBinaryPath } from "@nuwax-ai/lanproxy";

/**
 * The default binary comes from @nuwax-ai/lanproxy, whose optional platform
 * packages let npm install only the current OS/CPU artifact. Explicit paths
 * remain supported for local development and Electron resource overrides.
 */
const RUST_TARGET_MAP: Record<string, string> = {
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "win32-x64": "x86_64-pc-windows-msvc",
  "linux-x64": "x86_64-unknown-linux-gnu",
  "linux-arm64": "aarch64-unknown-linux-gnu",
};

const LEGACY_LANPROXY_PATH_CANDIDATES = [
  () => path.join(os.homedir(), ".nuwa-cli", "lanproxy"),
  () => path.join(process.cwd(), "resources", "lanproxy"),
];

function binaryNameForCurrentPlatform(): string {
  const key = `${process.platform}-${process.arch}`;
  const target = RUST_TARGET_MAP[key];
  if (!target) {
    throw new Error(`lanproxy 暂不支持当前平台 (${key})`);
  }
  const ext = process.platform === "win32" ? ".exe" : "";
  return `nuwax-lanproxy-${target}${ext}`;
}

export function resolveLanproxyBinary(pathOverride: string): string {
  if (!fs.existsSync(pathOverride)) {
    throw new Error(`--lanproxy-path 路径不存在: ${pathOverride}`);
  }
  const stat = fs.statSync(pathOverride);
  if (stat.isFile()) return pathOverride;

  const binaryName = binaryNameForCurrentPlatform();
  const candidates = [
    path.join(pathOverride, binaryName),
    path.join(pathOverride, "binaries", binaryName),
    // macOS arm64 often ships a universal binary instead of an arm64-specific one.
    ...(process.platform === "darwin"
      ? [
          path.join(pathOverride, "nuwax-lanproxy-universal-apple-darwin"),
          path.join(
            pathOverride,
            "binaries",
            "nuwax-lanproxy-universal-apple-darwin",
          ),
        ]
      : []),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(
      `在 --lanproxy-path ${pathOverride} 下未找到 ${binaryName}（也未找到 universal 兜底）。可指向 Electron resources/lanproxy 目录或单个 nuwax-lanproxy 二进制。`,
    );
  }
  return found;
}

export function resolveDefaultLanproxyBinary(): string {
  const tried: string[] = [];
  const envOverride = process.env.NUWACLI_LANPROXY_PATH;
  if (envOverride) return resolveLanproxyBinary(envOverride);

  try {
    return resolvePackageBinaryPath();
  } catch (err) {
    tried.push(`@nuwax-ai/lanproxy: ${(err as Error).message}`);
  }

  for (const candidateFactory of LEGACY_LANPROXY_PATH_CANDIDATES) {
    const candidate = candidateFactory();
    if (!candidate) continue;
    tried.push(candidate);
    if (!fs.existsSync(candidate)) continue;
    try {
      return resolveLanproxyBinary(candidate);
    } catch {
      // Try the next conventional location.
    }
  }
  throw new Error(
    `未找到当前平台的 lanproxy 二进制。请重新运行 npm install（不要使用 --omit=optional），或通过 --lanproxy-path / NUWACLI_LANPROXY_PATH 指定二进制。已尝试：${tried.join(", ")}`,
  );
}
