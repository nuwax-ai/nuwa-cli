import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  CLI_VERSION,
  DEFAULT_DIST_TAG,
  PACKAGE_NAME,
  resolveNpmChannelAlias,
} from "../core/version.js";
import { findOnPath, isBatchShim } from "../util/which.js";
import {
  collectRunningRuntimeSnapshot,
  hasRunningRuntimeProcesses,
  stopRuntimeProcessesForUpdate,
} from "../core/processes/upgradeStop.js";
import {
  withSpinner,
  success,
  dim,
  warn,
  isInteractive,
  isCI,
  printCancelled,
  CANCEL_EXIT_CODE,
} from "../util/ui.js";
import { t } from "../util/i18n/index.js";
import * as clack from "@clack/prompts";

export interface UpdateOptions {
  check?: boolean;
  dryRun?: boolean;
  registry?: string;
  /** 强制完整重装：跳过增量路径，npm 整树重装（修复安装异常）。 */
  force?: boolean;
  /**
   * Skip the interactive “stop running services?” confirm (CI / Agent).
   * Non-TTY already skips the prompt and stops automatically.
   */
  yes?: boolean;
}

export interface CommandResult {
  status: number | null;
  stdout?: string;
  stderr?: string;
  error?: Error;
}

export type CommandRunner = (
  command: string,
  args: string[],
  options: {
    encoding?: BufferEncoding;
    env?: NodeJS.ProcessEnv;
    stdio?: "inherit" | "pipe";
  },
) => CommandResult;

function runCommand(
  command: string,
  args: string[],
  options: {
    encoding?: BufferEncoding;
    env?: NodeJS.ProcessEnv;
    stdio?: "inherit" | "pipe";
  },
): CommandResult {
  const invocation = resolvePackageManagerInvocation(command, args);
  const result = spawnSync(invocation.command, invocation.args, options);
  return {
    status: result.status,
    stdout: typeof result.stdout === "string" ? result.stdout : undefined,
    stderr: typeof result.stderr === "string" ? result.stderr : undefined,
    error: result.error,
  };
}

