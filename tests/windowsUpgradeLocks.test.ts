import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  spawnSync: vi.fn(),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawnSync: mocks.spawnSync,
  };
});

describe("Windows upgrade lock helpers", () => {
  const savedVitest = process.env.VITEST;
  let platformDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    mocks.spawnSync.mockReset();
    delete process.env.VITEST;
    platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "win32",
    });
  });

  afterEach(() => {
    if (savedVitest === undefined) delete process.env.VITEST;
    else process.env.VITEST = savedVitest;
    if (platformDescriptor) {
      Object.defineProperty(process, "platform", platformDescriptor);
    }
    vi.resetModules();
  });

  it("listRunningWindowsUpgradeLockImages reads tasklist output", async () => {
    mocks.spawnSync.mockImplementation((_cmd: string, args: string[]) => {
      const filter = args.find((a) => a.startsWith("IMAGENAME eq ")) ?? "";
      if (filter.includes("nuwax-lanproxy.exe")) {
        return {
          status: 0,
          stdout: "nuwax-lanproxy.exe               1234 Console                    1     12,345 K\n",
          stderr: "",
        };
      }
      return {
        status: 0,
        stdout: "INFO: No tasks are running which match the specified criteria.\n",
        stderr: "",
      };
    });

    const { listRunningWindowsUpgradeLockImages } =
      await import("../src/core/processes/serveSingleton.js");
    expect(listRunningWindowsUpgradeLockImages()).toEqual([
      "nuwax-lanproxy.exe",
    ]);
  });

  it("ensureWindowsUpgradeLocksReleased fails when images stay after retries", async () => {
    mocks.spawnSync.mockImplementation((cmd: string) => {
      if (cmd === "taskkill") {
        return { status: 1, stdout: "", stderr: "" };
      }
      // tasklist always reports lanproxy still up
      return {
        status: 0,
        stdout: "nuwax-lanproxy.exe               1234 Console                    1     12,345 K\n",
        stderr: "",
      };
    });

    const { ensureWindowsUpgradeLocksReleased } =
      await import("../src/core/processes/serveSingleton.js");
    const still = await ensureWindowsUpgradeLocksReleased({
      retries: 2,
      retryDelayMs: 0,
    });
    expect(still).toEqual(["nuwax-lanproxy.exe"]);
    expect(mocks.spawnSync).toHaveBeenCalledWith(
      "taskkill",
      ["/F", "/IM", "nuwax-lanproxy.exe"],
      expect.objectContaining({ windowsHide: true }),
    );
  });

  it("ensureWindowsUpgradeLocksReleased returns empty when unlocked", async () => {
    mocks.spawnSync.mockImplementation((cmd: string) => {
      if (cmd === "taskkill") {
        return { status: 0, stdout: "", stderr: "" };
      }
      return {
        status: 0,
        stdout: "INFO: No tasks are running which match the specified criteria.\n",
        stderr: "",
      };
    });

    const { ensureWindowsUpgradeLocksReleased } =
      await import("../src/core/processes/serveSingleton.js");
    await expect(
      ensureWindowsUpgradeLocksReleased({ retries: 2, retryDelayMs: 0 }),
    ).resolves.toEqual([]);
  });
});
