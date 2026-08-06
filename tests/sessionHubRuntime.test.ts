import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  targets: [] as unknown[],
  newSessionRequests: [] as unknown[],
  notifications: [] as Array<{ method: string; params: unknown }>,
  requests: [] as Array<{ method: string; params: unknown }>,
  engineIds: [] as string[],
  bridgeStart: vi.fn().mockResolvedValue(undefined),
  bridgeStop: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/core/engines/registry.js", () => ({
  getEngine: (engineId: string) => ({
    resolve: async () => ({
      command: "node",
      args: [`${engineId}-acp`],
      envOverlay: {},
    }),
  }),
}));

// 避免单测真实 spawn chrome-devtools-mcp（PersistentMcpBridge）
vi.mock("@nuwax-ai/mcp-proxy-ts/host", async () => {
  const actual = await vi.importActual<
    typeof import("@nuwax-ai/mcp-proxy-ts/host")
  >("@nuwax-ai/mcp-proxy-ts/host");
  class MockBridge {
    start = mocks.bridgeStart;
    stop = mocks.bridgeStop;
    isRunning = () => true;
    getBridgeUrl = (name: string) => `http://127.0.0.1:9/mcp/${name}`;
  }
  return {
    ...actual,
    PersistentMcpBridge: MockBridge,
  };
});

vi.mock("../src/core/acp/connection.js", () => ({
  withEngineConnection: async (
    target: unknown,
    _handlers: unknown,
    op: (ctx: unknown) => Promise<unknown>,
  ) => {
    mocks.targets.push(target);
    const ctx = {
      buildSession: (request: unknown) => {
        mocks.newSessionRequests.push(request);
        return {
          start: async () => ({
            sessionId: `acp-session-${mocks.newSessionRequests.length}`,
            modes: null,
            newSessionResponse: { configOptions: [] },
            prompt: async () => ({}),
          }),
        };
      },
      notify: async (method: string, params: unknown) => {
        mocks.notifications.push({ method, params });
      },
      request: async (method: string, params: unknown) => {
        mocks.requests.push({ method, params });
        return {};
      },
    };
    return op(ctx);
  },
}));

describe("SessionHub ACP runtime precedence", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.targets.length = 0;
    mocks.newSessionRequests.length = 0;
    mocks.notifications.length = 0;
    mocks.requests.length = 0;
    mocks.engineIds.length = 0;
    mocks.bridgeStart.mockClear();
    mocks.bridgeStop.mockClear();
  });

  it("uses session model/env overrides and forwards MCP servers", async () => {
    const { SessionHub } = await import("../src/core/serve/sessionHub.js");
    const hub = new SessionHub({
      permissionMode: "deny-noninteractive",
      overlay: {
        apiKey: "gateway-key",
        baseUrl: "https://gateway.example.com",
        model: "gateway-model",
      },
    });
    const mcpServers = [
      {
        name: "tools",
        command: "/bin/tools-mcp",
        args: [],
        env: [{ name: "TOKEN", value: "mcp-token" }],
      },
    ];

    const session = hub.startSession("codex", process.cwd(), undefined, {
      modelOverlay: { apiKey: "session-key", model: "session-model" },
      engineEnv: {
        CODEX_BASE_URL: "https://session-env.example.com",
        SESSION_ONLY: "yes",
      },
      mcpServers,
    });
    await session.ready;

    expect(mocks.targets[0]).toMatchObject({
      env: expect.objectContaining({
        CODEX_API_KEY: "session-key",
        CODEX_MODEL: "session-model",
        CODEX_BASE_URL: "https://session-env.example.com",
        SESSION_ONLY: "yes",
      }),
    });
    expect(mocks.newSessionRequests[0]).toMatchObject({
      cwd: process.cwd(),
      mcpServers: expect.arrayContaining([
        // persistent chrome-devtools：经 proxy 接 Hub 级 Bridge（避免双开）
        expect.objectContaining({
          name: "chrome-devtools",
          command: process.execPath,
          args: expect.arrayContaining(["--config-file"]),
        }),
        // ephemeral tools：codex 原生 stdio，保留原始 command
        expect.objectContaining({
          name: "tools",
          command: "/bin/tools-mcp",
        }),
      ]),
    });
    // ephemeral 不经整表 proxy 改写，tools 保留原始 command
    const toolsServer = (
      mocks.newSessionRequests[0] as { mcpServers: Array<{ name: string; command: string }> }
    ).mcpServers.find((s) => s.name === "tools");
    expect(toolsServer?.command).toBe("/bin/tools-mcp");
    await hub.stopSession(session.sessionId);
  });

  it("cancels the current ACP turn and replaces the runner without changing the app session id", async () => {
    const { SessionHub } = await import("../src/core/serve/sessionHub.js");
    const hub = new SessionHub("deny-noninteractive");
    const session = hub.startSession("codex", process.cwd(), undefined, {
      modelOverlay: { model: "gpt-a", protocol: "openai" },
      mcpServers: [],
    });
    await session.ready;

    const sameSession = await hub.reconfigureSession(
      session.sessionId,
      "claude",
      {
        modelOverlay: { model: "claude-b", protocol: "anthropic" },
        engineEnv: { ACP_SWITCH: "yes" },
        mcpServers: [],
      },
    );
    expect(sameSession?.sessionId).toBe(session.sessionId);
    expect(mocks.notifications).toContainEqual({
      method: "session/cancel",
      params: { sessionId: "acp-session-1" },
    });
    await sameSession?.ready;
    expect(mocks.targets).toHaveLength(2);
    expect(mocks.targets[1]).toMatchObject({
      args: ["claude-acp"],
      env: expect.objectContaining({ ACP_SWITCH: "yes" }),
    });
    expect(hub.getSession(session.sessionId)).toBe(sameSession);

    await hub.stopSession(session.sessionId);
  });

  it("session cancel preserves the logical session", async () => {
    const { SessionHub } = await import("../src/core/serve/sessionHub.js");
    const hub = new SessionHub("deny-noninteractive");
    const session = hub.startSession("codex", process.cwd());
    await session.ready;

    expect(await hub.cancelSession(session.sessionId)).toBe(true);
    expect(hub.getSession(session.sessionId)).toBe(session);
    expect(mocks.notifications.at(-1)).toEqual({
      method: "session/cancel",
      params: { sessionId: "acp-session-1" },
    });

    await hub.stopSession(session.sessionId);
  });

  it("resumeSession loads history via ACP session/load with the historical cwd", async () => {
    const { SessionHub } = await import("../src/core/serve/sessionHub.js");
    const hub = new SessionHub("deny-noninteractive");
    const session = hub.resumeSession(
      "codex",
      {
        engine: "codex",
        sessionId: "hist-acp-1",
        cwd: "/historical/cwd",
        updatedAt: "2026-08-02T07:00:00.000Z",
        title: "previous turn",
        filePath: "/tmp/hist.jsonl",
      },
      { userId: "u1", projectId: "p1" },
    );
    await session.ready;

    // session/load invoked with the historical ACP id + cwd (caller cwd ignored
    // — session/load correctness depends on the original cwd).
    const loadCall = mocks.requests.find(
      (r) => (r.params as { sessionId?: string } | null)?.sessionId === "hist-acp-1",
    );
    expect(loadCall).toBeDefined();
    expect((loadCall!.params as { cwd?: string }).cwd).toBe("/historical/cwd");
    // The historical ACP id is exposed as acpSessionId on the managed session.
    expect(session.acpSessionId).toBe("hist-acp-1");

    await hub.stopSession(session.sessionId);
  });
});
