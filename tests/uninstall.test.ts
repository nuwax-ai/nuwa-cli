import { afterEach, describe, expect, it, vi } from "vitest";
import {
  uninstallCommand,
  type UninstallDeps,
} from "../src/commands/uninstall.js";
import type { CommandRunner } from "../src/commands/update.js";
import { PACKAGE_NAME } from "../src/core/version.js";

function makeDeps(overrides: Partial<UninstallDeps> = {}): UninstallDeps & {
  removeOsAutostart: ReturnType<typeof vi.fn>;
  stopRuntime: ReturnType<typeof vi.fn>;
  purgeHome: ReturnType<typeof vi.fn>;
} {
  return {
    removeOsAutostart: vi.fn(),
    stopRuntime: vi.fn(async () => {}),
    homeDir: () => "/tmp/fake-nuwa-cli-home",
    purgeHome: vi.fn(),
    homeExists: () => true,
    ...overrides,
  } as UninstallDeps & {
    removeOsAutostart: ReturnType<typeof vi.fn>;
    stopRuntime: ReturnType<typeof vi.fn>;
    purgeHome: ReturnType<typeof vi.fn>;
  };
}

/**
 * Runner that reports the package installed until an uninstall -g is seen,
 * then reports it gone. Mirrors npm list / uninstall for unit tests.
 */
function makeRunner(opts: {
  initiallyInstalled?: boolean;
  uninstallStatus?: number;
}): CommandRunner {
  let installed = opts.initiallyInstalled !== false;
  return (command, args) => {
    expect(command).toBeTruthy();
    if (args[0] === "list" && args.includes("-g")) {
      return {
        status: 0,
        stdout: installed ? `${PACKAGE_NAME}@0.0.0-dev\n` : "(empty)\n",
        stderr: "",
      };
    }
    if (args[0] === "prefix" && args.includes("-g")) {
      return { status: 0, stdout: "/tmp/npm-prefix\n", stderr: "" };
    }
    if (args[0] === "uninstall" && args.includes("-g")) {
      if ((opts.uninstallStatus ?? 0) === 0) installed = false;
      return {
        status: opts.uninstallStatus ?? 0,
        stdout: "",
        stderr: opts.uninstallStatus ? "npm ERR!\n" : "",
      };
    }
    return { status: 0, stdout: "", stderr: "" };
  };
}

describe("uninstallCommand", () => {
  afterEach(() => {
    process.exitCode = undefined;
  });

  it("stops services, npm-uninstalls, and keeps ~/.nuwa-cli by default", async () => {
    const deps = makeDeps();
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((msg) => {
      logs.push(String(msg));
    });

    await uninstallCommand(
      { yes: true },
      makeRunner({ initiallyInstalled: true }),
      deps,
    );

    expect(deps.removeOsAutostart).toHaveBeenCalledOnce();
    expect(deps.stopRuntime).toHaveBeenCalledOnce();
    expect(deps.purgeHome).not.toHaveBeenCalled();
    expect(process.exitCode ?? 0).toBe(0);
    expect(logs.join("\n")).toMatch(/kept|保留/i);
    logSpy.mockRestore();
  });

  it("purges home when --purge is set", async () => {
    const deps = makeDeps();
    await uninstallCommand(
      { yes: true, purge: true },
      makeRunner({ initiallyInstalled: true }),
      deps,
    );
    expect(deps.purgeHome).toHaveBeenCalledWith("/tmp/fake-nuwa-cli-home");
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("skips npm uninstall when package is not globally installed", async () => {
    const deps = makeDeps();
    const calls: string[][] = [];
    const runner: CommandRunner = (command, args) => {
      calls.push(args);
      return makeRunner({ initiallyInstalled: false })(command, args);
    };

    await uninstallCommand({ yes: true }, runner, deps);

    expect(calls.some((a) => a[0] === "uninstall")).toBe(false);
    expect(deps.removeOsAutostart).toHaveBeenCalledOnce();
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("still allows --purge when package was already gone", async () => {
    const deps = makeDeps();
    await uninstallCommand(
      { yes: true, purge: true },
      makeRunner({ initiallyInstalled: false }),
      deps,
    );
    expect(deps.purgeHome).toHaveBeenCalledOnce();
  });

  it("sets exitCode when npm uninstall fails", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = makeDeps();
    await uninstallCommand(
      { yes: true },
      makeRunner({ initiallyInstalled: true, uninstallStatus: 1 }),
      deps,
    );
    expect(process.exitCode).toBe(1);
    expect(deps.purgeHome).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
