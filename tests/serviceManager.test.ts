import { describe, expect, it } from "vitest";
import {
  buildLaunchAgentPlist,
  buildServiceEnvironment,
  buildServiceProgramArgs,
  buildSystemdUserService,
  buildWindowsStartupVbs,
  buildWindowsTaskRunCommand,
  buildWindowsTaskXml,
  SERVICE_LABEL,
  WINDOWS_TASK_NAME,
  windowsStartupVbsPath,
} from "../src/core/service/serviceManager.js";

describe("serviceManager", () => {
  it("builds persistent service args through gateway without daemonizing inside the service manager", () => {
    const args = buildServiceProgramArgs(
      {
        engine: "claude",
        port: "60017",
        host: "127.0.0.1",
        cwd: "/tmp/work",
        approve: "deny",
        lanproxySsl: "false",
      },
      { nodePath: "/usr/local/bin/node", cliPath: "/opt/nuwa-cli/dist/cli.js" },
    );

    expect(args).toEqual([
      "/usr/local/bin/node",
      "/opt/nuwa-cli/dist/cli.js",
      "gateway",
      "--engine",
      "claude",
      "--port",
      "60017",
      "--host",
      "127.0.0.1",
      "--cwd",
      "/tmp/work",
      "--approve",
      "deny",
      "--lanproxy-ssl",
      "false",
    ]);
    expect(args).not.toContain("--daemon");
  });

  it("keeps sensitive environment variables out of generated service environments", () => {
    const env = buildServiceEnvironment(
      {
        PATH: "/usr/local/bin:/usr/bin",
        HOME: "/home/alice",
        NUWACLI_PASSWORD: "pw",
        ANTHROPIC_API_KEY: "sk-secret",
        USER: "alice",
      },
      "linux",
    );

    expect(env).toMatchObject({
      PATH: "/usr/local/bin:/usr/bin",
      HOME: "/home/alice",
      USER: "alice",
      NUWACLI_SERVICE: "1",
    });
    expect(JSON.stringify(env)).not.toContain("pw");
    expect(JSON.stringify(env)).not.toContain("sk-secret");
  });

  it("generates a macOS LaunchAgent plist for the current user", () => {
    const plist = buildLaunchAgentPlist(
      { engine: "codex", port: "60016" },
      {
        nodePath: "/opt/homebrew/bin/node",
        cliPath: "/Users/alice/bin/nuwa-cli.js",
        env: { PATH: "/opt/homebrew/bin:/usr/bin", NUWACLI_PASSWORD: "pw" },
        cwd: "/Users/alice/project",
      },
    );

    expect(plist).toContain(`<string>${SERVICE_LABEL}</string>`);
    expect(plist).toContain("<key>RunAtLoad</key>");
    expect(plist).toContain("<key>KeepAlive</key>");
    expect(plist).toContain("<string>/opt/homebrew/bin/node</string>");
    expect(plist).toContain("<string>gateway</string>");
    expect(plist).toContain("<string>codex</string>");
    expect(plist).not.toContain("pw");
  });

  it("generates a systemd user service with restart and process-group cleanup", () => {
    const service = buildSystemdUserService(
      { engine: "claude", cwd: "/home/alice/work repo" },
      {
        nodePath: "/usr/bin/node",
        cliPath: "/home/alice/.local/bin/nuwa-cli.js",
        env: { PATH: "/usr/bin", HOME: "/home/alice", ANTHROPIC_API_KEY: "sk" },
        cwd: "/home/alice",
      },
    );

    expect(service).toContain("Description=Nuwa CLI headless agent");
    expect(service).toContain('ExecStart="/usr/bin/node"');
    expect(service).toContain('"gateway"');
    expect(service).toContain("Restart=always");
    expect(service).toContain("KillMode=control-group");
    expect(service).not.toContain("sk");
  });

  it("generates a Windows scheduled task command without embedding secrets", () => {
    const command = buildWindowsTaskRunCommand(
      { engine: "claude", cwd: "C:\\Users\\alice\\work repo" },
      {
        nodePath: "C:\\Program Files\\nodejs\\node.exe",
        cliPath:
          "C:\\Users\\alice\\AppData\\Roaming\\npm\\node_modules\\nuwa-cli\\dist\\cli.js",
      },
    );

    expect(WINDOWS_TASK_NAME).toBe("NuwaCLI");
    expect(command).toContain('"C:\\Program Files\\nodejs\\node.exe"');
    expect(command).toContain(" gateway ");
    expect(command).toContain("--engine claude");
    expect(command).not.toContain("savedKey");
    expect(command).not.toContain("password");
  });

  it("generates a Windows Task Scheduler XML for the current user at logon without an explicit Principal", () => {
    const xml = buildWindowsTaskXml(
      { engine: "claude", port: "60017", cwd: "C:\\Users\\alice\\work repo" },
      {
        nodePath: "C:\\Program Files\\nodejs\\node.exe",
        cliPath:
          "C:\\Users\\alice\\AppData\\Roaming\\npm\\node_modules\\nuwa-cli\\dist\\cli.js",
        env: { USERNAME: "alice", NUWACLI_PASSWORD: "pw" },
      },
    );

    // schtasks /Create /XML requires the UTF-16 declaration.
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-16"?>')).toBe(true);
    expect(xml).toContain(
      "http://schemas.microsoft.com/windows/2004/02/mit/task",
    );

    // Logon trigger replaces the old /SC ONLOGON.
    expect(xml).toContain("<LogonTrigger>");

    // 不内嵌 <Principal>：schtasks /Create 默认以「创建任务的当前用户」
    // （LeastPrivilege / InteractiveToken）注册，非管理员可为本人创建。显式写裸
    // <UserId> 在域账号机器上解析歧义会触发 ERROR_ACCESS_DENIED，因此即使
    // context 里给了 USERNAME 也不写入。
    expect(xml).not.toContain("<Principal");
    expect(xml).not.toContain("<UserId>");
    expect(xml).not.toContain("<LogonType>");
    expect(xml).not.toContain("<RunLevel>");

    // Command is node.exe (spaces OK unquoted in <Command>); arguments carry
    // the CLI entry, the gateway subcommand and flags. A spaced --cwd value is
    // quoted for cmd and then XML-escaped so schtasks parses it correctly.
    expect(xml).toContain(
      "<Command>C:\\Program Files\\nodejs\\node.exe</Command>",
    );
    expect(xml).toContain(
      "C:\\Users\\alice\\AppData\\Roaming\\npm\\node_modules\\nuwa-cli\\dist\\cli.js",
    );
    expect(xml).toContain(" gateway ");
    expect(xml).toContain("--engine claude");
    expect(xml).toContain("--port 60017");
    expect(xml).toContain(
      "--cwd &quot;C:\\Users\\alice\\work repo&quot;",
    );

    // No secrets and no env block leak into the task definition.
    expect(xml).not.toContain("pw");
    expect(xml).not.toContain("password");
    expect(xml).not.toContain("savedKey");
    expect(xml).not.toContain("NUWACLI_PASSWORD");
    expect(xml).not.toContain("NUWACLI_SERVICE");
  });

  it("generates a Windows Startup-folder .vbs that launches gateway --daemon hidden at logon", () => {
    const vbs = buildWindowsStartupVbs(
      { engine: "claude", port: "60017", cwd: "C:\\Users\\alice\\work repo" },
      {
        nodePath: "C:\\Program Files\\nodejs\\node.exe",
        cliPath:
          "C:\\Users\\alice\\AppData\\Roaming\\npm\\node_modules\\nuwa-cli\\dist\\cli.js",
        env: { USERNAME: "alice", NUWACLI_PASSWORD: "pw" },
      },
    );

    // 隐藏窗口、不等待地启动 gateway（--daemon 复用 launchDaemon 全套）。
    expect(vbs).toContain('Set sh = CreateObject("WScript.Shell")');
    expect(vbs).toContain("sh.Run ");
    expect(vbs).toContain(", 0, False");
    expect(vbs).toContain(" gateway --daemon ");

    // 含空格的 node 路径被 Windows 引号包裹，再为 VBScript 字面量把 " 翻倍成 ""。
    expect(vbs).toContain('""C:\\Program Files\\nodejs\\node.exe""');
    expect(vbs).toContain(
      "C:\\Users\\alice\\AppData\\Roaming\\npm\\node_modules\\nuwa-cli\\dist\\cli.js",
    );
    expect(vbs).toContain("--engine claude");
    expect(vbs).toContain("--port 60017");

    // 不泄漏任何凭证。
    expect(vbs).not.toContain("pw");
    expect(vbs).not.toContain("password");
    expect(vbs).not.toContain("savedKey");
    expect(vbs).not.toContain("NUWACLI_PASSWORD");
  });

  it("places the Startup-folder .vbs under the user Startup directory", () => {
    const oldAppData = process.env.APPDATA;
    process.env.APPDATA = "C:\\Users\\alice\\AppData\\Roaming";
    try {
      const vbsPath = windowsStartupVbsPath();
      expect(vbsPath).toContain("Startup");
      expect(vbsPath).toContain("nuwa-cli-gateway.vbs");
    } finally {
      if (oldAppData === undefined) delete process.env.APPDATA;
      else process.env.APPDATA = oldAppData;
    }
  });

  it("throws when APPDATA is unset on Windows fallback path resolution", () => {
    const oldAppData = process.env.APPDATA;
    delete process.env.APPDATA;
    try {
      expect(() => windowsStartupVbsPath()).toThrow(/APPDATA/);
    } finally {
      if (oldAppData !== undefined) process.env.APPDATA = oldAppData;
    }
  });
});
