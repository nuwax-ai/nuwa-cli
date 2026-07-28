import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  spawnSync: vi.fn(),
  whichSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawnSync: mocks.spawnSync,
}));

vi.mock("which", () => ({
  default: { sync: mocks.whichSync },
}));

describe("update command", () => {
  beforeEach(() => {
    mocks.spawnSync.mockReset();
    mocks.spawnSync.mockImplementation(() => ({ status: 0, stdout: "" }));
    mocks.whichSync.mockReset();
    mocks.whichSync.mockReturnValue("npm");
  });

  afterEach(() => {
    process.exitCode = 0;
    vi.restoreAllMocks();
  });

  it("normalizes update targets and install args", async () => {
    const { normalizeUpdateTarget, buildInstallArgs } =
      await import("../src/commands/update.js");
    expect(normalizeUpdateTarget()).toBe("beta");
    expect(normalizeUpdateTarget("v0.2.0")).toBe("0.2.0");
    expect(buildInstallArgs("@nuwax-ai/nuwa-cli@beta")).toEqual([
      "install",
      "-g",
      "@nuwax-ai/nuwa-cli@beta",
    ]);
    expect(
      buildInstallArgs("@nuwax-ai/nuwa-cli@0.2.0", "https://r.example"),
    ).toEqual([
      "install",
      "-g",
      "@nuwax-ai/nuwa-cli@0.2.0",
      "--registry",
      "https://r.example",
    ]);
  });

  it("prints the install command without running it in dry-run mode", async () => {
    const { updateCommand } = await import("../src/commands/update.js");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const runner = vi.fn(() => ({ status: 0 }));

    await updateCommand("0.2.0", { dryRun: true }, runner);

    expect(runner).not.toHaveBeenCalled();
    const printed = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(printed).toContain("升级目标：@nuwax-ai/nuwa-cli@0.2.0");
    expect(printed).toContain("执行：npm install -g @nuwax-ai/nuwa-cli@0.2.0");
  });

  it("checks a remote version without installing", async () => {
    const { updateCommand } = await import("../src/commands/update.js");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const runner = vi.fn(() => ({ status: 0, stdout: "0.2.0\n" }));

    await updateCommand(undefined, { check: true }, runner);

    expect(runner).toHaveBeenCalledWith(
      "npm",
      ["view", "@nuwax-ai/nuwa-cli@beta", "version"],
      expect.objectContaining({ stdio: "pipe" }),
    );
    const printed = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(printed).toContain("@nuwax-ai/nuwa-cli@beta：0.2.0");
  });

  it("ignores Commander's third action argument instead of treating it as a runner", async () => {
    mocks.spawnSync.mockImplementation((command: string, args: string[]) => {
      if (args[0] === "view") {
        return { status: 0, stdout: "0.1.1\n" };
      }
      return { status: 0, stdout: "" };
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { updateCommand } = await import("../src/commands/update.js");

    await updateCommand(undefined, { check: true }, {
      name: () => "update",
    } as never);

    expect(process.exitCode).toBe(0);
    expect(mocks.spawnSync).toHaveBeenCalledWith(
      "npm",
      ["view", "@nuwax-ai/nuwa-cli@beta", "version"],
      expect.objectContaining({ stdio: "pipe" }),
    );
  });

  it("runs --check through the real Commander action", async () => {
    mocks.spawnSync.mockImplementation((command: string, args: string[]) => {
      if (command === "which") return { status: 0, stdout: `${args[0]}\n` };
      if (args[0] === "view") {
        return { status: 0, stdout: "0.1.0-beta.1\n" };
      }
      return { status: 0, stdout: "" };
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { createProgram } = await import("../src/cli/createProgram.js");

    await createProgram().parseAsync(["node", "nuwa-cli", "update", "--check"]);

    expect(mocks.spawnSync).toHaveBeenCalledWith(
      "npm",
      ["view", "@nuwax-ai/nuwa-cli@beta", "version"],
      expect.objectContaining({ stdio: "pipe" }),
    );
  });

  it("runs global install through npm", async () => {
    const { updateCommand } = await import("../src/commands/update.js");
    vi.spyOn(console, "log").mockImplementation(() => {});
    const runner = vi.fn(() => ({ status: 0 }));

    await updateCommand(undefined, {}, runner);

    expect(runner).toHaveBeenCalledWith(
      "npm",
      ["install", "-g", "@nuwax-ai/nuwa-cli@beta"],
      expect.objectContaining({ stdio: "inherit" }),
    );
  });

  it("runs npm-cli.js directly on Windows when npm resolves to a .cmd shim", async () => {
    const realPlatform = process.platform;
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });
    mocks.whichSync.mockReturnValue("C:\\Program Files\\nodejs\\npm.cmd");
    mocks.spawnSync.mockReset();
    mocks.spawnSync.mockImplementation(() => ({ status: 0, stdout: "" }));
    vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const { updateCommand } = await import("../src/commands/update.js");
      await updateCommand(undefined, {});
      expect(mocks.spawnSync).toHaveBeenCalledWith(
        process.execPath,
        [
          "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js",
          "install",
          "-g",
          "@nuwax-ai/nuwa-cli@beta",
        ],
        expect.objectContaining({ stdio: "inherit" }),
      );
    } finally {
      Object.defineProperty(process, "platform", {
        value: realPlatform,
        configurable: true,
      });
    }
  });
});