async function runInstallWithProgress(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<CommandResult> {
  const invocation = resolvePackageManagerInvocation(command, args);
  // stdio: "inherit" lets npm render its own progress/spinner. We no longer
  // overlay an estimated \r progress bar — it clobbered npm's output on the
  // same line (flickering spinner+progress on one row).
  return await new Promise((resolve) => {
    let settled = false;
    const finish = (result: CommandResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const child = spawn(invocation.command, invocation.args, {
      env,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", (error) => finish({ status: null, error }));
    child.once("close", (code) => finish({ status: code }));
  });
}

/**
 * 升级/安装完成后：若已登录，重启所有服务（Gateway / file-server / lanproxy /
 * mcp-proxy），复用 `nuwa-cli restart` 的统一逻辑。未登录则跳过（serve 需要 Nuwax
 * 凭证才能连 Gateway）。
 *
 * 实现要点（Windows 可靠性）：以前 fire-and-forget 一个 detached `restart` 子进程
 * （detached + unref，stdio 重定向到日志），它再 spawn detached gateway daemon——这是
 * 「detached 进程派生 detached 孙进程」，Windows 上 gateway daemon 起不来（升级后服务
 * 全没起，留下指向已死 daemon 的陈旧单例锁）。改为：前台 await 一个 console-attached
 * （非 detached、stdio inherit）的 `restart` 子进程——它 spawn 的 detached daemon 与
 * `nuwa-cli gateway` 同构（前台/console-attached 进程派生 detached daemon，1 层），
 * 在 Windows 上能可靠存活。restart 在 launchDaemon 后即 return 退出，故 await 有界，
 * 还能据退出码确认是否真的拉起。
 */
/**
 * Shared post-upgrade / post-overlay restart. Exported so install --force and
 * docs can point at one implementation; S3 upgrade path calls `update` which
 * invokes this — scripts must not duplicate a parallel restart.
 */
export async function restartServeIfLoggedIn(): Promise<void> {
  try {
    const { readCredentials } = await import("../core/auth/credentials.js");
    if (!readCredentials().configKey) {
      console.log(t("update.notLoggedIn"));
      return;
    }
    const cliEntry = process.argv[1];
    if (!cliEntry) return;
    const child = spawn(process.execPath, [cliEntry, "restart"], {
      stdio: "inherit",
      env: process.env,
      windowsHide: true,
    });
    const exitCode = await new Promise<number | null>((resolve) => {
      child.once("error", () => resolve(null));
      child.once("close", (code) => resolve(code));
    });
    if (exitCode === 0) {
      console.log(t("update.restarted"));
    } else {
      console.log(t("update.restartMaybeFailed", { code: exitCode ?? "unknown" }));
    }
  } catch (err) {
    console.log(
      t("update.restartSkipped", {
        msg: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

export function resolvePackageManagerInvocation(
  command: string,
  args: string[],
): { command: string; args: string[] } {
  if (process.platform !== "win32" || !isBatchShim(command)) {
    return { command, args };
  }
  // Never execute npm.cmd through `shell:true`: cmd.exe splits an unquoted
  // "C:\Program Files\..." path and produces `'C:\Program' 不是内部或外部命令`.
  // npm.cmd and npm-cli.js are installed together by Node.js.
  const npmCli = path.win32.join(
    path.win32.dirname(command),
    "node_modules",
    "npm",
    "bin",
    "npm-cli.js",
  );
  return { command: process.execPath, args: [npmCli, ...args] };
}

/** 解析 semver(核心 + 预发布);非 semver 返回 null。 */
function parseSemver(
  v: string,
): { core: [number, number, number]; pre: string[] | null } | null {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    v,
  );
  if (!m) return null;
  return { core: [+m[1], +m[2], +m[3]], pre: m[4] ? m[4].split(".") : null };
}

function cmpPre(a: string[], b: string[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] === undefined) return -1; // 字段更少 = 更低
    if (b[i] === undefined) return 1;
    const an = /^\d+$/.test(a[i]);
    const bn = /^\d+$/.test(b[i]);
    if (an && bn) {
      const d = +a[i] - +b[i];
      if (d) return d < 0 ? -1 : 1;
    } else if (an !== bn) {
      return an ? -1 : 1; // 数字标识 < 字母标识
    } else if (a[i] !== b[i]) {
      return a[i] < b[i] ? -1 : 1;
    }
  }
  return 0;
}

/** semver 优先级比较:a<b→-1, a==b→0, a>b→1。非 semver 退化为字符串比较。 */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return a < b ? -1 : a > b ? 1 : 0;
  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] < pb.core[i] ? -1 : 1;
  }
  // 核心相等:无预发布 > 有预发布
  if (!pa.pre && !pb.pre) return 0;
  if (!pa.pre) return 1;
  if (!pb.pre) return -1;
  return cmpPre(pa.pre, pb.pre);
}

export function normalizeUpdateTarget(target?: string): string {
  return resolveUpdateTarget(target).target;
}

/** Normalize and report whether a channel alias was applied (for UI hints). */
export function resolveUpdateTarget(target?: string): {
  target: string;
  aliasedFrom?: string;
} {
  const value = (target || DEFAULT_DIST_TAG).trim();
  if (!value || value.startsWith("-")) {
    throw new Error(t("update.emptyTarget"));
  }
  const stripped =
    value.startsWith("v") && /^\d/.test(value.slice(1))
      ? value.slice(1)
      : value;
  // S3 / product channel "stable" → npm dist-tag "latest".
  return resolveNpmChannelAlias(stripped);
}

export function buildInstallArgs(
  packageSpec: string,
  registry?: string,
): string[] {
  const args = ["install", "-g", packageSpec, "--progress=true"];
  if (registry) args.push("--registry", registry);
  return args;
}

export function buildViewArgs(
  packageSpec: string,
  registry?: string,
): string[] {
  const args = ["view", packageSpec, "version"];
  if (registry) args.push("--registry", registry);
  return args;
}

/**
 * Parse `npm list -g --depth=0 <pkg>` stdout for `name@version`.
 * Works with tree glyphs (`└── pkg@1.2.3`) and plain lines.
 */
export function parseNpmListPackageVersion(
  stdout: string,
  packageName: string = PACKAGE_NAME,
): string | null {
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = stdout.match(new RegExp(`${escaped}@([^\\s\\r\\n]+)`));
  const version = match?.[1]?.trim();
  return version || null;
}

/**
 * Version of the **globally** installed package (not the running entry).
 * Prefer `npm list -g`; fall back to `npm root -g` + package.json.
 * Critical for `npx @… install/update`: the npx copy's CLI_VERSION may
 * already equal the channel while the global tree is still older.
 */
export function readGloballyInstalledVersion(
  runner: CommandRunner,
  command: string,
  env: NodeJS.ProcessEnv,
  registry?: string,
): string | null {
  const listArgs = ["list", "-g", "--depth=0", PACKAGE_NAME];
  if (registry) listArgs.push("--registry", registry);
  const listed = runner(command, listArgs, {
    encoding: "utf-8",
    env,
    stdio: "pipe",
  });
  if (listed.status === 0) {
    const fromList = parseNpmListPackageVersion(listed.stdout || "");
    if (fromList) return fromList;
  }

  try {
    const rootResult = runner(command, ["root", "-g"], {
      encoding: "utf-8",
      env,
      stdio: "pipe",
    });
    if (rootResult.error || rootResult.status !== 0) return null;
    const npmGlobal = (rootResult.stdout || "").replace(/\r/g, "").trim();
    if (!npmGlobal) return null;
    const pkgFile = path.join(
      npmGlobal,
      ...PACKAGE_NAME.split("/"),
      "package.json",
    );
    if (!fs.existsSync(pkgFile)) return null;
    const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8")) as {
      name?: string;
      version?: string;
    };
    if (pkg?.name !== PACKAGE_NAME || !pkg.version) return null;
    return String(pkg.version);
  } catch {
    return null;
  }
}

/** `npm view <spec> version` → remote semver, or null on failure. */
export function resolveRemotePackageVersion(
  runner: CommandRunner,
  command: string,
  env: NodeJS.ProcessEnv,
  packageSpec: string,
  registry?: string,
): string | null {
  const result = runner(command, buildViewArgs(packageSpec, registry), {
    encoding: "utf-8",
    env,
    stdio: "pipe",
  });
  if (result.error || result.status !== 0) return null;
  const remote = (result.stdout || "").trim().split(/\r?\n/)[0]?.trim();
  return remote || null;
}

/** 增量更新计划：tarball 位置 + 安装根目录 + 临时目录清理句柄。 */
export interface IncrementalUpdatePlan {
  tgz: string;
  root: string;
  cleanup: () => void;
}

/**
 * 把依赖表规范化为可比较字符串（键排序，undefined 视同空表）。
 * 依赖表的键序在 npm 元数据里不稳定，比较前必须归一。
 */
function normalizeDeps(deps?: Record<string, string>): string {
  return Object.entries(deps ?? {})
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, range]) => `${name}@${range}`)
    .join("\n");
}

