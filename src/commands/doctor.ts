import pc from "picocolors";
import {
  runAllDoctorChecks,
  type DoctorCheckResult,
} from "../core/detect/doctorChecks.js";
import { restartAllServicesForced } from "./restart.js";
import { serviceInstallCommand } from "./service.js";

export interface DoctorCommandOptions {
  fix?: boolean;
}

/** 可由 doctor --fix 自动补装的检查项 */
const AUTOSTART_CHECK_ID = "autostart";

/**
 * 运行态异常：多实例、Gateway/lanproxy 不一致等——靠清栈重建修复。
 * 缺平台包等安装类 lanproxy 失败不在此列（重启无意义）。
 */
function needsServiceStackRestart(results: DoctorCheckResult[]): boolean {
  for (const result of results) {
    if (result.ok) continue;
    if (result.id === "serve-singleton" || result.id === "ui-singleton") {
      return true;
    }
    if (result.id === "lanproxy") {
      const fix = result.fix ?? "";
      if (fix.includes("重新安装") || fix.includes("--omit=optional")) {
        continue;
      }
      return true;
    }
  }
  return false;
}

function needsAutostartInstall(results: DoctorCheckResult[]): boolean {
  return results.some((r) => r.id === AUTOSTART_CHECK_ID && !r.ok);
}

/**
 * doctor --fix：根据预检结果按需自动修复。
 * - 未装登录自启 → service install（now:false，避免与随后的 restart 抢起）
 * - 服务运行态异常 → 强制清栈并重建 Gateway（含 file-server / lanproxy）
 * - 都健康 → 跳过重启，避免无谓打断
 * Console 多实例会被清掉，但不自动重开前台（避免抢占终端）。
 */
async function applyDoctorFixes(precheck: DoctorCheckResult[]): Promise<void> {
  const installAutostart = needsAutostartInstall(precheck);
  const restartStack = needsServiceStackRestart(precheck);

  if (!installAutostart && !restartStack) {
    console.log(pc.dim("未发现需要自动修复的运行态问题。"));
    console.log();
    return;
  }

  if (installAutostart) {
    try {
      console.log(pc.cyan("正在安装登录自启（KeepAlive）..."));
      await serviceInstallCommand({ now: false });
      console.log();
    } catch (err) {
      console.error(
        pc.red(`[nuwa-cli] 安装登录自启失败：${(err as Error).message}`),
      );
      process.exitCode = 1;
      console.log();
    }
  }

  if (restartStack) {
    try {
      console.log(pc.cyan("正在修复服务运行态（清理异常进程并重建 Gateway 栈）..."));
      await restartAllServicesForced();
      if (process.exitCode && process.exitCode !== 0) {
        console.error(pc.red("[nuwa-cli] 服务修复失败。"));
      } else {
        console.log(
          pc.green(
            "已重建 Gateway 栈（Gateway / file-server / lanproxy）。多余 Console 已清理，需要时请再运行 `nuwa-cli console`。",
          ),
        );
      }
      console.log();
    } catch (err) {
      console.error(
        pc.red(`[nuwa-cli] 自动修复服务失败：${(err as Error).message}`),
      );
      process.exitCode = 1;
    }
  }
}

function printDoctorResults(results: DoctorCheckResult[]): {
  hasRequiredFailure: boolean;
  hasInfoGap: boolean;
} {
  let hasRequiredFailure = false;
  let hasInfoGap = false;

  for (const result of results) {
    const isRequired = result.severity === "required";
    if (!result.ok) {
      if (isRequired) hasRequiredFailure = true;
      else hasInfoGap = true;
    }
    // "✖" (red) only for a required failure; an unmet optional/info check
    // (Nuwax not logged in, optional uv missing, ...) is expected for
    // most setups and isn't an error — shown as "○" instead so the output
    // doesn't read as broken when `doctor` still exits 0.
    const mark = result.ok
      ? pc.green("✔")
      : isRequired
        ? pc.red("✖")
        : pc.dim("○");
    console.log(`${mark} ${pc.bold(result.label)}: ${result.detail}`);
    if (result.fix) {
      console.log(`  ${pc.dim("→")} ${pc.dim(result.fix)}`);
    }
  }

  // claude/codex are each individually optional (chat --engine picks one),
  // but having *neither* usable means there's nothing this CLI can actually
  // run — that's the one case their otherwise-"info" checks should escalate.
  const claudeOk = results.find((r) => r.id === "claude")?.ok ?? false;
  const codexOk = results.find((r) => r.id === "codex")?.ok ?? false;
  if (!claudeOk && !codexOk) {
    hasRequiredFailure = true;
    console.log(
      pc.red("✖ 没有可用的引擎：claude 和 codex 都未就绪，chat 无法运行。"),
    );
  }

  return { hasRequiredFailure, hasInfoGap };
}

export async function doctorCommand(
  options: DoctorCommandOptions = {},
): Promise<void> {
  if (options.fix) {
    console.log(pc.cyan("正在检测可自动修复的问题..."));
    const precheck = await runAllDoctorChecks();
    await applyDoctorFixes(precheck);
  }

  // --fix 后复检，展示修复后的真实状态；纯 doctor 则只检一次。
  const results = await runAllDoctorChecks();
  const { hasRequiredFailure, hasInfoGap } = printDoctorResults(results);

  console.log();
  if (hasRequiredFailure) {
    console.log(pc.red("存在阻塞性问题，见上方 ✖ 标记的修复建议。"));
  } else if (hasInfoGap) {
    console.log(
      pc.green("核心环境检测通过。") +
        pc.dim("（部分可选项未配置，见上方 ○ 标记，不影响基本使用）"),
    );
  } else {
    console.log(pc.green("环境检测全部通过。"));
  }

  if (hasRequiredFailure) process.exitCode = 1;
}
