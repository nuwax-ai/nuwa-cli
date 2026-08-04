import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// 把 clack.spinner 换成记录桩,使 TTY 分支可在无真实终端下验证。
const spinnerRecord = {
  started: "",
  messages: [] as string[],
  cleared: 0,
  cancelled: "",
};
vi.mock("@clack/prompts", () => ({
  spinner: () => ({
    start: (m: string) => {
      spinnerRecord.started = m;
    },
    message: (m: string) => {
      spinnerRecord.messages.push(m);
    },
    clear: () => {
      spinnerRecord.cleared++;
    },
    cancel: (m: string) => {
      spinnerRecord.cancelled = m;
    },
  }),
}));

const ui = await import("../src/util/ui.js");

let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  spinnerRecord.started = "";
  spinnerRecord.messages = [];
  spinnerRecord.cleared = 0;
  spinnerRecord.cancelled = "";
});

afterEach(() => {
  logSpy.mockRestore();
});

describe("ui 符号与语义色", () => {
  it("符号是已上色的字符串", () => {
    expect(typeof ui.SYM_OK).toBe("string");
    expect(typeof ui.SYM_FAIL).toBe("string");
    expect(typeof ui.SYM_INFO).toBe("string");
    expect(ui.success("x")).toBe(ui.pc.green("x"));
    expect(ui.dim("x")).toBe(ui.pc.dim("x"));
  });
});

describe("ui 取消语义", () => {
  it("UserCancelled 是可识别的 Error 子类", () => {
    const e = new ui.UserCancelled();
    expect(e).toBeInstanceOf(Error);
    expect(ui.isUserCancelled(e)).toBe(true);
    expect(ui.isUserCancelled(new Error("Cancelled."))).toBe(false);
    expect(e.message).toBe("Cancelled.");
  });

  it("printCancelled 默认走 i18n(英文)", () => {
    ui.printCancelled();
    expect(logSpy).toHaveBeenCalledWith(ui.pc.dim("Cancelled."));
  });

  it("printCancelled 接受自定义文案", () => {
    ui.printCancelled("custom");
    expect(logSpy).toHaveBeenCalledWith(ui.pc.dim("custom"));
  });

  it("printShuttingDown 统一关闭文案(英文)", () => {
    ui.printShuttingDown("SIGINT");
    expect(logSpy).toHaveBeenCalledWith(
      ui.pc.dim("\n[nuwa-cli] received SIGINT, shutting down..."),
    );
  });
});

describe("printResultLine", () => {
  it("通过 → ✔,必需失败 → ✖,可选未达 → ○", () => {
    ui.printResultLine({ ok: true, label: "Node", detail: "v22" });
    expect(logSpy).toHaveBeenLastCalledWith(`${ui.SYM_OK} ${ui.pc.bold("Node")}: v22`);

    ui.printResultLine({ ok: false, label: "Node", detail: "v18", required: true });
    expect(logSpy).toHaveBeenLastCalledWith(`${ui.SYM_FAIL} ${ui.pc.bold("Node")}: v18`);

    ui.printResultLine({ ok: false, label: "uv", detail: "缺失", required: false });
    expect(logSpy).toHaveBeenLastCalledWith(`${ui.SYM_INFO} ${ui.pc.bold("uv")}: 缺失`);
  });

  it("失败默认按必需处理(✖)", () => {
    ui.printResultLine({ ok: false, label: "X", detail: "d" });
    expect(logSpy).toHaveBeenLastCalledWith(`${ui.SYM_FAIL} ${ui.pc.bold("X")}: d`);
  });

  it("带 fix 时跟一行灰色 → 提示", () => {
    ui.printResultLine({ ok: false, label: "uv", detail: "缺失", fix: "安装 uv", required: false });
    const calls = logSpy.mock.calls;
    expect(calls[calls.length - 1]).toEqual([`  ${ui.SYM_FIX} ${ui.pc.dim("安装 uv")}`]);
  });
});

describe("spinner 非 TTY 降级(NoopSpinner)", () => {
  it("vitest 下非交互式,isInteractive() 为 false", () => {
    expect(ui.isInteractive()).toBe(false);
  });

  it("start/message 在文案变化时打一行 dim,stop 无操作", () => {
    const s = ui.spinner();
    s.start("正在检测 A...");
    s.message("正在检测 B...");
    s.message("正在检测 B..."); // 重复,不应再打
    s.message("正在检测 C...");
    s.stop();
    const dimmed = logSpy.mock.calls.map((c) => String(c[0]));
    expect(dimmed).toEqual([
      ui.pc.dim("正在检测 A..."),
      ui.pc.dim("正在检测 B..."),
      ui.pc.dim("正在检测 C..."),
    ]);
  });

  it("withSpinner 返回任务结果并打印 start dim 行", async () => {
    const r = await ui.withSpinner("正在工作...", async () => 42);
    expect(r).toBe(42);
    expect(logSpy).toHaveBeenCalledWith(ui.pc.dim("正在工作..."));
  });

  it("withSpinner 任务抛错时重新抛出(调用方负责打红字)", async () => {
    await expect(
      ui.withSpinner("正在工作...", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});

describe("spinner TTY 分支(走 clack)", () => {
  beforeEach(() => {
    vi.stubEnv("CI", "");
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
  });
  afterEach(() => {
    Object.defineProperty(process.stdout, "isTTY", { value: undefined, configurable: true });
    Object.defineProperty(process.stdin, "isTTY", { value: undefined, configurable: true });
    vi.unstubAllEnvs();
  });

  it("spinner 使用 clack:start→message→stop(clear,不打符号)", async () => {
    const s = ui.spinner();
    s.start("正在注册...");
    s.message("正在等待健康检查...");
    s.stop();
    expect(spinnerRecord.started).toBe("正在注册...");
    expect(spinnerRecord.messages).toEqual(["正在等待健康检查..."]);
    // stop 映射到 clack.clear()(静默),而非 stop()(会画绿色 submit 符号)
    expect(spinnerRecord.cleared).toBe(1);
  });

  it("withSpinner 调用 start 并在 finally 调 clear(即便抛错)", async () => {
    const clearedBefore = spinnerRecord.cleared;
    const r = await ui.withSpinner("正在注册...", async (sp) => {
      sp.message("切换中...");
      return "ok";
    });
    expect(r).toBe("ok");
    expect(spinnerRecord.started).toBe("正在注册...");
    expect(spinnerRecord.cleared).toBe(clearedBefore + 1);

    spinnerRecord.cleared = 0;
    await expect(
      ui.withSpinner("正在注册...", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(spinnerRecord.cleared).toBe(1); // finally 仍清理
  });
});