/**
 * 两份 package.json 的 dependencies + optionalDependencies 完全一致时，
 * 增量替换根包文件是安全的：现有 node_modules 正是新版本所需要的。
 * 任何差异（新增/删除/换版本/换 range）都必须回退完整安装。
 */
export function depsUnchanged(
  installed?: {
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  },
  incoming?: {
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  },
): boolean {
  return (
    normalizeDeps(installed?.dependencies) ===
      normalizeDeps(incoming?.dependencies) &&
    normalizeDeps(installed?.optionalDependencies) ===
      normalizeDeps(incoming?.optionalDependencies)
  );
}

/** `npm pack <spec> --pack-destination <dir> [--registry ...]`。 */
export function buildPackArgs(
  packageSpec: string,
  destination: string,
  registry?: string,
): string[] {
  const args = ["pack", packageSpec, "--pack-destination", destination];
  if (registry) args.push("--registry", registry);
  return args;
}

/** 跨平台路径相等：Windows 大小写不敏感（盘符/用户目录常见大小写漂移）。 */
export function pathsEqual(a: string, b: string): boolean {
  const left = path.resolve(a);
  const right = path.resolve(b);
  if (process.platform === "win32") {
    return left.toLowerCase() === right.toLowerCase();
  }
  return left === right;
}

/** child 是否位于 parent 之内（含相等）；Windows 大小写不敏感。 */
export function isPathInsideOrEqual(parent: string, child: string): boolean {
  const p = path.resolve(parent);
  const c = path.resolve(child);
  if (pathsEqual(p, c)) return true;
  const prefix = p.endsWith(path.sep) ? p : p + path.sep;
  if (process.platform === "win32") {
    return c.toLowerCase().startsWith(prefix.toLowerCase());
  }
  return c.startsWith(prefix);
}

