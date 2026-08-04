/**
 * 终端 UI 原语的单一来源:符号、语义色、前缀、取消语义、spinner 封装。
 *
 * 设计要点:
 * - re-export `pc`(picocolors),旧代码零成本共存;迁移按文件 opt-in,不要一次性
 *   改完全项目。
 * - 符号沿用 doctor.ts 早已确立的 `✔/✖/○/→`(新增 `▲` 用于 warn),不采用 clack 的
 *   `◇/◆`,避免一套 CLI 两套符号。
 * - spinner 完成态用 `clear()` 静默清行,结果行由调用方用本模块的符号/色自行打印。
 * - 非 TTY / CI 下 spinner 降级为 NoopSpinner:`@clack/prompts` 的 spinner 自身没有
 *   isTTY 守卫,管道下会写 cursor 转义码并每帧刷新,污染输出。NoopSpinner 只在文案变化
 *   时打一行 dim,无 setInterval、无信号监听器,进程可正常退出。
 * - 所有 spinner 站点应使用 `withSpinner`(强制 try/finally 保 stop),杜绝 clack.spinner
 *   内部的 setInterval + SIGINT 监听器泄漏(忘 stop 会导致进程挂住)。
 */
import pc from "picocolors";
import * as clack from "@clack/prompts";
import { t } from "./i18n/index.js";

export { pc };

// —— 前缀(对齐全项目 ~36 处 `[nuwa-cli]` 红字错误约定)——
export const CLI_TAG = "[nuwa-cli]";
/** 红字错误前缀行:`[nuwa-cli] <msg>`。 */
export const errTag = (m: string): string => pc.red(`${CLI_TAG} ${m}`);
/** 黄字警告前缀行:`[nuwa-cli] <msg>`。 */
export const warnTag = (m: string): string => pc.yellow(`${CLI_TAG} ${m}`);

// —— 符号(全项目唯一来源,与 doctor.ts 一致)——
export const SYM_OK = pc.green("✔");
export const SYM_FAIL = pc.red("✖");
/** 可选/未达:不算错误(对应 doctor 的 info 未满足)。 */
export const SYM_INFO = pc.dim("○");
export const SYM_WARN = pc.yellow("▲");
/** 修复提示前缀。 */
export const SYM_FIX = pc.dim("→");

// —— 语义色(返回字符串,便于拼接)——
export const success = (s: string): string => pc.green(s);
export const warn = (s: string): string => pc.yellow(s);
export const danger = (s: string): string => pc.red(s);
export const dim = (s: string): string => pc.dim(s);
export const bold = (s: string): string => pc.bold(s);

// —— 环境检测 ——
/** stdout 与 stdin 均为 TTY:spinner 动画与按键取消都可用。 */
export const isInteractive = (): boolean =>
  process.stdout.isTTY === true && process.stdin.isTTY === true;
/** CI 环境(clack.core 的 isCI 同款判定)。 */
export const isCI = (): boolean => process.env.CI === "true";

// —— 取消(C7:把"已取消"从红色 Error 改成静默退出)——
/**
 * 用户主动取消的进程退出码(Unix 惯例:128 + SIGINT=2)。调用方据此区分
 * "取消"(静默返回)与"失败"(红色错误)。
 */
export const CANCEL_EXIT_CODE = 130;
/** 用户主动取消(clack 取消 / Esc / Ctrl+C)。不应被渲染成红色失败。 */
export class UserCancelled extends Error {
  constructor(message: string = t("common.cancelled")) {
    super(message);
    this.name = "UserCancelled";
  }
}
export function isUserCancelled(e: unknown): e is UserCancelled {
  return e instanceof UserCancelled;
}
/** 打印灰色取消提示。 */
export function printCancelled(msg?: string): void {
  console.log(pc.dim(msg ?? t("common.cancelled")));
}

// —— 统一关闭文案(C10)——
export function printShuttingDown(signal?: string): void {
  console.log(
    pc.dim(t("common.shuttingDown", { signal: signal ?? t("common.signal") })),
  );
}

// —— 结构化结果行(收敛 doctor.ts 的 ✔/✖/○/→ 渲染)——
export interface ResultLineOpts {
  ok: boolean;
  label: string;
  detail: string;
  /** 修复建议(给出后跟一行灰色 `→ ...`)。 */
  fix?: string;
  /**
   * 必需项。仅当 !ok 时影响标记:required=true→✖(红),required=false→○(灰)。
   * 默认 true,使一个普通失败行显示 ✖。
   */
  required?: boolean;
}
export function printResultLine(o: ResultLineOpts): void {
  const required = o.required ?? true;
  const mark = o.ok
    ? SYM_OK
    : required
      ? SYM_FAIL
      : SYM_INFO;
  console.log(`${mark} ${pc.bold(o.label)}: ${o.detail}`);
  if (o.fix) {
    console.log(`  ${SYM_FIX} ${pc.dim(o.fix)}`);
  }
}

// —— spinner ——
export interface SpinnerHandle {
  /** 开始(或恢复)spinner;非 TTY 下打一行 dim。 */
  start(msg?: string): void;
  /** 切换进行中文案;非 TTY 下文案变化时打一行 dim。 */
  message(msg: string): void;
  /** 静默清行(TTY 清动画,非 TTY 无操作);不打符号。之后由调用方打结果行。 */
  stop(): void;
  /** 取消:打一行 dim(msg)(非 TTY)或 clack 的取消态(TTY)。 */
  cancel(msg?: string): void;
}

export interface SpinnerOptions {
  /** 把 spinner 接到一个既有 AbortController(如 serve 的 shutdownAbort),Ctrl+C 时联动取消。 */
  signal?: AbortSignal;
}

/**
 * 创建一个 spinner。TTY 且非 CI 用 `@clack/prompts` 的 spinner(动画);
 * 否则用 NoopSpinner(每步一行 dim)。返回的 `stop()` 永远是静默清行。
 */
export function spinner(opts: SpinnerOptions = {}): SpinnerHandle {
  if (!isInteractive() || isCI()) return makeNoopSpinner();
  const s = clack.spinner({ signal: opts.signal, output: process.stdout });
  return {
    start: (m) => s.start(m),
    message: (m) => s.message(m),
    // clack.stop() 会画一个绿色 submit 符号;我们要静默,故用 clear()。
    stop: () => s.clear(),
    cancel: (m) => s.cancel(m),
  };
}

/** 非 TTY / CI 降级:无动画、无 setInterval、无信号监听器,进程可正常退出。 */
function makeNoopSpinner(): SpinnerHandle {
  let last = "";
  const line = (msg?: string): void => {
    const text = msg ?? "";
    if (text && text !== last) {
      console.log(pc.dim(text));
      last = text;
    }
  };
  return {
    start: (m) => line(m),
    message: (m) => line(m),
    stop: () => {},
    cancel: (m) => {
      if (m) console.log(pc.dim(m));
    },
  };
}

/**
 * 包裹一个异步任务:启动 spinner → 跑任务 → finally 静默 stop。
 * 即使任务抛错也会清行(再由调用方 catch 打印红色错误行)。
 *
 * 用法:`const r = await withSpinner("正在检测环境...", (s) => doWork(s));`
 */
export async function withSpinner<T>(
  msg: string,
  fn: (s: SpinnerHandle) => Promise<T>,
  opts?: SpinnerOptions,
): Promise<T> {
  const s = spinner(opts);
  try {
    s.start(msg);
    return await fn(s);
  } finally {
    s.stop();
  }
}
