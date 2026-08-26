import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  spawnSync: vi.fn(),
  whichSync: vi.fn(),
  stopRuntime: vi.fn(async () => {}),
  collectSnapshot: vi.fn(() => ({
    gatewayPids: [] as number[],
    consolePids: [] as number[],
    childPids: [] as number[],
    windowsLockImages: [] as string[],
  })),
  hasRunning: vi.fn(
    (snapshot?: {
      gatewayPids: number[];
      consolePids: number[];
      childPids: number[];
      windowsLockImages: string[];
    }) => {
      const s = snapshot ?? {
        gatewayPids: [],
        consolePids: [],
        childPids: [],
        windowsLockImages: [],
      };
      return (
        s.gatewayPids.length > 0 ||
        s.consolePids.length > 0 ||
        s.childPids.length > 0 ||
        s.windowsLockImages.length > 0
      );
    },
  ),
  writeLangConfig: vi.fn(),
  setLang: vi.fn(),
  isInteractive: vi.fn(() => false),
  isCI: vi.fn(() => true),
  confirm: vi.fn(),
  select: vi.fn(),
  isCancel: vi.fn(() => false),
}));

vi.mock("node:child_process", () => ({
  spawnSync: mocks.spawnSync,
  spawn: vi.fn(),
}));

vi.mock("which", () => ({
  default: { sync: mocks.whichSync },
}));

vi.mock("../src/core/processes/upgradeStop.js", () => ({
  stopRuntimeProcessesForUpdate: (...args: unknown[]) =>
    mocks.stopRuntime(...args),
  collectRunningRuntimeSnapshot: (...args: unknown[]) =>
    mocks.collectSnapshot(...args),
  hasRunningRuntimeProcesses: (...args: unknown[]) =>
    mocks.hasRunning(...args),
}));

vi.mock("../src/util/i18n/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/util/i18n/index.js")>();
  return {
    ...actual,
    writeLangConfig: (...args: unknown[]) => mocks.writeLangConfig(...args),
    setLang: (...args: unknown[]) => mocks.setLang(...args),
  };
});

vi.mock("../src/util/ui.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/util/ui.js")>();
  return {
    ...actual,
    isInteractive: () => mocks.isInteractive(),
    isCI: () => mocks.isCI(),
  };
});

vi.mock("@clack/prompts", () => ({
  confirm: (...args: unknown[]) => mocks.confirm(...args),
  select: (...args: unknown[]) => mocks.select(...args),
  isCancel: (...args: unknown[]) => mocks.isCancel(...args),
}));

function notInstalledRunner() {
  return vi.fn((cmd: string, args: string[]) => {
    if (args[0] === "list") return { status: 1, stdout: "" };
    if (args[0] === "prefix") return { status: 0, stdout: "/tmp/npm-prefix\n" };
    if (args[0] === "install") return { status: 0, stdout: "" };
    return { status: 0, stdout: "" };
  });
}

function installedRunner() {
  return vi.fn((cmd: string, args: string[]) => {
    if (args[0] === "list") {
      return {
        status: 0,
        stdout: "/usr/lib\n└── @nuwax-ai/nuwa-cli@0.2.6\n",
      };
    }
    if (args[0] === "install") return { status: 0, stdout: "" };
    return { status: 0, stdout: "" };
  });
}