/**
 * npx 缓存路径特征（posix: `~/.npm/_npx/...`；Windows:
 * `%LocalAppData%\\npm-cache\\_npx\\...`）。命中则禁止增量，
 * 避免把 tarball 解进缓存树并误跳过 `npm install -g`。
 */
export function isNpxCachePath(p: string): boolean {
  const norm = p.replace(/\\/g, "/").toLowerCase();
  return /(^|\/)_npx(\/|$)/.test(norm);
}

/**
 * 安装根是否为「npm root -g 下的本包目录」。
 * 作用域包：`<npmRootG>/@nuwax-ai/nuwa-cli`（Windows 同样用 path.join）。
 */
export function isGlobalPackageInstallRoot(
  root: string,
  npmGlobalNodeModules: string,
): boolean {
  const expected = path.resolve(
    path.join(npmGlobalNodeModules, ...PACKAGE_NAME.split("/")),
  );
  return pathsEqual(root, expected);
}

/**
 * Windows 全局 bin shim：`%AppData%\\npm\\nuwa-cli.cmd`（或 .ps1 / 无后缀），
 * 与 `npm root -g`（`...\\npm\\node_modules`）相邻。命中时 argv[1] 不是
 * `dist/cli.js`，不能用 dirname/.. 推包根。
 */
export function isNpmGlobalBinShim(
  entry: string,
  npmGlobalNodeModules: string,
): boolean {
  const binDir = path.resolve(npmGlobalNodeModules, "..");
  const base = path.basename(entry).toLowerCase();
  // npm 生成：nuwa-cli / nuwa-cli.cmd / nuwa-cli.ps1
  if (base !== "nuwa-cli" && base !== "nuwa-cli.cmd" && base !== "nuwa-cli.ps1") {
    return false;
  }
  return pathsEqual(path.dirname(entry), binDir);
}

/**
 * 解析当前 CLI 的全局安装根目录（package.json 所在层）。
 *
 * 以 `npm root -g` 下的本包目录为唯一合法根；并确认正在运行的 entry
 * 属于该安装（`dist/cli.js` 在包内，或 Windows 全局 bin shim）。
 * 开发仓（.git）/ npx 缓存 / 其它前缀一律 undefined → 回退完整 `npm i -g`。
 *
 * 路径比较前一律 realpath：macOS 上 `/var`→`/private/var`、Windows junction
 * 都可能导致「逻辑路径 ≠ 物理路径」，不归一会误判不属于全局安装。
 */
export function resolveInstallRoot(
  runner: CommandRunner = runCommand,
  env: NodeJS.ProcessEnv = process.env,
  entryPath = process.argv[1],
  npmCommand = "npm",
): string | undefined {
  if (!entryPath) return undefined;

  let entry = entryPath;
  try {
    entry = fs.realpathSync(entry);
  } catch {
    entry = path.resolve(entry);
  }
  if (isNpxCachePath(entry)) return undefined;

  try {
    const rootResult = runner(npmCommand, ["root", "-g"], {
      encoding: "utf-8",
      env,
      stdio: "pipe",
    });
    if (rootResult.error || rootResult.status !== 0) return undefined;
    // Windows spawn 常见 \r\n；trim 已够，再剥残留 CR 保齐。
    const npmGlobalRaw = (rootResult.stdout || "").replace(/\r/g, "").trim();
    if (!npmGlobalRaw) return undefined;

    let npmGlobal = path.resolve(npmGlobalRaw);
    try {
      npmGlobal = fs.realpathSync(npmGlobal);
    } catch {
      // npm root -g 目录应存在；不存在则无法增量。
      return undefined;
    }

    let expectedRoot = path.resolve(
      path.join(npmGlobal, ...PACKAGE_NAME.split("/")),
    );
    try {
      expectedRoot = fs.realpathSync(expectedRoot);
    } catch {
      return undefined;
    }

    if (fs.existsSync(path.join(expectedRoot, ".git"))) return undefined;

    const pkgFile = path.join(expectedRoot, "package.json");
    if (!fs.existsSync(pkgFile)) return undefined;
    const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8")) as {
      name?: string;
    };
    if (pkg?.name !== PACKAGE_NAME) return undefined;

    // 运行中的入口必须属于该全局安装，否则（npx / 其它 copy）禁止增量。
    const fromPackageTree = isPathInsideOrEqual(expectedRoot, entry);
    const fromGlobalBin = isNpmGlobalBinShim(entry, npmGlobal);
    if (!fromPackageTree && !fromGlobalBin) return undefined;

    return expectedRoot;
  } catch {
    return undefined;
  }
}


