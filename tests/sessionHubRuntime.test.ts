import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  target: undefined as unknown,
  newSessionRequest: undefined as unknown,
}));

vi.mock("../src/core/engines/registry.js", () => ({
  getEngine: () => ({
    resolve: async () => ({
      command: "node",
      args: ["codex-acp"],
      envOverlay: {},
    }),
  }),
}));

vi.mock("../src/core/acp/connection.js", () => ({
  withEngineConnection: async (
    target: unknown,
    _handlers: unknown,
    op: (ctx: unknown) => Promise<unknown>,
  ) => {
    mocks.target = target;
    const ctx = {
      buildSession: (request: unknown) => {
        mocks.newSessionRequest = request;
        return {
          start: async () => ({
            sessionId: "acp-session",
            modes: null,
            newSessionResponse: { configOptions: [] },
            prompt: async () => ({}),
          }),
        };
      },
      request: async () => ({}),
    };
    return op(ctx);
  },
}));

describe("SessionHub ACP runtime precedence", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.target = undefined;
    mocks.newSessionRequest = undefined;
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

    expect(mocks.target).toMatchObject({
      env: expect.objectContaining({
        CODEX_API_KEY: "session-key",
        CODEX_MODEL: "session-model",
        CODEX_BASE_URL: "https://session-env.example.com",
        SESSION_ONLY: "yes",
      }),
    });
    expect(mocks.newSessionRequest).toEqual({
      cwd: process.cwd(),
      mcpServers,
    });

    await hub.stopSession(session.sessionId);
  });
});
