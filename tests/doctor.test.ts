import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DoctorCheckResult } from "../src/core/detect/doctorChecks.js";

const runAllDoctorChecksMock = vi.fn<() => Promise<DoctorCheckResult[]>>();
vi.mock("../src/core/detect/doctorChecks.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/core/detect/doctorChecks.js")>();
  return {
    ...actual,
    runAllDoctorChecks: async () => runAllDoctorChecksMock(),
  };
});

const serviceInstallCommandMock = vi.fn();
vi.mock("../src/commands/service.js", () => ({
  serviceInstallCommand: (...args: unknown[]) =>
    serviceInstallCommandMock(...args),
}));

const restartAllServicesForcedMock = vi.fn();
vi.mock("../src/commands/restart.js", () => ({
  restartAllServicesForced: (...args: unknown[]) =>
    restartAllServicesForcedMock(...args),
}));

function check(
  id: string,
  ok: boolean,
  severity?: "required" | "info",
  fix?: string,
): DoctorCheckResult {
  return { id, label: id, ok, detail: id, severity, fix };
}

const healthyBaseline: DoctorCheckResult[] = [
  check("node", true, "required"),
  check("claude", true),
  check("codex", true),
  check("lanproxy", true, "info"),
  check("autostart", true, "info"),
  check("serve-singleton", true, "info"),
  check("ui-singleton", true, "info"),
];

