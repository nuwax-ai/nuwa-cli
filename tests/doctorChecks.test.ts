import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// These tests read the REAL home (tmpHome/.codex, tmpHome/.claude) — pin engine
// isolation OFF. Isolation behavior is covered in engineHome.test.ts.
process.env.NUWACLI_ISOLATE_ENGINES = "0";

let tmpHome: string;

const lanproxyMocks = vi.hoisted(() => ({
  resolveBinary: vi.fn(),
  processes: vi.fn(),
  serveStatus: vi.fn(),
}));

vi.mock("../src/core/serve/lanproxyBinary.js", () => ({
  resolveDefaultLanproxyBinary: () => lanproxyMocks.resolveBinary(),
}));

vi.mock("../src/core/processes/lanproxyStatus.js", () => ({
  findLanproxyProcesses: () => lanproxyMocks.processes(),
}));

vi.mock("../src/core/serve/serveLock.js", () => ({
  getServeStatus: () => lanproxyMocks.serveStatus(),
}));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return {
    ...actual,
    homedir: () => tmpHome,
  };
});

describe("checkNodeVersion", () => {
  it("passes on the Node version running the test", async () => {
    const { checkNodeVersion } =
      await import("../src/core/detect/doctorChecks.js");
    const result = checkNodeVersion();
    expect(result.ok).toBe(true);
    expect(result.detail).toContain(process.versions.node);
  });
});

describe("checkNuwaxLogin", () => {
  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "nuwa-cli-doctor-test-"));
    vi.resetModules();
    lanproxyMocks.resolveBinary.mockReset().mockReturnValue("/bin/lanproxy");
    lanproxyMocks.processes.mockReset().mockReturnValue([]);
    lanproxyMocks.serveStatus.mockReset().mockResolvedValue({ state: "stopped" });
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("reports not logged in when credentials.json is missing, with the manual-login fix hint", async () => {
    const { checkNuwaxLogin } =
      await import("../src/core/detect/doctorChecks.js");
    const result = checkNuwaxLogin();
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("未登录");
    expect(result.fix).toContain("--domain");
    expect(result.fix).not.toContain("NuwaClaw 客户端");
  });

  it("reports logged in when credentials.json has a configKey", async () => {
    const credPath = path.join(tmpHome, ".nuwa-cli", "credentials.json");
    fs.mkdirSync(path.dirname(credPath), { recursive: true });
    fs.writeFileSync(
      credPath,
      JSON.stringify({
        domain: "https://agent.nuwax.com",
        computerName: "我的电脑001",
        configKey: "abc123",
        savedKey: "abc123",
      }),
    );
    const { checkNuwaxLogin, checkNuwaxComputer } =
      await import("../src/core/detect/doctorChecks.js");
    const result = checkNuwaxLogin();
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("agent.nuwax.com");

    const computer = checkNuwaxComputer();
    expect(computer.ok).toBe(true);
    expect(computer.detail).toBe("我的电脑001");
  });

  it("reports NOT logged in when only savedKey remains (post-logout) even though a device key exists", async () => {
    const credPath = path.join(tmpHome, ".nuwa-cli", "credentials.json");
    fs.mkdirSync(path.dirname(credPath), { recursive: true });
    fs.writeFileSync(
      credPath,
      JSON.stringify({ domain: "https://agent.nuwax.com", savedKey: "abc123" }),
    );
    const { checkNuwaxLogin } =
      await import("../src/core/detect/doctorChecks.js");
    const result = checkNuwaxLogin();
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("免密重新登录");
  });

  it("reports failure when credentials.json has neither configKey nor savedKey", async () => {
    const credPath = path.join(tmpHome, ".nuwa-cli", "credentials.json");
    fs.mkdirSync(path.dirname(credPath), { recursive: true });
    fs.writeFileSync(
      credPath,
      JSON.stringify({ domain: "https://agent.nuwax.com" }),
    );
    const { checkNuwaxLogin } =
      await import("../src/core/detect/doctorChecks.js");
    const result = checkNuwaxLogin();
    expect(result.ok).toBe(false);
  });

  it("reports corrupted file distinctly", async () => {
    const credPath = path.join(tmpHome, ".nuwa-cli", "credentials.json");
    fs.mkdirSync(path.dirname(credPath), { recursive: true });
    fs.writeFileSync(credPath, "{not json");
    const { checkNuwaxLogin } =
      await import("../src/core/detect/doctorChecks.js");
    const result = checkNuwaxLogin();
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("损坏");
  });
});

