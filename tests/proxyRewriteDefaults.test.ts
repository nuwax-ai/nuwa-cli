/**
 * proxyRewrite 默认 MCP / PersistentMcpBridge 行为单测。
 * 对齐 Electron：空 ACP 列表仍注入 chrome-devtools（persistent）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveStdioNoWindow } from "../src/util/npxResolve.js";

const mocks = vi.hoisted(() => {
  const bridgeStart = vi.fn().mockResolvedValue(undefined);
  const bridgeStop = vi.fn().mockResolvedValue(undefined);
  const bridgeIsRunning = vi.fn(() => true);
  const bridgeGetBridgeUrl = vi.fn(
    (name: string) => `http://127.0.0.1:9/mcp/${name}`,
  );
  return {
    bridgeStart,
    bridgeStop,
    bridgeIsRunning,
    bridgeGetBridgeUrl,
    resolveProxyEntry: vi.fn(() => "/fake/mcp-proxy-ts/dist/index.js"),
    rewriteServersToProxyCommands: vi.fn(
      (servers: Record<string, unknown>) => {
        const out: Record<
          string,
          { command: string; args: string[]; env?: Record<string, string> }
        > = {};
        for (const name of Object.keys(servers)) {
          out[name] = {
            command: process.execPath,
            args: [
              "/fake/mcp-proxy-ts/dist/index.js",
              "--config-file",
              `/tmp/${name}.json`,
            ],
          };
        }
        return out;
      },
    ),
  };
});

vi.mock("@nuwax-ai/mcp-proxy-ts/host", async () => {
  const actual = await vi.importActual<
    typeof import("@nuwax-ai/mcp-proxy-ts/host")
  >("@nuwax-ai/mcp-proxy-ts/host");
  class MockBridge {
    start = mocks.bridgeStart;
    stop = mocks.bridgeStop;
    isRunning = mocks.bridgeIsRunning;
    getBridgeUrl = mocks.bridgeGetBridgeUrl;
  }
  return {
    ...actual,
    PersistentMcpBridge: MockBridge,
    resolveProxyEntry: mocks.resolveProxyEntry,
    rewriteServersToProxyCommands: mocks.rewriteServersToProxyCommands,
  };
});

describe("rewriteMcpServersForEngine defaults", () => {
  beforeEach(() => {
    mocks.bridgeStart.mockClear();
    mocks.bridgeStop.mockClear();
    mocks.resolveProxyEntry.mockReturnValue(
      "/fake/mcp-proxy-ts/dist/index.js",
    );
    mocks.rewriteServersToProxyCommands.mockClear();
    delete process.env.NUWACLI_MCP_PERSISTENT;
  });

  afterEach(async () => {
    const { stopPersistentMcpBridge } = await import(
      "../src/core/mcp/proxyRewrite.js"
    );
    await stopPersistentMcpBridge();
  });

  it("空 ACP 列表仍注入 chrome-devtools，并按 persistent 启动 bridge", async () => {
    const { rewriteMcpServersForEngine } = await import(
      "../src/core/mcp/proxyRewrite.js"
    );
    const out = await rewriteMcpServersForEngine([]);

    expect(mocks.bridgeStart).toHaveBeenCalledTimes(1);
    const started = mocks.bridgeStart.mock.calls[0]![0] as Record<
      string,
      { command: string; args?: string[]; persistent?: boolean }
    >;
    // npx is resolved away from the .cmd shim on Windows (no console flash);
    // resolveStdioNoWindow is a no-op on non-Windows.
    expect(started["chrome-devtools"]).toEqual({
      ...resolveStdioNoWindow("npx", ["-y", "chrome-devtools-mcp@latest"]),
      env: undefined,
      persistent: true,
    });

    expect(mocks.rewriteServersToProxyCommands).toHaveBeenCalledTimes(1);
    const merged = mocks.rewriteServersToProxyCommands.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(Object.keys(merged)).toEqual(["chrome-devtools"]);

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      name: "chrome-devtools",
      command: process.execPath,
    });
    expect(out[0]!.args[0]).toMatch(/mcp-proxy-ts.*dist[/\\]index\.js$/);
  });

  it("ACP 动态 MCP 与默认合并；同名覆盖 args，但保留默认 persistent", async () => {
    const { rewriteMcpServersForEngine } = await import(
      "../src/core/mcp/proxyRewrite.js"
    );
    await rewriteMcpServersForEngine([
      {
        name: "ask-question",
        command: "npx",
        args: ["-y", "nuwax-ask-question-mcp@latest"],
      },
      {
        name: "chrome-devtools",
        command: "npx",
        args: ["-y", "chrome-devtools-mcp@1.2.3"],
      },
    ]);

    const merged = mocks.rewriteServersToProxyCommands.mock.calls[0]![0] as Record<
      string,
      { command: string; args?: string[]; persistent?: boolean }
    >;
    expect(merged["ask-question"]).toMatchObject(
      resolveStdioNoWindow("npx", ["-y", "nuwax-ask-question-mcp@latest"]),
    );
    // ACP 可覆盖 args，但默认 persistent 强制保留
    expect(merged["chrome-devtools"]).toMatchObject({
      ...resolveStdioNoWindow("npx", ["-y", "chrome-devtools-mcp@1.2.3"]),
      persistent: true,
    });

    const started = mocks.bridgeStart.mock.calls[0]![0] as Record<
      string,
      { command?: string; args?: string[]; persistent?: boolean }
    >;
    expect(started["chrome-devtools"]).toMatchObject({
      ...resolveStdioNoWindow("npx", ["-y", "chrome-devtools-mcp@1.2.3"]),
      persistent: true,
    });
    expect(started["ask-question"]).toBeUndefined();
  });

  it("NUWACLI_MCP_PERSISTENT 可追加其它长驻名", async () => {
    process.env.NUWACLI_MCP_PERSISTENT = "ask-question";
    const { rewriteMcpServersForEngine } = await import(
      "../src/core/mcp/proxyRewrite.js"
    );
    await rewriteMcpServersForEngine([
      {
        name: "ask-question",
        command: "npx",
        args: ["-y", "nuwax-ask-question-mcp@latest"],
      },
    ]);

    const started = mocks.bridgeStart.mock.calls[0]![0] as Record<
      string,
      { persistent?: boolean }
    >;
    expect(started["chrome-devtools"]?.persistent).toBe(true);
    expect(started["ask-question"]?.persistent).toBe(true);
  });

  it("codex：ephemeral 原始 stdio，persistent 经 proxy 接 Bridge（并启动 Bridge）", async () => {
    const { rewriteMcpServersForEngine } = await import(
      "../src/core/mcp/proxyRewrite.js"
    );
    const out = await rewriteMcpServersForEngine(
      [
        {
          name: "ask-question",
          command: "npx",
          args: ["-y", "nuwax-ask-question-mcp@latest"],
          env: [],
        },
      ],
      undefined,
      "codex",
    );
    const names = out.map((s: { name: string }) => s.name);
    expect(names).toEqual(
      expect.arrayContaining(["chrome-devtools", "ask-question"]),
    );
    // ephemeral：原始 stdio（非 --config-file）
    const ask = out.find(
      (s: { name: string }) => s.name === "ask-question",
    ) as { command: string; args: string[] };
    expect(ask?.command).toBe(
      resolveStdioNoWindow("npx", ["-y", "nuwax-ask-question-mcp@latest"])
        .command,
    );
    expect(ask?.args).not.toContain("--config-file");
    // persistent：经 proxy 包装（接 Bridge URL）
    const cd = out.find(
      (s: { name: string }) => s.name === "chrome-devtools",
    ) as { command: string; args: string[] };
    expect(cd?.command).toBe(process.execPath);
    expect(cd?.args[0]).toMatch(/mcp-proxy-ts.*dist[/\\]index\.js$/);
    expect(cd?.args).toContain("--config-file");
    // Hub 级：codex 路径也会 ensure Bridge
    expect(mocks.bridgeStart).toHaveBeenCalled();
  });

  it("warmupPersistentMcpBridge 以 DEFAULT persistent 启动 Bridge", async () => {
    const { warmupPersistentMcpBridge, isPersistentMcpBridgeRunning } =
      await import("../src/core/mcp/proxyRewrite.js");
    await warmupPersistentMcpBridge();
    expect(mocks.bridgeStart).toHaveBeenCalled();
    const started = mocks.bridgeStart.mock.calls[0]![0] as Record<
      string,
      { persistent?: boolean }
    >;
    expect(started["chrome-devtools"]?.persistent).toBe(true);
    expect(isPersistentMcpBridgeRunning()).toBe(true);
  });

  it("跨名等价的下发 server 折叠回 DEFAULT persistent（chrome-tools ≡ chrome-devtools）", async () => {
    const { rewriteMcpServersForEngine } = await import(
      "../src/core/mcp/proxyRewrite.js"
    );
    const out = await rewriteMcpServersForEngine(
      [
        {
          // 云端原名 chrome-tools（sanitize 后 chrome_tools）；版本号不同也应命中
          name: "chrome-tools",
          command: "npx",
          args: ["chrome-devtools-mcp@0.14.0"],
        },
        {
          name: "ask-question",
          command: "npx",
          args: ["-y", "nuwax-ask-question-mcp@latest"],
        },
      ],
      "proj",
      "codex",
    );
    // chrome-tools 被 DEFAULT 兜底：不作为 ephemeral 下发（避免双开/ENOENT）
    const names = out.map((s: { name: string }) => s.name).sort();
    expect(names).toEqual(["ask-question", "chrome-devtools"]);
    // bridge 仍只托管 DEFAULT 的 chrome-devtools（persistent 集合未变）
    const started = mocks.bridgeStart.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(Object.keys(started)).toEqual(["chrome-devtools"]);
  });

  it("同名 chrome-devtools 下发走覆盖语义（定制 args 保留，不折叠）", async () => {
    const { rewriteMcpServersForEngine } = await import(
      "../src/core/mcp/proxyRewrite.js"
    );
    await rewriteMcpServersForEngine(
      [
        {
          name: "chrome-devtools",
          command: "npx",
          args: ["-y", "chrome-devtools-mcp@latest", "--headless"],
        },
      ],
      "proj",
      "claude",
    );
    const merged = mocks.rewriteServersToProxyCommands.mock.calls[0]![0] as Record<
      string,
      { args?: string[] }
    >;
    // 云端定制 args 覆盖 DEFAULT，且 persistent 保留（走 bridge）
    expect(merged["chrome-devtools"]?.args).toContain("--headless");
  });

  it("persistent 配置未变时复用运行中的 bridge，不重启（跨引擎/会话防抖）", async () => {
    const { rewriteMcpServersForEngine } = await import(
      "../src/core/mcp/proxyRewrite.js"
    );
    await rewriteMcpServersForEngine([], "proj", "codex");
    await rewriteMcpServersForEngine([], "proj", "claude"); // 另一引擎的新会话
    await rewriteMcpServersForEngine(
      [
        {
          name: "ask-question",
          command: "npx",
          args: ["-y", "nuwax-ask-question-mcp@latest"],
        },
      ],
      "proj",
      "claude",
    ); // 动态 ephemeral 增删不触碰 persistent 集合
    expect(mocks.bridgeStart).toHaveBeenCalledTimes(1); // 从未重启

    // persistent 集合真正变化（env 追加长驻名）→ 才走 stop/start
    process.env.NUWACLI_MCP_PERSISTENT = "extra-svc";
    await rewriteMcpServersForEngine(
      [
        {
          name: "extra-svc",
          command: "npx",
          args: ["-y", "extra-svc@latest"],
        },
      ],
      "proj",
      "codex",
    );
    expect(mocks.bridgeStart).toHaveBeenCalledTimes(2);
  });
});

describe("DEFAULT_MCP_PROXY_SERVERS", () => {
  it("与 Electron DEFAULT_MCP_PROXY_CONFIG 对齐", async () => {
    const { DEFAULT_MCP_PROXY_SERVERS } = await import(
      "../src/core/mcp/defaultServers.js"
    );
    expect(DEFAULT_MCP_PROXY_SERVERS["chrome-devtools"]).toEqual({
      command: "npx",
      args: ["-y", "chrome-devtools-mcp@latest"],
      persistent: true,
    });
    expect(
      DEFAULT_MCP_PROXY_SERVERS["chrome-devtools"]!.args,
    ).not.toContain("--isolated");
  });
});