/**
 * 增量更新准备（只读安装目录 + 写临时目录，可安全先于停服执行）：
 * 下载目标版本 tarball、解包比对依赖表；依赖一致时返回执行计划。
 * 任何一步失败都返回 undefined（调用方回退完整 npm 安装），绝不抛错。
 */
function prepareIncrementalUpdate(
  runner: CommandRunner,
  env: NodeJS.ProcessEnv,
  remoteVersion: string,
  registry: string | undefined,
  npmCommand: string,
): IncrementalUpdatePlan | undefined {
  const root = resolveInstallRoot(runner, env, process.argv[1], npmCommand);
  if (!root) return undefined;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nuwa-cli-update-"));
  const cleanup = () => {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // best-effort：临时目录残留不影响升级。
    }
  };
  try {
    const pack = runner(
      npmCommand,
      buildPackArgs(`${PACKAGE_NAME}@${remoteVersion}`, tmp, registry),
      { encoding: "utf-8", env, stdio: "pipe" },
    );
    if (pack.error || pack.status !== 0) {
      cleanup();
      return undefined;
    }
    // npm pack 的 stdout 末行是 tarball 文件名；兜底扫描目录里的 *.tgz。
    const lines = (pack.stdout || "")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
    const guess = lines.length
      ? path.join(tmp, path.basename(lines[lines.length - 1].trim()))
      : "";
    let tgz =
      guess && guess.endsWith(".tgz") && fs.existsSync(guess) ? guess : "";
    if (!tgz) {
      const found = fs.readdirSync(tmp).find((f) => f.endsWith(".tgz"));
      if (found) tgz = path.join(tmp, found);
    }
    if (!tgz) {
      cleanup();
      return undefined;
    }
    const inspectDir = path.join(tmp, "pkg");
    fs.mkdirSync(inspectDir);
    const untar = runner("tar", ["-xzf", tgz, "-C", inspectDir], {
      encoding: "utf-8",
      env,
      stdio: "pipe",
    });
    if (untar.error || untar.status !== 0) {
      cleanup();
      return undefined;
    }
    const readPkg = (file: string) => {
      try {
        return JSON.parse(fs.readFileSync(file, "utf8")) as {
          dependencies?: Record<string, string>;
          optionalDependencies?: Record<string, string>;
        };
      } catch {
        return undefined;
      }
    };
    const incoming = readPkg(path.join(inspectDir, "package", "package.json"));
    const installed = readPkg(path.join(root, "package.json"));
    if (!incoming || !installed || !depsUnchanged(installed, incoming)) {
      cleanup();
      return undefined;
    }
    return { tgz, root, cleanup };
  } catch {
    cleanup();
    return undefined;
  }
}

/** 增量替换后校验：`node <root>/dist/cli.js --version` 首行应等于目标版本。 */
function verifyIncrementalInstall(
  runner: CommandRunner,
  env: NodeJS.ProcessEnv,
  root: string,
  expectedVersion: string,
): boolean {
  try {
    const res = runner(
      process.execPath,
      [path.join(root, "dist", "cli.js"), "--version"],
      { encoding: "utf-8", env, stdio: "pipe" },
    );
    if (res.error || res.status !== 0) return false;
    const first = (res.stdout || "").trim().split(/\r?\n/)[0]?.trim();
    return first === expectedVersion;
  } catch {
    return false;
  }
}

/** Strip secrets / lock overrides from the env passed to npm install/view. */
export function buildPackageManagerEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.NUWACLI_PASSWORD;
  delete env.NUWAX_CONFIG_KEY;
  delete env.NUWAX_SAVED_KEY;
  delete env.NUWACLI_SERVE_LOCK_PATH;
  return env;
}

function resolveCommand(): string | null {
  return findOnPath("npm");
}

