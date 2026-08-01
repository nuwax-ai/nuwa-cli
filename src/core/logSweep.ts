/**
 * 统一日志清扫 + codex 日志按天轮转。
 *
 * 设计要点:
 * - `sweepOldLogs`:递归遍历 `logsDir()`,删除 mtime 超过 `LOG_RETENTION_DAYS` 的
 *   `.log` 文件。一条"`.log` 后缀 + mtime"规则覆盖 main / serve / codex /
 *   mcp-proxy / file-server / launchd 全部日志;非日志(`*.json`/`*.guard`/lock)自动忽略。
 *   永不删 `latest.log`(指向今日 main 的指针)与活动中的 `codex/app-server.log`
 *   (后者由 `rotateCodexLog` 管)。顺带清理空目录。
 * - `rotateCodexLog`:codex 适配器(`@nuwax-ai/nuwax-codex-acp-ts`)把日志写死成
 *   `app-server.log`、按行 `appendFileSync`(开-写-关,不持 fd),所以可在两次写入
 *   之间安全 rename;按天把活动文件归档为 `app-server-<YYYY-MM-DD>.log`。
 * - `runLogMaintenance`:由 `debugLog.ts` 既有每小时定时器调用(先轮转、再清扫)。
 *
 * 所有操作 best-effort,绝不抛错——日志不得阻断主流程(沿用 debugLog 风格)。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  ensureDir,
  logsDir,
  codexLogDir,
  todayDateStr,
} from "../util/paths.js";

export const LOG_RETENTION_DAYS = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 永不删除的文件名(小写)。`latest.log` 是指针;`app-server.log` 由轮转步骤独占管理。 */
const NEVER_DELETE = new Set(["latest.log", "app-server.log"]);

function isLogFileName(name: string): boolean {
  return name.toLowerCase().endsWith(".log");
}

/**
 * 递归删除 `rootDir` 下 mtime 超过 `maxAgeDays` 天的 `.log` 文件。
 * 排除 `latest.log` 与活动的 `app-server.log`;best-effort 清理因删除而变空的目录
 * (不删 `rootDir` 本身)。单个文件失败不影响其余。
 */
export function sweepOldLogs(
  maxAgeDays: number = LOG_RETENTION_DAYS,
  rootDir: string = logsDir(),
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true });
  } catch {
    return; // 目录不存在/不可读:无事可做。
  }
  const now = Date.now();
  const maxMs = maxAgeDays * DAY_MS;
  for (const entry of entries) {
    const full = path.join(rootDir, entry.name);
    try {
      if (entry.isDirectory()) {
        sweepOldLogs(maxAgeDays, full);
        try {
          fs.rmdirSync(full); // 仅当已空时成功;否则忽略。
        } catch {
          /* 非空或无权限,跳过。 */
        }
        continue;
      }
      // 跳过符号链接等非普通文件(latest.log 在 Unix 是符号链接,这里自然跳过)。
      if (!entry.isFile()) continue;
      if (!isLogFileName(entry.name)) continue;
      if (NEVER_DELETE.has(entry.name.toLowerCase())) continue;
      const stat = fs.statSync(full);
      if (now - stat.mtimeMs <= maxMs) continue; // 未过期,保留。
      fs.unlinkSync(full);
    } catch {
      // 单个文件失败不中断整体清扫。
    }
  }
}

/** 进程内记忆"上次轮转到的日期",用于 daemon 跨天检测(短命进程每次从 null 开始)。 */
let lastRolledDay: string | null = null;

/** 把 `src` 归档为 `<codexDir>/app-server-<day>.log`;目标已存在则回退追加再删源。 */
function rollCodexFile(src: string, day: string, codexDir: string): void {
  const dest = path.join(codexDir, `app-server-${day}.log`);
  try {
    fs.renameSync(src, dest);
  } catch {
    // Windows 上 dest 已存在时 rename 抛错 → 回退:读旧文件内容追加到 dest,再删旧文件。
    try {
      fs.appendFileSync(dest, fs.readFileSync(src));
      fs.unlinkSync(src);
    } catch {
      // 尽力而为;本次轮转放弃,下次再说。
    }
  }
}

/**
 * 把 codex 适配器的活动 `app-server.log` 按天归档。
 *
 * - 冷启动(`lastRolledDay===null`,每个进程首次):若活动文件的 mtime 日期早于今天,
 *   按它自身的日期归档(`app-server-<它那天>.log`);今天的文件不动。
 * - 稳态(daemon 每小时 tick):若已跨天,把当前文件按昨天归档。
 *
 * 活动的今日文件永远不被动;文件不存在时只刷新状态。codex 适配器下一次 `appendFileSync`
 * 会自动重建新的 `app-server.log`。
 */
export function rotateCodexLog(codexDir: string = codexLogDir()): void {
  try {
    ensureDir(codexDir);
    const active = path.join(codexDir, "app-server.log");
    const today = todayDateStr();
    if (!fs.existsSync(active)) {
      lastRolledDay = today;
      return;
    }
    if (lastRolledDay === null) {
      // 冷启动:按文件自身 mtime 日期归档(仅当不是今天)。
      const fileDay = todayDateStr(fs.statSync(active).mtime);
      if (fileDay < today) rollCodexFile(active, fileDay, codexDir);
      lastRolledDay = today;
      return;
    }
    // 稳态:跨天则按昨天归档。
    if (today !== lastRolledDay) {
      rollCodexFile(active, lastRolledDay, codexDir);
      lastRolledDay = today;
    }
  } catch {
    // 轮转失败不影响后续清扫与主流程。
  }
}

/** 由 `debugLog.ts` 每小时定时器调用:先按天轮转 codex 日志,再递归清扫过期日志。 */
export function runLogMaintenance(): void {
  rotateCodexLog();
  sweepOldLogs();
}