describe("doctorCommand exit code", () => {
  beforeEach(() => {
    vi.resetModules();
    runAllDoctorChecksMock.mockReset();
    serviceInstallCommandMock.mockReset().mockResolvedValue(undefined);
    restartAllServicesForcedMock.mockReset().mockResolvedValue(undefined);
    process.exitCode = 0;
  });

  it("exits 0 when only optional/info checks fail (e.g. uv missing, Nuwax not logged in) as long as an engine is usable", async () => {
    runAllDoctorChecksMock.mockResolvedValue([
      check("node", true, "required"),
      check("claude", true),
      check("codex", false),
      check("uv", false, "info"),
      check("tcc", true, "info"),
      check("nuwax-login", false, "info"),
      check("local-sessions", true, "info"),
    ]);
    const { doctorCommand } = await import("../src/commands/doctor.js");
    await doctorCommand();
    expect(process.exitCode).toBe(0);
  });

  it("exits 1 when a required check (node version) fails", async () => {
    runAllDoctorChecksMock.mockResolvedValue([
      check("node", false, "required"),
      check("claude", true),
      check("codex", true),
    ]);
    const { doctorCommand } = await import("../src/commands/doctor.js");
    await doctorCommand();
    expect(process.exitCode).toBe(1);
  });

  it("exits 1 when neither claude nor codex is usable, even though each is individually only 'info'", async () => {
    runAllDoctorChecksMock.mockResolvedValue([
      check("node", true, "required"),
      check("claude", false),
      check("codex", false),
    ]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { doctorCommand } = await import("../src/commands/doctor.js");
    await doctorCommand();
    expect(process.exitCode).toBe(1);
    const printed = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(printed).toContain("没有可用的引擎");
    logSpy.mockRestore();
  });

  it("exits 0 when only one of claude/codex is available", async () => {
    runAllDoctorChecksMock.mockResolvedValue([
      check("node", true, "required"),
      check("claude", true),
      check("codex", false),
    ]);
    const { doctorCommand } = await import("../src/commands/doctor.js");
    await doctorCommand();
    expect(process.exitCode).toBe(0);
  });

  it("exits 0 and reports full pass when everything is ok", async () => {
    runAllDoctorChecksMock.mockResolvedValue([
      check("node", true, "required"),
      check("claude", true),
      check("codex", true),
    ]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { doctorCommand } = await import("../src/commands/doctor.js");
    await doctorCommand();
    expect(process.exitCode).toBe(0);
    const printed = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(printed).toContain("环境检测全部通过");
    logSpy.mockRestore();
  });
});

describe("doctorCommand --fix", () => {
  beforeEach(() => {
    vi.resetModules();
    runAllDoctorChecksMock.mockReset();
    serviceInstallCommandMock.mockReset().mockResolvedValue(undefined);
    restartAllServicesForcedMock.mockReset().mockResolvedValue(undefined);
    process.exitCode = 0;
  });

  it("installs KeepAlive when missing without restarting a healthy stack", async () => {
    const pre = healthyBaseline.map((c) =>
      c.id === "autostart"
        ? check("autostart", false, "info", "install")
        : { ...c },
    );
    runAllDoctorChecksMock
      .mockResolvedValueOnce(pre)
      .mockResolvedValueOnce(healthyBaseline);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { doctorCommand } = await import("../src/commands/doctor.js");
    await doctorCommand({ fix: true });

    expect(serviceInstallCommandMock).toHaveBeenCalledWith({ now: false });
    expect(restartAllServicesForcedMock).not.toHaveBeenCalled();
    expect(runAllDoctorChecksMock).toHaveBeenCalledTimes(2);
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toContain("登录自启");
    logSpy.mockRestore();
  });

  it("skips install and restart when everything is already healthy", async () => {
    runAllDoctorChecksMock
      .mockResolvedValueOnce(healthyBaseline)
      .mockResolvedValueOnce(healthyBaseline);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { doctorCommand } = await import("../src/commands/doctor.js");
    await doctorCommand({ fix: true });

    expect(serviceInstallCommandMock).not.toHaveBeenCalled();
    expect(restartAllServicesForcedMock).not.toHaveBeenCalled();
    const printed = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).toContain("未发现需要自动修复");
    logSpy.mockRestore();
  });

  it("rebuilds the gateway stack when lanproxy/runtime checks fail", async () => {
    const pre = healthyBaseline.map((c) =>
      c.id === "lanproxy"
        ? check(
            "lanproxy",
            false,
            "info",
            "运行 `nuwa-cli doctor --fix` 自动重建云端隧道",
          )
        : { ...c },
    );
    runAllDoctorChecksMock
      .mockResolvedValueOnce(pre)
      .mockResolvedValueOnce(healthyBaseline);

    const { doctorCommand } = await import("../src/commands/doctor.js");
    await doctorCommand({ fix: true });

    expect(serviceInstallCommandMock).not.toHaveBeenCalled();
    expect(restartAllServicesForcedMock).toHaveBeenCalled();
  });

  it("rebuilds when serve has multiple instances", async () => {
    const pre = healthyBaseline.map((c) =>
      c.id === "serve-singleton"
        ? check("serve-singleton", false, "info", "doctor --fix")
        : { ...c },
    );
    runAllDoctorChecksMock
      .mockResolvedValueOnce(pre)
      .mockResolvedValueOnce(healthyBaseline);

    const { doctorCommand } = await import("../src/commands/doctor.js");
    await doctorCommand({ fix: true });
    expect(restartAllServicesForcedMock).toHaveBeenCalled();
  });

  it("does not restart for missing lanproxy platform package", async () => {
    const pre = healthyBaseline.map((c) =>
      c.id === "lanproxy"
        ? check(
            "lanproxy",
            false,
            "info",
            "重新安装 nuwa-cli（不要使用 --omit=optional）",
          )
        : { ...c },
    );
    runAllDoctorChecksMock
      .mockResolvedValueOnce(pre)
      .mockResolvedValueOnce(pre);

    const { doctorCommand } = await import("../src/commands/doctor.js");
    await doctorCommand({ fix: true });
    expect(restartAllServicesForcedMock).not.toHaveBeenCalled();
  });

  it("continues stack rebuild after KeepAlive install failure when runtime is also broken", async () => {
    const pre = healthyBaseline.map((c) => {
      if (c.id === "autostart") return check("autostart", false, "info");
      if (c.id === "lanproxy") {
        return check("lanproxy", false, "info", "doctor --fix 重建");
      }
      return { ...c };
    });
    runAllDoctorChecksMock
      .mockResolvedValueOnce(pre)
      .mockResolvedValueOnce(pre);
    serviceInstallCommandMock.mockRejectedValue(new Error("no account"));

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { doctorCommand } = await import("../src/commands/doctor.js");
    await doctorCommand({ fix: true });

    expect(restartAllServicesForcedMock).toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    errSpy.mockRestore();
  });
});
