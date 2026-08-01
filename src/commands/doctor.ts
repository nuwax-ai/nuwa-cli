import pc from "picocolors";
import { runAllDoctorChecks } from "../core/detect/doctorChecks.js";
import { restartAllServicesForced } from "./restart.js";

export interface DoctorCommandOptions {
  fix?: boolean;
}

export async function doctorCommand(
  options: DoctorCommandOptions = {},
): Promise<void> {
  if (options.fix) {
    // --fix = 强制重启所有服务（Gateway / file-server / lanproxy），与 restart 同逻辑：
    // 清掉所有旧进程后由 Gateway daemon 重新拉起全部子服务。比单例去重更彻底，能修复
    // detached 子进程占端口、只重启了 gateway 等运行态问题。
    try {
      console.log(pc.cyan("正在强制重启所有服务以修复运行状态..."));
      await restartAllServicesForced();
      if (process.exitCode && process.exitCode !== 0) {
        console.error(pc.red("[nuwa-cli] 服务重启失败。"));
      } else {
        console.log(
          pc.green("已强制重启所有服务（Gateway / file-server / lanproxy）。"),
        );
      }
      console.log();
    } catch (err) {
      console.error(
        pc.red(`[nuwa-cli] 自动重启服务失败：${(err as Error).message}`),
      );
      process.exitCode = 1;
    }
  }

  const results = await runAllDoctorChecks();
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
