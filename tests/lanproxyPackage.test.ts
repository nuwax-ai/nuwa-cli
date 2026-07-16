import * as fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  packageNameForPlatform,
  resolveBinaryPath,
  supportedPlatforms,
} from "@nuwax-ai/lanproxy";

describe("@nuwax-ai/lanproxy", () => {
  it("maps every supported OS/CPU pair to a platform package", () => {
    expect(supportedPlatforms).toEqual([
      "darwin-arm64",
      "darwin-x64",
      "linux-arm64",
      "linux-x64",
      "win32-x64",
    ]);
    expect(packageNameForPlatform("linux", "x64")).toBe(
      "@nuwax-ai/lanproxy-linux-x64",
    );
  });

  it("rejects unsupported platforms clearly", () => {
    expect(() => resolveBinaryPath("freebsd", "arm64")).toThrow(
      /暂不支持当前平台/,
    );
  });

  it("resolves the current platform binary", () => {
    const binary = resolveBinaryPath();
    expect(fs.existsSync(binary)).toBe(true);
    if (process.platform !== "win32") {
      expect(fs.statSync(binary).mode & 0o111).not.toBe(0);
    }
  });
});
