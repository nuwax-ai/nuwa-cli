import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  spawnSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawnSync: mocks.spawnSync,
}));

const realPlatform = process.platform;
function setPlatform(platform: string) {
  Object.defineProperty(process, "platform", {
    value: platform,
    configurable: true,
  });
}

describe("which helpers", () => {
  beforeEach(() => {
    mocks.spawnSync.mockReset();
    mocks.spawnSync.mockReturnValue({ status: 0, stdout: "", stderr: "" });
  });

  afterEach(() => {
    setPlatform(realPlatform);
    vi.restoreAllMocks();
  });

  describe("isBatchShim", () => {
    it("flags .cmd/.bat paths only on win32", async () => {
      const { isBatchShim } = await import("../src/util/which.js");
      setPlatform("win32");
      expect(isBatchShim("C:\\nodejs\\npm.cmd")).toBe(true);
      expect(isBatchShim("C:\\nodejs\\npm.CMD")).toBe(true);
      expect(isBatchShim("C:\\nodejs\\npm.bat")).toBe(true);
      expect(isBatchShim("C:\\nodejs\\npm.exe")).toBe(false);
      setPlatform("darwin");
      expect(isBatchShim("/usr/local/bin/npm.cmd")).toBe(false);
    });
  });

  describe("getVersion", () => {
    it("spawns a real binary without a shell", async () => {
      mocks.spawnSync.mockReturnValue({ status: 0, stdout: "1.2.3\n" });
      const { getVersion } = await import("../src/util/which.js");
      setPlatform("darwin");

      getVersion("/usr/local/bin/node");

      expect(mocks.spawnSync).toHaveBeenCalledWith(
        "/usr/local/bin/node",
        ["--version"],
        expect.not.objectContaining({ shell: true }),
      );
    });

    it("spawns a .cmd shim through a shell on win32", async () => {
      mocks.spawnSync.mockReturnValue({ status: 0, stdout: "1.2.3\n" });
      const { getVersion } = await import("../src/util/which.js");
      setPlatform("win32");

      getVersion("C:\\nodejs\\npm.cmd");

      expect(mocks.spawnSync).toHaveBeenCalledWith(
        "C:\\nodejs\\npm.cmd",
        ["--version"],
        expect.objectContaining({ shell: true }),
      );
    });
  });
});