describe("checkLanproxy", () => {
  beforeEach(() => {
    vi.resetModules();
    lanproxyMocks.resolveBinary.mockReset().mockReturnValue("C:\\bin\\nuwax-lanproxy.exe");
    lanproxyMocks.processes.mockReset().mockReturnValue([]);
    lanproxyMocks.serveStatus.mockReset().mockResolvedValue({ state: "stopped" });
  });

  it("reports the installed binary and current stopped state", async () => {
    const { checkLanproxy } =
      await import("../src/core/detect/doctorChecks.js");
    const result = await checkLanproxy();
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("已安装，当前未运行");
    expect(result.detail).toContain("nuwax-lanproxy.exe");
  });

  it("reports live lanproxy process ids", async () => {
    lanproxyMocks.processes.mockReturnValue([{ pid: 2468 }]);
    lanproxyMocks.serveStatus.mockResolvedValue({ state: "running" });
    const { checkLanproxy } =
      await import("../src/core/detect/doctorChecks.js");
    expect((await checkLanproxy()).detail).toContain("运行中（PID 2468）");
    expect((await checkLanproxy()).detail).toContain("/health 正常");
  });

  it("reports an unhealthy tunnel when Gateway is healthy but lanproxy is absent", async () => {
    lanproxyMocks.serveStatus.mockResolvedValue({ state: "running" });
    const { checkLanproxy } =
      await import("../src/core/detect/doctorChecks.js");
    const result = await checkLanproxy();
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("Gateway /health 正常");
    expect(result.detail).toContain("未检测到 lanproxy 进程");
  });

  it("reports an unhealthy target when lanproxy lives but Gateway health fails", async () => {
    lanproxyMocks.processes.mockReturnValue([{ pid: 2468 }]);
    lanproxyMocks.serveStatus.mockResolvedValue({ state: "unhealthy" });
    const { checkLanproxy } =
      await import("../src/core/detect/doctorChecks.js");
    const result = await checkLanproxy();
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("Gateway /health 无响应");
  });

  it("shows an install fix when the platform binary is missing", async () => {
    lanproxyMocks.resolveBinary.mockImplementation(() => {
      throw new Error("缺少 Windows 平台包");
    });
    const { checkLanproxy } =
      await import("../src/core/detect/doctorChecks.js");
    const result = await checkLanproxy();
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("缺少 Windows 平台包");
    expect(result.fix).toContain("--omit=optional");
  });
});

describe("checkLocalSessions", () => {
  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "nuwa-cli-doctor-test-"));
    vi.resetModules();
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("counts zero sessions when directories are absent", async () => {
    const { checkLocalSessions } =
      await import("../src/core/detect/doctorChecks.js");
    const result = checkLocalSessions();
    expect(result.detail).toContain("claude: 0");
    expect(result.detail).toContain("codex: 0");
  });

  it("counts claude and codex session files", async () => {
    const claudeProjectDir = path.join(
      tmpHome,
      ".claude",
      "projects",
      "-Users-apple-demo",
    );
    fs.mkdirSync(claudeProjectDir, { recursive: true });
    fs.writeFileSync(path.join(claudeProjectDir, "session-1.jsonl"), "{}\n");
    fs.writeFileSync(path.join(claudeProjectDir, "session-2.jsonl"), "{}\n");

    const codexSessionDir = path.join(
      tmpHome,
      ".codex",
      "sessions",
      "2026",
      "07",
      "06",
    );
    fs.mkdirSync(codexSessionDir, { recursive: true });
    fs.writeFileSync(
      path.join(codexSessionDir, "rollout-2026-07-06T00-00-00-abc.jsonl"),
      "{}\n",
    );

    const { checkLocalSessions } =
      await import("../src/core/detect/doctorChecks.js");
    const result = checkLocalSessions();
    expect(result.detail).toContain("claude: 2");
    expect(result.detail).toContain("codex: 1");
  });
});
