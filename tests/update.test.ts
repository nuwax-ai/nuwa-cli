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
      "--progress=true",
    ]);
    expect(
      buildInstallArgs("@nuwax-ai/nuwa-cli@0.2.0", "https://r.example"),
    ).toEqual([
      "install",
      "-g",
      "@nuwax-ai/nuwa-cli@0.2.0",
      "--progress=true",
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
    expect(printed).toContain("Upgrade target: @nuwax-ai/nuwa-cli@0.2.0");
    expect(printed).toContain(
      "Run: npm install -g @nuwax-ai/nuwa-cli@0.2.0 --progress=true",
    );
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
    expect(printed).toContain("@nuwax-ai/nuwa-cli@beta: 0.2.0");
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
      ["install", "-g", "@nuwax-ai/nuwa-cli@beta", "--progress=true"],
      expect.objectContaining({ stdio: "inherit" }),
    );
  });

  it("does not reinstall when the selected channel already matches the current version", async () => {
    const { updateCommand } = await import("../src/commands/update.js");
    const { CLI_VERSION } = await import("../src/core/version.js");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const runner = vi.fn(() => ({
      status: 0,
      stdout: `${CLI_VERSION}\n`,
    }));

    await updateCommand(undefined, {}, runner);

    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner).toHaveBeenCalledWith(
      "npm",
      ["view", "@nuwax-ai/nuwa-cli@beta", "version"],
      expect.objectContaining({ stdio: "pipe" }),
    );
    expect(logSpy.mock.calls.flat().join("\n")).toContain(
      "Already the latest version; no reinstall needed",
    );
  });

  it("compareSemver orders versions, stable-vs-prerelease, and numeric prereleases", async () => {
    const { compareSemver } = await import("../src/commands/update.js");
    expect(compareSemver("0.1.0", "0.0.0")).toBeGreaterThan(0);
    // stable (0.2.0) must outrank an older beta prerelease — the regression fix
    expect(compareSemver("0.2.0", "0.1.0-beta.55")).toBeGreaterThan(0);
    expect(compareSemver("0.1.0-beta.55", "0.1.0")).toBeLessThan(0);
    // numeric prerelease comparison (not lexicographic): 55 > 6
    expect(compareSemver("0.1.0-beta.55", "0.1.0-beta.6")).toBeGreaterThan(0);
    expect(compareSemver("0.1.0-beta.5", "0.1.0-beta.55")).toBeLessThan(0);
    expect(compareSemver("1.2.3", "1.2.3")).toBe(0);
  });

  it("depsUnchanged is key-order-insensitive and strict on any difference", async () => {
    const { depsUnchanged } = await import("../src/commands/update.js");
    // 键序不同但内容一致 → 增量安全
    expect(
      depsUnchanged(
        { dependencies: { a: "^1.0.0", b: "2.0.0" } },
        { dependencies: { b: "2.0.0", a: "^1.0.0" } },
      ),
    ).toBe(true);
    // undefined 与空表等价
    expect(depsUnchanged({}, { dependencies: {} })).toBe(true);
    expect(depsUnchanged(undefined, undefined)).toBe(true);
    // 换版本 / 换 range / 新增 / 删除 → 必须回退完整安装
    expect(
      depsUnchanged(
        { dependencies: { a: "^1.0.0" } },
        { dependencies: { a: "^1.1.0" } },
      ),
    ).toBe(false);
    expect(
      depsUnchanged(
        { dependencies: { a: "^1.0.0" } },
        { dependencies: { a: "^1.0.0", b: "2.0.0" } },
      ),
    ).toBe(false);
    expect(
      depsUnchanged(
        { dependencies: { a: "^1.0.0", b: "2.0.0" } },
        { dependencies: { a: "^1.0.0" } },
      ),
    ).toBe(false);
    // optionalDependencies 同样参与比较（平台二进制就在这里）
    expect(
      depsUnchanged(
        { dependencies: { a: "^1.0.0" }, optionalDependencies: { p: "1.0.0" } },
        { dependencies: { a: "^1.0.0" }, optionalDependencies: { p: "1.1.0" } },
      ),
    ).toBe(false);
  });

  it("buildPackArgs targets a download destination and optional registry", async () => {
    const { buildPackArgs } = await import("../src/commands/update.js");
    expect(buildPackArgs("@nuwax-ai/nuwa-cli@0.2.0", "/tmp/x")).toEqual([
      "pack",
      "@nuwax-ai/nuwa-cli@0.2.0",
      "--pack-destination",
      "/tmp/x",
    ]);
    expect(
      buildPackArgs("@nuwax-ai/nuwa-cli@0.2.0", "/tmp/x", "https://r.example"),
    ).toEqual([
      "pack",
      "@nuwax-ai/nuwa-cli@0.2.0",
      "--pack-destination",
      "/tmp/x",
      "--registry",
      "https://r.example",
    ]);
  });

  it("still runs the full npm install when the incremental prep cannot engage", async () => {
    // vitest 的 argv[1] 不指向安装树 → resolveInstallRoot 为 undefined →
    // 增量准备直接跳过，兜底走完整 npm install（既有行为回归保护）。
    const { updateCommand } = await import("../src/commands/update.js");
    vi.spyOn(console, "log").mockImplementation(() => {});
    const runner = vi.fn(() => ({ status: 0 }));

    await updateCommand(undefined, {}, runner);

    const installCall = runner.mock.calls.find(
      (c) => c[1][0] === "install",
    );
    expect(installCall).toBeDefined();
    expect(installCall?.[0]).toBe("npm");
  });

  it("--force skips the incremental path entirely and runs npm install", async () => {
    // 异常场景修复入口（doctor 指引即此命令）：--force 不得尝试 npm pack/增量。
    const { updateCommand } = await import("../src/commands/update.js");
    vi.spyOn(console, "log").mockImplementation(() => {});
    const runner = vi.fn(() => ({ status: 0 }));

    await updateCommand(undefined, { force: true }, runner);

    expect(
      runner.mock.calls.some((c) => c[1][0] === "pack"),
    ).toBe(false);
    const installCall = runner.mock.calls.find((c) => c[1][0] === "install");
    expect(installCall).toBeDefined();
  });

  it("prints honest step labels instead of a fake percentage bar", async () => {
    const { updateCommand } = await import("../src/commands/update.js");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const runner = vi.fn(() => ({ status: 0 }));

    await updateCommand(undefined, {}, runner);

    const printed = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(printed).toContain("Step 1/4");
    expect(printed).toContain("Step 3/4");
    // 旧的假百分比进度条应已移除
    expect(printed).not.toMatch(/\[%{0,2}#+\]/);
    expect(printed).not.toContain("30%");
  });

  it("runs npm-cli.js directly on Windows when npm resolves to a .cmd shim", async () => {
    const realPlatform = process.platform;
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });
    try {
      const { resolvePackageManagerInvocation } =
        await import("../src/commands/update.js");
      expect(
        resolvePackageManagerInvocation(
          "C:\\Program Files\\nodejs\\npm.cmd",
          [
            "install",
            "-g",
            "@nuwax-ai/nuwa-cli@beta",
            "--progress=true",
          ],
        ),
      ).toEqual({
        command: process.execPath,
        args: [
          "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js",
          "install",
          "-g",
          "@nuwax-ai/nuwa-cli@beta",
          "--progress=true",
        ],
      });
    } finally {
      Object.defineProperty(process, "platform", {
        value: realPlatform,
        configurable: true,
      });
    }
  });
});