describe("install wizard", () => {
  beforeEach(() => {
    mocks.spawnSync.mockReset();
    mocks.spawnSync.mockImplementation(() => ({ status: 0, stdout: "" }));
    mocks.whichSync.mockReset();
    mocks.whichSync.mockReturnValue("npm");
    mocks.stopRuntime.mockClear();
    mocks.collectSnapshot.mockReset();
    mocks.collectSnapshot.mockReturnValue({
      gatewayPids: [],
      consolePids: [],
      childPids: [],
      windowsLockImages: [],
    });
    mocks.hasRunning.mockClear();
    mocks.writeLangConfig.mockClear();
    mocks.setLang.mockClear();
    mocks.isInteractive.mockReturnValue(false);
    mocks.isCI.mockReturnValue(true);
    mocks.confirm.mockReset();
    mocks.select.mockReset();
    mocks.isCancel.mockReturnValue(false);
    process.exitCode = 0;
  });

  afterEach(() => {
    process.exitCode = 0;
    vi.restoreAllMocks();
  });

  it("normalizes install tags and rejects invalid ones", async () => {
    const { normalizeInstallTag } = await import("../src/commands/install.js");
    expect(normalizeInstallTag("v0.2.6")).toBe("0.2.6");
    expect(normalizeInstallTag("latest")).toBe("latest");
    expect(normalizeInstallTag("stable")).toBe("latest");
    expect(normalizeInstallTag("0.2.6-beta.1")).toBe("0.2.6-beta.1");
    expect(() => normalizeInstallTag("file:../evil")).toThrow(/Invalid|--tag/i);
  });

  it("installs with --yes when not globally installed and persists --lang only then", async () => {
    const { installCommand } = await import("../src/commands/install.js");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const runner = notInstalledRunner();

    await installCommand({ yes: true, lang: "en", tag: "latest" }, runner);

    expect(mocks.setLang).toHaveBeenCalledWith("en");
    expect(mocks.writeLangConfig).toHaveBeenCalledWith("en");
    expect(mocks.stopRuntime).toHaveBeenCalled();
    expect(runner).toHaveBeenCalledWith(
      "npm",
      [
        "install",
        "-g",
        "@nuwax-ai/nuwa-cli@latest",
        "--progress=true",
      ],
      expect.objectContaining({ stdio: "pipe" }),
    );
    const printed = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(printed).toMatch(/Installation complete|安装完成/);
    expect(printed).toContain("nuwa-cli login");
    expect(printed).toContain("nuwa-cli start");
  });

  it("redirects to update when already installed without --force (even with --yes)", async () => {
    const { installCommand } = await import("../src/commands/install.js");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const runner = installedRunner();

    await installCommand({ yes: true, lang: "en" }, runner);

    expect(mocks.writeLangConfig).not.toHaveBeenCalled();
    expect(mocks.stopRuntime).not.toHaveBeenCalled();
    expect(runner).not.toHaveBeenCalledWith(
      "npm",
      expect.arrayContaining(["install"]),
      expect.anything(),
    );
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toMatch(/nuwa-cli update/);
  });

  it("reinstalls with --force via the update kernel when already installed", async () => {
    const { installCommand } = await import("../src/commands/install.js");
    vi.spyOn(console, "log").mockImplementation(() => {});
    const runner = installedRunner();
    const updateFn = vi.fn(async () => {});

    await installCommand(
      { yes: true, force: true, tag: "latest", lang: "zh-CN" },
      runner,
      undefined,
      updateFn,
    );

    expect(mocks.writeLangConfig).toHaveBeenCalledWith("zh-CN");
    expect(updateFn).toHaveBeenCalledWith(
      "latest",
      expect.objectContaining({ force: true, yes: true }),
      runner,
    );
    expect(runner).not.toHaveBeenCalledWith(
      "npm",
      expect.arrayContaining(["install"]),
      expect.anything(),
    );
  });

  it("stops services under --yes when processes are running", async () => {
    mocks.collectSnapshot.mockReturnValue({
      gatewayPids: [42],
      consolePids: [],
      childPids: [],
      windowsLockImages: [],
    });
    const { installCommand } = await import("../src/commands/install.js");
    vi.spyOn(console, "log").mockImplementation(() => {});
    const runner = notInstalledRunner();

    await installCommand({ yes: true, tag: "0.2.6" }, runner);

    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.stopRuntime).toHaveBeenCalled();
  });

  it("aborts without npm install when interactive stop confirmation is declined", async () => {
    mocks.isInteractive.mockReturnValue(true);
    mocks.isCI.mockReturnValue(false);
    mocks.collectSnapshot.mockReturnValue({
      gatewayPids: [42],
      consolePids: [],
      childPids: [],
      windowsLockImages: [],
    });
    mocks.select.mockResolvedValue("en");
    mocks.confirm.mockResolvedValue(false);
    const { installCommand } = await import("../src/commands/install.js");
    vi.spyOn(console, "log").mockImplementation(() => {});
    const runner = notInstalledRunner();

    await installCommand({ tag: "latest" }, runner);

    expect(process.exitCode).toBe(1);
    expect(mocks.writeLangConfig).not.toHaveBeenCalled();
    expect(mocks.stopRuntime).not.toHaveBeenCalled();
    expect(runner).not.toHaveBeenCalledWith(
      "npm",
      expect.arrayContaining(["install"]),
      expect.anything(),
    );
  });

  it("does not persist lang when interactive already-installed confirm is declined", async () => {
    mocks.isInteractive.mockReturnValue(true);
    mocks.isCI.mockReturnValue(false);
    mocks.select.mockResolvedValue("zh-CN");
    mocks.confirm.mockResolvedValue(false);
    const { installCommand } = await import("../src/commands/install.js");
    vi.spyOn(console, "log").mockImplementation(() => {});
    const runner = installedRunner();

    await installCommand({}, runner);

    expect(mocks.setLang).toHaveBeenCalledWith("zh-CN");
    expect(mocks.writeLangConfig).not.toHaveBeenCalled();
    expect(mocks.stopRuntime).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
  });

  it("skips npm and bootstraps when --bootstrap is set", async () => {
    const { installCommand } = await import("../src/commands/install.js");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const runner = notInstalledRunner();
    const startCommand = vi.fn(async () => {});
    const loginCommand = vi.fn(async () => {});
    const readCredentials = vi
      .fn()
      .mockReturnValue({ configKey: "k", username: "alice", domain: "example.com" });

    await installCommand(
      { yes: true, bootstrap: true },
      runner,
      { readCredentials, loginCommand, startCommand },
    );

    expect(runner).not.toHaveBeenCalled();
    expect(loginCommand).not.toHaveBeenCalled();
    expect(startCommand).toHaveBeenCalled();
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toMatch(/bootstrap/i);
  });

  it("--yes without login does not start Gateway", async () => {
    const { installCommand } = await import("../src/commands/install.js");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const runner = notInstalledRunner();
    const startCommand = vi.fn(async () => {});
    const loginCommand = vi.fn(async () => {});
    const readCredentials = vi.fn().mockReturnValue({});

    await installCommand(
      { yes: true, tag: "latest" },
      runner,
      { readCredentials, loginCommand, startCommand },
    );

    expect(runner).toHaveBeenCalledWith(
      "npm",
      expect.arrayContaining(["install", "-g"]),
      expect.anything(),
    );
    expect(loginCommand).not.toHaveBeenCalled();
    expect(startCommand).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toMatch(/nuwa-cli login/);
  });

  it("--yes when logged in starts Gateway without re-login", async () => {
    const { installCommand } = await import("../src/commands/install.js");
    vi.spyOn(console, "log").mockImplementation(() => {});
    const runner = notInstalledRunner();
    const startCommand = vi.fn(async () => {});
    const loginCommand = vi.fn(async () => {});
    const readCredentials = vi.fn().mockReturnValue({
      configKey: "k",
      username: "alice",
      domain: "https://agent.nuwax.com",
    });

    await installCommand(
      { yes: true, tag: "latest" },
      runner,
      { readCredentials, loginCommand, startCommand },
    );

    expect(loginCommand).not.toHaveBeenCalled();
    expect(startCommand).toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
  });

  it("--no-start skips bootstrap even when deps are injected", async () => {
    const { installCommand } = await import("../src/commands/install.js");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const runner = notInstalledRunner();
    const startCommand = vi.fn(async () => {});

    await installCommand(
      { yes: true, tag: "latest", noStart: true },
      runner,
      {
        readCredentials: () => ({}),
        loginCommand: async () => {},
        startCommand,
      },
    );

    expect(startCommand).not.toHaveBeenCalled();
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toContain("nuwa-cli start");
  });
});
