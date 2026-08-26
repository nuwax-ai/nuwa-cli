import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  spawnSync: vi.fn(),
  whichSync: vi.fn(),
  confirm: vi.fn(),
  isCancel: vi.fn(() => false),
}));

vi.mock("node:child_process", () => ({
  spawnSync: mocks.spawnSync,
}));

vi.mock("which", () => ({
  default: { sync: mocks.whichSync },
}));

vi.mock("@clack/prompts", () => ({
  confirm: (...args: unknown[]) => mocks.confirm(...args),
  isCancel: (...args: unknown[]) => mocks.isCancel(...args),
  select: vi.fn(),
  text: vi.fn(),
  intro: vi.fn(),
  outro: vi.fn(),
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
}));

describe("update command", () => {
  beforeEach(() => {
    mocks.spawnSync.mockReset();
    mocks.spawnSync.mockImplementation(() => ({ status: 0, stdout: "" }));
    mocks.whichSync.mockReset();
    mocks.whichSync.mockReturnValue("npm");
    mocks.confirm.mockReset();
    mocks.isCancel.mockReset();
    mocks.isCancel.mockReturnValue(false);
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
    expect(normalizeUpdateTarget("stable")).toBe("latest");
    expect(normalizeUpdateTarget("STABLE")).toBe("latest");
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

  it("maps update stable to latest in dry-run output", async () => {
    const { updateCommand } = await import("../src/commands/update.js");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const runner = vi.fn(() => ({ status: 0 }));

    await updateCommand("stable", { dryRun: true }, runner);

    expect(runner).not.toHaveBeenCalled();
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toMatch(/stable.+latest|Channel alias/i);
    expect(printed).toContain("Upgrade target: @nuwax-ai/nuwa-cli@latest");
    expect(printed).toContain(
      "Run: npm install -g @nuwax-ai/nuwa-cli@latest --progress=true",
    );
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

  it("isNpxCachePath recognizes posix and Windows npx layouts", async () => {
    const { isNpxCachePath } = await import("../src/commands/update.js");
    expect(isNpxCachePath("/Users/x/.npm/_npx/abc123/node_modules/@nuwax-ai/nuwa-cli")).toBe(
      true,
    );
    expect(
      isNpxCachePath(
        "C:\\Users\\x\\AppData\\Local\\npm-cache\\_npx\\abc\\node_modules\\@nuwax-ai\\nuwa-cli",
      ),
    ).toBe(true);
    expect(
      isNpxCachePath(
        "C:\\Users\\x\\AppData\\Roaming\\npm\\node_modules\\@nuwax-ai\\nuwa-cli",
      ),
    ).toBe(false);
  });

  it("isGlobalPackageInstallRoot and bin shim use platform paths", async () => {
    const path = await import("node:path");
    const { isGlobalPackageInstallRoot, isNpmGlobalBinShim, pathsEqual } =
      await import("../src/commands/update.js");

    // 用本机 path.join 构造「npm 前缀 / node_modules / 包」布局（全平台可跑）
    const npmPrefix = path.join("/mock", "npm");
    const npmRoot = path.join(npmPrefix, "node_modules");
    const pkg = path.join(npmRoot, "@nuwax-ai", "nuwa-cli");
    expect(isGlobalPackageInstallRoot(pkg, npmRoot)).toBe(true);
    expect(
      isNpmGlobalBinShim(path.join(npmPrefix, "nuwa-cli.cmd"), npmRoot),
    ).toBe(true);
    expect(
      isNpmGlobalBinShim(path.join(npmPrefix, "nuwa-cli.ps1"), npmRoot),
    ).toBe(true);
    expect(
      isNpmGlobalBinShim(path.join(npmPrefix, "other.cmd"), npmRoot),
    ).toBe(false);

    // Windows 字面路径 + 大小写：仅在 win32 上验证（posix path.basename 不认反斜杠）
    if (process.platform === "win32") {
      const winNpmRoot =
        "C:\\Users\\Foo\\AppData\\Roaming\\npm\\node_modules";
      const winPkg =
        "C:\\Users\\Foo\\AppData\\Roaming\\npm\\node_modules\\@nuwax-ai\\nuwa-cli";
      expect(isGlobalPackageInstallRoot(winPkg, winNpmRoot)).toBe(true);
      expect(
        isGlobalPackageInstallRoot(winPkg.toLowerCase(), winNpmRoot.toUpperCase()),
      ).toBe(true);
      expect(pathsEqual("C:\\Users\\Foo\\A", "c:\\users\\foo\\a")).toBe(true);
      expect(
        isNpmGlobalBinShim(
          "C:\\Users\\Foo\\AppData\\Roaming\\npm\\nuwa-cli.cmd",
          winNpmRoot,
        ),
      ).toBe(true);
    }
  });

  it("resolveInstallRoot rejects npx trees and accepts npm root -g package dir", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const { resolveInstallRoot } = await import("../src/commands/update.js");

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nuwa-cli-root-"));
    try {
      const npmGlobal = path.join(tmp, "node_modules");
      const pkgRoot = path.join(npmGlobal, "@nuwax-ai", "nuwa-cli");
      fs.mkdirSync(path.join(pkgRoot, "dist"), { recursive: true });
      fs.writeFileSync(
        path.join(pkgRoot, "package.json"),
        JSON.stringify({ name: "@nuwax-ai/nuwa-cli", version: "0.2.6-beta.1" }),
      );
      const entry = path.join(pkgRoot, "dist", "cli.js");
      fs.writeFileSync(entry, "console.log('ok')\n");

      const runnerOk = vi.fn(() => ({
        status: 0,
        stdout: `${npmGlobal}\r\n`, // 模拟 Windows CRLF
      }));
      expect(resolveInstallRoot(runnerOk, process.env, entry, "npm")).toBe(
        fs.realpathSync(pkgRoot),
      );
      expect(runnerOk).toHaveBeenCalledWith(
        "npm",
        ["root", "-g"],
        expect.any(Object),
      );

      // npx 缓存：即使 package.json name 对也不认
      const npxRoot = path.join(tmp, "_npx", "hash", "node_modules", "@nuwax-ai", "nuwa-cli");
      fs.mkdirSync(path.join(npxRoot, "dist"), { recursive: true });
      fs.writeFileSync(
        path.join(npxRoot, "package.json"),
        JSON.stringify({ name: "@nuwax-ai/nuwa-cli" }),
      );
      const npxEntry = path.join(npxRoot, "dist", "cli.js");
      fs.writeFileSync(npxEntry, "console.log('npx')\n");
      expect(
        resolveInstallRoot(
          () => ({ status: 0, stdout: npmGlobal }),
          process.env,
          npxEntry,
          "npm",
        ),
      ).toBeUndefined();

      // entry 不在全局包内 → 拒绝（防止误升级其它 copy）
      const outsider = path.join(tmp, "other", "dist", "cli.js");
      fs.mkdirSync(path.dirname(outsider), { recursive: true });
      fs.writeFileSync(outsider, "");
      expect(
        resolveInstallRoot(
          () => ({ status: 0, stdout: npmGlobal }),
          process.env,
          outsider,
          "npm",
        ),
      ).toBeUndefined();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("resolveInstallRoot accepts Windows-style global bin shim entry", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const { resolveInstallRoot } = await import("../src/commands/update.js");

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nuwa-cli-shim-"));
    try {
      // 模拟 %AppData%\npm\node_modules\@nuwax-ai\nuwa-cli + 同级 nuwa-cli.cmd
      const npmPrefix = path.join(tmp, "npm");
      const npmGlobal = path.join(npmPrefix, "node_modules");
      const pkgRoot = path.join(npmGlobal, "@nuwax-ai", "nuwa-cli");
      fs.mkdirSync(pkgRoot, { recursive: true });
      fs.writeFileSync(
        path.join(pkgRoot, "package.json"),
        JSON.stringify({ name: "@nuwax-ai/nuwa-cli" }),
      );
      const shim = path.join(npmPrefix, "nuwa-cli.cmd");
      fs.writeFileSync(shim, "@echo off\r\n");

      expect(
        resolveInstallRoot(
          () => ({ status: 0, stdout: npmGlobal }),
          process.env,
          shim,
          "npm",
        ),
      ).toBe(fs.realpathSync(pkgRoot));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("incremental happy path skips npm install when deps match", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const { updateCommand } = await import("../src/commands/update.js");

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nuwa-cli-incr-"));
    const npmGlobal = path.join(tmp, "node_modules");
    const pkgRoot = path.join(npmGlobal, "@nuwax-ai", "nuwa-cli");
    fs.mkdirSync(path.join(pkgRoot, "dist"), { recursive: true });
    const deps = {
      name: "@nuwax-ai/nuwa-cli",
      version: "0.2.6-beta.1",
      dependencies: { commander: "^15.0.0" },
    };
    fs.writeFileSync(path.join(pkgRoot, "package.json"), JSON.stringify(deps));
    const entry = path.join(pkgRoot, "dist", "cli.js");
    fs.writeFileSync(entry, "#!/usr/bin/env node\nconsole.log('0.2.6-beta.2')\n");

    const prevArgv1 = process.argv[1];
    process.argv[1] = entry;
    vi.spyOn(console, "log").mockImplementation(() => {});

    const runner = vi.fn((cmd: string, args: string[] = []) => {
      if (args[0] === "view") return { status: 0, stdout: "0.2.6-beta.2\n" };
      if (args[0] === "root") return { status: 0, stdout: `${npmGlobal}\n` };
      if (args[0] === "pack") {
        const dest = args[args.indexOf("--pack-destination") + 1];
        const tgzName = "nuwax-ai-nuwa-cli-0.2.6-beta.2.tgz";
        fs.writeFileSync(path.join(dest, tgzName), "fake");
        return { status: 0, stdout: `${tgzName}\n` };
      }
      if (
        cmd === "tar" &&
        args.includes("-C") &&
        !args.includes("--strip-components=1")
      ) {
        const outDir = args[args.indexOf("-C") + 1];
        const pkgDir = path.join(outDir, "package");
        fs.mkdirSync(pkgDir, { recursive: true });
        fs.writeFileSync(
          path.join(pkgDir, "package.json"),
          JSON.stringify({
            name: "@nuwax-ai/nuwa-cli",
            version: "0.2.6-beta.2",
            dependencies: { commander: "^15.0.0" },
          }),
        );
        return { status: 0 };
      }
      if (cmd === "tar" && args.includes("--strip-components=1")) {
        fs.writeFileSync(
          path.join(pkgRoot, "dist", "cli.js"),
          "#!/usr/bin/env node\nconsole.log('0.2.6-beta.2')\n",
        );
        fs.writeFileSync(
          path.join(pkgRoot, "package.json"),
          JSON.stringify({
            name: "@nuwax-ai/nuwa-cli",
            version: "0.2.6-beta.2",
            dependencies: { commander: "^15.0.0" },
          }),
        );
        return { status: 0 };
      }
      if (args[0]?.includes("cli.js") && args[1] === "--version") {
        return { status: 0, stdout: "0.2.6-beta.2\n" };
      }
      if (args[0] === "install") {
        return { status: 0 };
      }
      return { status: 0 };
    });

    try {
      await updateCommand("0.2.6-beta.2", {}, runner);
      expect(runner.mock.calls.some((c) => c[1]?.[0] === "install")).toBe(
        false,
      );
      expect(runner.mock.calls.some((c) => c[1]?.[0] === "pack")).toBe(true);
    } finally {
      process.argv[1] = prevArgv1;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
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

  it("skips stop confirmation when --yes is set even if services are running", async () => {
    const ui = await import("../src/util/ui.js");
    const upgradeStop = await import("../src/core/processes/upgradeStop.js");
    vi.spyOn(ui, "isInteractive").mockReturnValue(true);
    vi.spyOn(ui, "isCI").mockReturnValue(false);
    vi.spyOn(upgradeStop, "collectRunningRuntimeSnapshot").mockReturnValue({
      gatewayPids: [99],
      consolePids: [],
      childPids: [],
      windowsLockImages: [],
    });
    vi.spyOn(upgradeStop, "hasRunningRuntimeProcesses").mockReturnValue(true);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { updateCommand } = await import("../src/commands/update.js");
    const runner = vi.fn(() => ({ status: 0 }));

    await updateCommand(undefined, { yes: true }, runner);

    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(runner).toHaveBeenCalledWith(
      "npm",
      expect.arrayContaining(["install"]),
      expect.anything(),
    );
  });

  it("aborts upgrade when interactive stop confirmation is declined", async () => {
    const ui = await import("../src/util/ui.js");
    const upgradeStop = await import("../src/core/processes/upgradeStop.js");
    vi.spyOn(ui, "isInteractive").mockReturnValue(true);
    vi.spyOn(ui, "isCI").mockReturnValue(false);
    vi.spyOn(upgradeStop, "collectRunningRuntimeSnapshot").mockReturnValue({
      gatewayPids: [99],
      consolePids: [],
      childPids: [],
      windowsLockImages: [],
    });
    vi.spyOn(upgradeStop, "hasRunningRuntimeProcesses").mockReturnValue(true);
    mocks.confirm.mockResolvedValue(false);
    mocks.isCancel.mockReturnValue(false);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { updateCommand } = await import("../src/commands/update.js");
    const runner = vi.fn((cmd: string, args: string[]) => {
      if (args[0] === "view") return { status: 0, stdout: "9.9.9\n" };
      return { status: 0, stdout: "" };
    });

    await updateCommand(undefined, {}, runner);

    expect(process.exitCode).toBe(1);
    expect(mocks.confirm).toHaveBeenCalled();
    // Confirm runs before incremental prep — no pack / install after decline.
    expect(runner.mock.calls.some((c) => c[1]?.[0] === "pack")).toBe(false);
    expect(runner).not.toHaveBeenCalledWith(
      "npm",
      expect.arrayContaining(["install"]),
      expect.anything(),
    );
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