function printableCommand(command: string, args: string[]): string {
  return [command, ...args].join(" ");
}

export async function updateCommand(
  targetArg?: string,
  options: UpdateOptions = {},
  runnerArg?: CommandRunner | unknown,
): Promise<void> {
  try {
    // Commander passes its Command instance as the final action argument.
    // Older registrations forwarded updateCommand directly, so only accept
    // an actual function as the injectable test runner.
    const runner: CommandRunner =
      typeof runnerArg === "function"
        ? (runnerArg as CommandRunner)
        : runCommand;
    const resolved = resolveUpdateTarget(targetArg);
    const target = resolved.target;
    const command = resolveCommand();
    if (!command) {
      throw new Error(t("update.noNpm"));
    }

    const packageSpec = `${PACKAGE_NAME}@${target}`;
    const env = buildPackageManagerEnv();

    if (resolved.aliasedFrom) {
      console.log(
        dim(
          t("update.channelAlias", {
            from: resolved.aliasedFrom,
            to: target,
          }),
        ),
      );
    }

    const installArgs = buildInstallArgs(packageSpec, options.registry);
    // dry-run is local-only (no npm list/view) — print running binary version.
    if (options.dryRun) {
      console.log(t("update.currentVersion", { version: CLI_VERSION }));
      console.log(t("update.upgradeTarget", { spec: packageSpec }));
      console.log(
        t("update.execute", { cmd: printableCommand("npm", installArgs) }),
      );
      return;
    }

    // Prefer global install version over the running binary (npx may already
    // be on the channel while ~/.npm global is still older).
    const currentVersion =
      readGloballyInstalledVersion(
        runner,
        command,
        env,
        options.registry,
      ) ?? CLI_VERSION;

    if (options.check) {
      const viewArgs = buildViewArgs(packageSpec, options.registry);
      const result = runner(command, viewArgs, {
        encoding: "utf-8",
        env,
        stdio: "pipe",
      });
      if (result.error) throw result.error;
      if (result.status !== 0) {
        throw new Error(
          (result.stderr || result.stdout || t("update.queryFailed")).trim(),
        );
      }
      const remoteVersion = (result.stdout || "").trim();
      console.log(t("update.currentVersion", { version: currentVersion }));
      console.log(
        t("update.targetSpec", { spec: packageSpec, version: remoteVersion }),
      );
      if (remoteVersion === currentVersion)
        console.log(t("update.alreadyTarget"));
      else
        console.log(
          t("update.canUpgrade", { from: currentVersion, to: remoteVersion }),
        );
      return;
    }

    // 步骤 1/4：检查目标版本（stdio pipe，无终端输出，spinner 可独占行）
    const remoteVersion = await withSpinner(
      t("update.step1"),
      async () => {
        const versionResult = runner(
          command,
          buildViewArgs(packageSpec, options.registry),
          {
            encoding: "utf-8",
            env,
            stdio: "pipe",
          },
        );
        if (versionResult.error) throw versionResult.error;
        return versionResult.status === 0
          ? (versionResult.stdout || "").trim()
          : "";
      },
    );
    if (remoteVersion === currentVersion) {
      console.log(success(t("update.alreadyLatest")));
      return;
    }

    // 防降级:目标版本比当前旧(例如正式版用户的 `nuwa-cli update` 命中 beta 通道)
    // 则跳过安装,不把用户降级。确需切换/降级请显式 `npm i -g ...@<version>`。
    if (remoteVersion && compareSemver(remoteVersion, currentVersion) < 0) {
      console.log(
        warn(
          t("update.olderTarget", {
            current: currentVersion,
            target: remoteVersion,
          }),
        ),
      );
      return;
    }

    console.log(t("update.currentVersion", { version: currentVersion }));
    if (remoteVersion)
      console.log(t("update.targetVersion", { version: remoteVersion }));
    console.log(t("update.upgradeTarget", { spec: packageSpec }));
    console.log(
      t("update.execute", { cmd: printableCommand("npm", installArgs) }),
    );

    // Ask before any download / stop. Declining must not leave a partial
    // incremental staging dir or waste a npm pack round-trip.
    const running = collectRunningRuntimeSnapshot();
    if (
      hasRunningRuntimeProcesses(running) &&
      isInteractive() &&
      !isCI() &&
      !options.yes
    ) {
      const ok = await clack.confirm({
        message: t("update.confirmStopServices"),
      });
      if (clack.isCancel(ok) || !ok) {
        printCancelled(t("update.stopDeclined"));
        process.exitCode = clack.isCancel(ok) ? CANCEL_EXIT_CODE : 1;
        return;
      }
    }

    // 增量准备（只读安装目录、写临时目录，可安全先于停服执行）：依赖表与目标
    // 版本完全一致时，升级只需替换 CLI 自身文件（dist/cli.js 等，~1MB），跳过
    // npm 整树重装。npm -g 的依赖全部装在包目录内，root 版本一变会重写全部
    // node_modules（本机实测 357MB/1.5 万文件，其中 253MB 是 claude-agent-sdk
    // 平台二进制）——依赖没变时这些重写纯属浪费，也是 update 慢的主因。
    // 只比对一级依赖（dependencies + optionalDependencies）：npm -g 安装语义
    // 下根包 package.json 就是整棵 node_modules 的唯一规格来源，不递归传递树。
    // `--force` 强制走完整重装（doctor 对安装异常场景的修复指引即此命令）。
    const incremental =
      !options.force && remoteVersion
        ? await withSpinner(t("update.stepPrep"), async () =>
            prepareIncrementalUpdate(
              runner,
              env,
              remoteVersion,
              options.registry,
              command,
            ),
          )
        : undefined;
    if (options.force) console.log(dim(t("update.forceFull")));
    try {
      // 步骤 2/4：停止运行中的服务（异步、无 console 输出，spinner 可独占行）
      await withSpinner(t("update.step2"), () =>
        stopRuntimeProcessesForUpdate(),
      );
      console.log(success(t("update.stopped")));

      // 步骤 3/4：安装。保持 stdio:"inherit" 让 npm 自渲染进度条/spinner——
      // 不在其上叠加 CLI spinner，否则会与 npm 输出在同一终端行打架闪烁（历史踩坑）。
      console.log(dim(t("update.step3")) + packageSpec);
      let installed = false;
      if (incremental) {
        console.log(dim(t("update.incrementalHit")));
        const extract = runner(
          "tar",
          ["-xzf", incremental.tgz, "-C", incremental.root, "--strip-components=1"],
          { env, stdio: "pipe" },
        );
        installed =
          !extract.error &&
          extract.status === 0 &&
          verifyIncrementalInstall(runner, env, incremental.root, remoteVersion);
        if (installed) {
          console.log(success(t("update.incrementalDone")));
        } else {
          // 覆盖失败/校验不过：落回完整 npm 安装（npm 会整体替换包目录，结果仍正确）。
          console.log(dim(t("update.incrementalFailedFallback")));
        }
      }
      let result: CommandResult | undefined;
      if (!installed) {
        result =
          typeof runnerArg === "function"
            ? runner(command, installArgs, {
                env,
                stdio: "inherit",
              })
            : await runInstallWithProgress(command, installArgs, env);
      }
      if (result?.error) throw result.error;
      if (result && result.status !== 0) {
        // Prefer a specific hint when npm reports ETARGET (unknown tag/version);
        // Windows EBUSY hint only when the failure looks like a file lock.
        const detail = `${result.stderr ?? ""}\n${result.stdout ?? ""}`;
        if (/ETARGET|No matching version found/i.test(detail)) {
          console.error(t("update.etargetHint", { spec: packageSpec }));
        } else if (process.platform === "win32") {
          // Windows 上常见根因仍是 vendor .exe 被占用；stdio inherit 时用户已见 npm
          // EBUSY，这里补一条可操作建议（优先 update / 先 stop，勿裸 npm i -g）。
          console.error(t("update.windowsInstallFailedHint"));
        }
        process.exitCode = result.status ?? 1;
        return;
      }
      if (!installed) console.log(success(t("update.installDone")));
      console.log(t("update.doneHint"));
      // 步骤 4/4：升级后按登录态重启 serve。restart 子进程走 stdio:inherit 自带输出，
      // 故这里只打一行步骤提示，不用 live spinner（避免与 inherit 输出交错）。
      console.log(dim(t("update.step4")));
      await restartServeIfLoggedIn();
    } finally {
      incremental?.cleanup();
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}
