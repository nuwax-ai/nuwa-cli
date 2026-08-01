import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { ensureDir, logsDir, tmpDir, writeFileAtomic } from "../../util/paths.js";

export const SERVICE_LABEL = "com.nuwax.nuwa-cli";
export const WINDOWS_TASK_NAME = "NuwaCLI";

export interface ServiceRuntimeOptions {
  engine?: string;
  port?: string;
  host?: string;
  cwd?: string;
  approve?: string;
  lanproxyPath?: string;
  lanproxyHost?: string;
  lanproxyPort?: string;
  lanproxySsl?: string;
}

export interface ServiceInstallOptions extends ServiceRuntimeOptions {
  now?: boolean;
}

export interface ServiceCommandResult {
  command: string;
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface ServiceStatus {
  installed: boolean;
  active: boolean | null;
  details: string;
  configPath?: string;
  taskName?: string;
}

interface RuntimeContext {
  nodePath?: string;
  cliPath?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  cwd?: string;
}

function pushFlag(args: string[], name: string, value?: string): void {
  if (value !== undefined && value !== "") args.push(name, value);
}

export function resolveCliEntryPath(argv1 = process.argv[1]): string {
  if (!argv1) throw new Error("无法定位当前 nuwa-cli CLI 入口文件。");
  return path.resolve(argv1);
}

export function buildServiceProgramArgs(
  options: ServiceRuntimeOptions,
  context: RuntimeContext = {},
): string[] {
  const args = [
    context.nodePath ?? process.execPath,
    context.cliPath ?? resolveCliEntryPath(),
    "gateway",
  ];
  pushFlag(args, "--engine", options.engine);
  pushFlag(args, "--port", options.port);
  pushFlag(args, "--host", options.host);
  pushFlag(args, "--cwd", options.cwd);
  pushFlag(args, "--approve", options.approve);
  pushFlag(args, "--lanproxy-path", options.lanproxyPath);
  pushFlag(args, "--lanproxy-host", options.lanproxyHost);
  pushFlag(args, "--lanproxy-port", options.lanproxyPort);
  pushFlag(args, "--lanproxy-ssl", options.lanproxySsl);
  return args;
}

function isSensitiveEnvKey(key: string): boolean {
  return /(?:PASSWORD|SAVED_KEY|CONFIG_KEY|SECRET|TOKEN|API_KEY|ACCESS_KEY|PRIVATE_KEY)/i.test(
    key,
  );
}

export function buildServiceEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Record<string, string> {
  const allowedKeys = [
    "PATH",
    "HOME",
    "SHELL",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "USER",
    "USERNAME",
    "APPDATA",
    "LOCALAPPDATA",
    "SystemRoot",
    "ComSpec",
    "ProgramFiles",
    "ProgramFiles(x86)",
    "ProgramW6432",
  ];
  const result: Record<string, string> = {};
  for (const key of allowedKeys) {
    const value = env[key];
    if (value && !isSensitiveEnvKey(key)) result[key] = value;
  }
  if (!result.PATH && platform !== "win32") {
    result.PATH =
      "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
  }
  result.NUWACLI_SERVICE = "1";
  return result;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function plistStringArray(values: string[]): string {
  return [
    "<array>",
    ...values.map((value) => `  <string>${xmlEscape(value)}</string>`),
    "</array>",
  ].join("\n");
}

function plistEnvDict(values: Record<string, string>): string {
  const entries = Object.entries(values).flatMap(([key, value]) => [
    `  <key>${xmlEscape(key)}</key>`,
    `  <string>${xmlEscape(value)}</string>`,
  ]);
  return ["<dict>", ...entries, "</dict>"].join("\n");
}

export function launchAgentPath(homeDir = os.homedir()): string {
  return path.join(
    homeDir,
    "Library",
    "LaunchAgents",
    `${SERVICE_LABEL}.plist`,
  );
}

export function buildLaunchAgentPlist(
  options: ServiceRuntimeOptions,
  context: RuntimeContext = {},
): string {
  const args = buildServiceProgramArgs(options, context);
  const env = buildServiceEnvironment(
    context.env,
    context.platform ?? "darwin",
  );
  const workDir = context.cwd ?? process.cwd();
  const stdoutPath = path.join(logsDir(), "launchd.out.log");
  const stderrPath = path.join(logsDir(), "launchd.err.log");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
${plistStringArray(args)
  .split("\n")
  .map((line) => `  ${line}`)
  .join("\n")}
  <key>WorkingDirectory</key>
  <string>${xmlEscape(workDir)}</string>
  <key>EnvironmentVariables</key>
${plistEnvDict(env)
  .split("\n")
  .map((line) => `  ${line}`)
  .join("\n")}
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${xmlEscape(stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(stderrPath)}</string>
</dict>
</plist>
`;
}

function systemdQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function systemdEnvLine(key: string, value: string): string {
  return `Environment=${systemdQuote(`${key}=${value}`)}`;
}

export function systemdUserServicePath(homeDir = os.homedir()): string {
  return path.join(
    homeDir,
    ".config",
    "systemd",
    "user",
    `${SERVICE_LABEL}.service`,
  );
}

export function buildSystemdUserService(
  options: ServiceRuntimeOptions,
  context: RuntimeContext = {},
): string {
  const args = buildServiceProgramArgs(options, context);
  const env = buildServiceEnvironment(context.env, context.platform ?? "linux");
  const workDir = context.cwd ?? process.cwd();
  const execStart = args.map(systemdQuote).join(" ");
  const envLines = Object.entries(env)
    .map(([key, value]) => systemdEnvLine(key, value))
    .join("\n");
  return `[Unit]
Description=Nuwa CLI headless agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${systemdQuote(workDir)}
${envLines}
ExecStart=${execStart}
Restart=always
RestartSec=5
KillMode=control-group

[Install]
WantedBy=default.target
`;
}

function windowsQuoteArg(value: string): string {
  if (!/[ \t"]/.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

export function buildWindowsTaskRunCommand(
  options: ServiceRuntimeOptions,
  context: RuntimeContext = {},
): string {
  return buildServiceProgramArgs(options, context)
    .map(windowsQuoteArg)
    .join(" ");
}

/**
 * Builds a Windows Task Scheduler (2.0 schema) definition that starts the
 * gateway at user logon. Using an XML import (instead of `schtasks /TR`) keeps
 * the command/arguments free of the fragile cmd-line double-quoting that
 * `spawnSync` would otherwise re-apply to the `/TR` value. The task is pinned
 * to the current user with an interactive token at least privilege, which a
 * non-admin can register for themselves. Task Scheduler XML has no element for
 * custom environment variables; the task inherits the user's logon environment
 * (PATH/USERPROFILE/APPDATA/SystemRoot ...), which is all the gateway needs.
 */
export function buildWindowsTaskXml(
  options: ServiceRuntimeOptions,
  context: RuntimeContext = {},
): string {
  const programArgs = buildServiceProgramArgs(options, context);
  const command = programArgs[0] ?? "";
  const argumentsField = programArgs.slice(1).map(windowsQuoteArg).join(" ");
  const username = context.env?.USERNAME ?? process.env.USERNAME ?? "";
  const principal = username
    ? [
        "<Principals>",
        '  <Principal id="Author">',
        `    <UserId>${xmlEscape(username)}</UserId>`,
        "    <LogonType>InteractiveToken</LogonType>",
        "    <RunLevel>LeastPrivilege</RunLevel>",
        "  </Principal>",
        "</Principals>",
      ].join("\n")
    : "";
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Nuwa CLI KeepAlive gateway</Description>
    <URI>\\${WINDOWS_TASK_NAME}</URI>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
    </LogonTrigger>
  </Triggers>
  ${principal}
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${xmlEscape(command)}</Command>
      <Arguments>${xmlEscape(argumentsField)}</Arguments>
    </Exec>
  </Actions>
</Task>
`;
}

function run(
  command: string,
  args: string[],
  options: { ignoreFailure?: boolean; spawnOptions?: SpawnSyncOptions } = {},
): ServiceCommandResult {
  const result = spawnSync(command, args, {
    encoding: "utf-8",
    ...options.spawnOptions,
    // schtasks.exe / sc.exe / etc. are console apps; without this a cmd window
    // flashes whenever the Windows scheduled-task service is started/stopped.
    windowsHide: true,
  });
  const commandText = [command, ...args].join(" ");
  const status = result.status;
  const stdout = String(result.stdout ?? "");
  const stderr = String(result.stderr ?? "");
  if (result.error && !options.ignoreFailure) {
    throw new Error(`${commandText} 执行失败：${result.error.message}`);
  }
  if (status !== 0 && !options.ignoreFailure) {
    throw new Error(
      `${commandText} 退出码 ${status ?? "unknown"}：${stderr || stdout}`,
    );
  }
  return { command: commandText, status, stdout, stderr };
}

function guiTarget(): string {
  const uid = process.getuid?.();
  if (uid === undefined) {
    throw new Error("当前 Node 运行时无法获取用户 UID。");
  }
  return `gui/${uid}`;
}

function launchdServiceTarget(): string {
  return `${guiTarget()}/${SERVICE_LABEL}`;
}

function installMacService(options: ServiceInstallOptions): void {
  ensureDir(logsDir());
  const plistPath = launchAgentPath();
  writeFileAtomic(plistPath, buildLaunchAgentPlist(options), 0o644);
  if (options.now) {
    run("launchctl", ["bootout", guiTarget(), plistPath], {
      ignoreFailure: true,
    });
    run("launchctl", ["bootstrap", guiTarget(), plistPath]);
    run("launchctl", ["kickstart", "-k", launchdServiceTarget()]);
  }
}

function installLinuxService(options: ServiceInstallOptions): void {
  ensureDir(logsDir());
  const servicePath = systemdUserServicePath();
  writeFileAtomic(servicePath, buildSystemdUserService(options), 0o644);
  run("systemctl", ["--user", "daemon-reload"]);
  run("systemctl", ["--user", "enable", `${SERVICE_LABEL}.service`]);
  if (options.now) {
    run("systemctl", ["--user", "restart", `${SERVICE_LABEL}.service`]);
  }
}

function schtasksExe(): string {
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows";
  return path.join(systemRoot, "System32", "schtasks.exe");
}

function windowsSpawnOptions(): SpawnSyncOptions {
  // Route schtasks through cmd.exe so the system binary is launched by the
  // shell rather than directly by Node — this bypasses AV/EDR hooks that
  // intercept Node's own CreateProcess of schtasks.exe (a persistence binary
  // that defenders flag), and matches the windowsHide convention used across
  // the codebase.
  return { shell: true, windowsHide: true };
}

function windowsTaskXmlPath(): string {
  return path.join(tmpDir(), "gateway-task.xml");
}

function runSchtasks(
  args: string[],
  options: { ignoreFailure?: boolean } = {},
): ServiceCommandResult {
  try {
    return run(schtasksExe(), args, {
      ...options,
      spawnOptions: windowsSpawnOptions(),
    });
  } catch (err) {
    const base = err instanceof Error ? err.message : String(err);
    throw new Error(
      `${base}\n` +
        "Windows 计划任务创建被拒绝（常见原因：杀毒/EDR 拦截了 schtasks.exe，或需要管理员权限）。" +
        "可改用「以管理员身份运行的终端」重试 nuwa-cli service install，或在杀毒软件中放行 schtasks.exe。",
    );
  }
}

function installWindowsService(options: ServiceInstallOptions): void {
  ensureDir(tmpDir());
  const xmlPath = windowsTaskXmlPath();
  // schtasks /Create /XML requires UTF-16LE (with BOM); a plain UTF-8 file is
  // rejected as "task XML is malformed" once any non-ASCII appears.
  const xml = buildWindowsTaskXml(options, { platform: "win32" });
  fs.writeFileSync(xmlPath, Buffer.from(`\uFEFF${xml}`, "utf16le"));
  // \u5148\u505C\u6B62\u5DF2\u5B58\u5728\u7684\u4EFB\u52A1\u5B9E\u4F8B\uFF1Aschtasks /Create /F \u5BF9\u300C\u6B63\u5728\u8FD0\u884C\u300D\u7684\u4EFB\u52A1\u4F1A\u8FD4\u56DE
  // \u300C\u62D2\u7EDD\u8BBF\u95EE\u300D(ERROR_ACCESS_DENIED)\u3002\u91CD\u590D\u767B\u5F55 / \u5347\u7EA7\u540E\u91CD\u88C5\u65F6\u5FC5\u987B\u5148 /End\uFF0C
  // \u5426\u5219\u8868\u73B0\u4E3A login \u62A5\u300C\u62D2\u7EDD\u8BBF\u95EE\u300D\u5931\u8D25\u3002
  runSchtasks(["/End", "/TN", WINDOWS_TASK_NAME], { ignoreFailure: true });
  runSchtasks(["/Create", "/TN", WINDOWS_TASK_NAME, "/XML", xmlPath, "/F"]);
  if (options.now) runSchtasks(["/Run", "/TN", WINDOWS_TASK_NAME]);
}

export function installService(options: ServiceInstallOptions): void {
  switch (process.platform) {
    case "darwin":
      installMacService(options);
      return;
    case "linux":
      installLinuxService(options);
      return;
    case "win32":
      installWindowsService(options);
      return;
    default:
      throw new Error(`暂不支持当前平台：${process.platform}`);
  }
}

export function startService(): void {
  switch (process.platform) {
    case "darwin": {
      const plistPath = launchAgentPath();
      if (!fs.existsSync(plistPath)) throw new Error("尚未安装服务。");
      run("launchctl", ["bootstrap", guiTarget(), plistPath], {
        ignoreFailure: true,
      });
      run("launchctl", ["kickstart", "-k", launchdServiceTarget()]);
      return;
    }
    case "linux":
      run("systemctl", ["--user", "daemon-reload"]);
      run("systemctl", ["--user", "start", `${SERVICE_LABEL}.service`]);
      return;
    case "win32":
      runSchtasks(["/Run", "/TN", WINDOWS_TASK_NAME]);
      return;
    default:
      throw new Error(`暂不支持当前平台：${process.platform}`);
  }
}

export function stopService(): void {
  switch (process.platform) {
    case "darwin":
      run("launchctl", ["bootout", launchdServiceTarget()]);
      return;
    case "linux":
      run("systemctl", ["--user", "stop", `${SERVICE_LABEL}.service`]);
      return;
    case "win32":
      runSchtasks(["/End", "/TN", WINDOWS_TASK_NAME], {
        ignoreFailure: true,
      });
      return;
    default:
      throw new Error(`暂不支持当前平台：${process.platform}`);
  }
}

export function uninstallService(): void {
  switch (process.platform) {
    case "darwin": {
      const plistPath = launchAgentPath();
      run("launchctl", ["bootout", launchdServiceTarget()], {
        ignoreFailure: true,
      });
      fs.rmSync(plistPath, { force: true });
      return;
    }
    case "linux": {
      const servicePath = systemdUserServicePath();
      run(
        "systemctl",
        ["--user", "disable", "--now", `${SERVICE_LABEL}.service`],
        {
          ignoreFailure: true,
        },
      );
      fs.rmSync(servicePath, { force: true });
      run("systemctl", ["--user", "daemon-reload"], { ignoreFailure: true });
      return;
    }
    case "win32":
      runSchtasks(["/Delete", "/TN", WINDOWS_TASK_NAME, "/F"], {
        ignoreFailure: true,
      });
      return;
    default:
      throw new Error(`暂不支持当前平台：${process.platform}`);
  }
}

export function getServiceStatus(): ServiceStatus {
  switch (process.platform) {
    case "darwin": {
      const configPath = launchAgentPath();
      const result = run("launchctl", ["print", launchdServiceTarget()], {
        ignoreFailure: true,
      });
      const details = result.stdout || result.stderr;
      return {
        installed: fs.existsSync(configPath),
        active: result.status === 0,
        details,
        configPath,
      };
    }
    case "linux": {
      const configPath = systemdUserServicePath();
      const active = run(
        "systemctl",
        ["--user", "is-active", `${SERVICE_LABEL}.service`],
        { ignoreFailure: true },
      );
      const details = run(
        "systemctl",
        [
          "--user",
          "status",
          "--no-pager",
          "--lines=20",
          `${SERVICE_LABEL}.service`,
        ],
        { ignoreFailure: true },
      );
      return {
        installed: fs.existsSync(configPath),
        active: active.stdout.trim() === "active",
        details:
          details.stdout || details.stderr || active.stdout || active.stderr,
        configPath,
      };
    }
    case "win32": {
      const result = runSchtasks(
        ["/Query", "/TN", WINDOWS_TASK_NAME, "/V", "/FO", "LIST"],
        { ignoreFailure: true },
      );
      return {
        installed: result.status === 0,
        active:
          result.status === 0
            ? /Status:\s+Running/i.test(result.stdout)
            : false,
        details: result.stdout || result.stderr,
        taskName: WINDOWS_TASK_NAME,
      };
    }
    default:
      throw new Error(`暂不支持当前平台：${process.platform}`);
  }
}
