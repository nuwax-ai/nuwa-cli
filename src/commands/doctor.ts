import pc from "picocolors";
import {
  runAllDoctorChecks,
  type DoctorCheckResult,
} from "../core/detect/doctorChecks.js";
import { restartAllServicesForced } from "./restart.js";
import { serviceInstallCommand } from "./service.js";
import { withSpinner, printResultLine } from "../util/ui.js";
import { t } from "../util/i18n/index.js";

export interface DoctorCommandOptions {
  fix?: boolean;
}

/** 可由 doctor --fix 自动补装的检查项 */
const AUTOSTART_CHECK_ID = "autostart";

/**
 * 运行态异常：多实例、Gateway/lanproxy 不一致等——靠清栈重建修复。
 * 缺平台包等安装类 lanproxy 失败不在此列（重启无意义）。
 *
 * 用 `--omit=optional`（语言无关的 CLI flag）判定"需要重装而非重启"的 lanproxy
 * 失败，避免依赖文案文本（i18n 后文案会变语言）。
 */
function needsServiceStackRestart(results: DoctorCheckResult[]): boolean {
  for (const result of results) {
    if (result.ok) continue;
    if (result.id === "serve-singleton" || result.id === "ui-singleton") {
      return true;
    }
    if (result.id === "lanproxy") {
      const fix = result.fix ?? "";
      if (fix.includes("--omit=optional")) {
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
    console.log(pc.dim(t("doctor.noFixNeeded")));
    console.log();
    return;
  }

  if (installAutostart) {
    try {
      console.log(pc.dim(t("doctor.fixInstallAutostart")));
      await serviceInstallCommand({ now: false });
      console.log();
    } catch (err) {
      console.error(
        pc.red(
          t("doctor.fixInstallAutostartFailed", { msg: (err as Error).message }),
        ),
      );
      process.exitCode = 1;
      console.log();
    }
  }

  if (restartStack) {
    try {
      console.log(pc.dim(t("doctor.fixStack")));
      await restartAllServicesForced();
      if (process.exitCode && process.exitCode !== 0) {
        console.error(pc.red(t("doctor.fixStackFailed")));
      } else {
        console.log(pc.green(t("doctor.fixStackDone")));
      }
      console.log();
    } catch (err) {
      console.error(
        pc.red(t("doctor.fixStackError", { msg: (err as Error).message })),
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
    printResultLine({
      ok: result.ok,
      label: result.label,
      detail: result.detail,
      fix: result.fix,
      required: isRequired,
    });
  }

  // claude/codex are each individually optional (chat --engine picks one),
  // but having *neither* usable means there's nothing this CLI can actually
  // run — that's the one case their otherwise-"info" checks should escalate.
  const claudeOk = results.find((r) => r.id === "claude")?.ok ?? false;
  const codexOk = results.find((r) => r.id === "codex")?.ok ?? false;
  if (!claudeOk && !codexOk) {
    hasRequiredFailure = true;
    console.log(pc.red(t("doctor.noEngine")));
  }

  return { hasRequiredFailure, hasInfoGap };
}

export async function doctorCommand(
  options: DoctorCommandOptions = {},
): Promise<void> {
  if (options.fix) {
    const precheck = await withSpinner(t("doctor.fixChecking"), () =>
      runAllDoctorChecks(),
    );
    await applyDoctorFixes(precheck);
  }

  // --fix 后复检，展示修复后的真实状态；纯 doctor 则只检一次。
  // 检测期间用 spinner 逐项切换文案，避免 13 项串行探测时的静默。
  const results = await withSpinner(
    options.fix ? t("doctor.recheck") : t("doctor.checking"),
    (s) => runAllDoctorChecks({ onProgress: (m) => s.message(m) }),
  );
  const { hasRequiredFailure, hasInfoGap } = printDoctorResults(results);

  console.log();
  if (hasRequiredFailure) {
    console.log(pc.red(t("doctor.summary.requiredFail")));
  } else if (hasInfoGap) {
    console.log(
      pc.green(t("doctor.summary.coreOk")) +
        pc.dim(t("doctor.summary.infoGapSuffix")),
    );
  } else {
    console.log(pc.green(t("doctor.summary.allOk")));
  }

  if (hasRequiredFailure) process.exitCode = 1;
}
