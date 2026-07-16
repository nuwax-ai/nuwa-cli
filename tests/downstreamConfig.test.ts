import { describe, expect, it } from "vitest";
import { parseDownstreamSessionConfig } from "../src/core/serve/downstreamConfig.js";

describe("parseDownstreamSessionConfig", () => {
  it("does not inject overrides when ACP sends no runtime configuration", () => {
    expect(parseDownstreamSessionConfig({ prompt: "hello" })).toEqual({
      engine: "codex",
      modelOverlay: undefined,
      engineEnv: undefined,
      mcpServers: [],
    });
  });

  it("accepts nested ACP model, environment, and MCP configuration", () => {
    const result = parseDownstreamSessionConfig({
      acp_config: {
        model_config: {
          api_key: "session-key",
          base_url: "https://model.example.com/v1",
          model: "session-model",
        },
        env: {
          OPENAI_API_KEY: "from-session-env",
          CUSTOM_SETTING: "enabled",
        },
        mcp_servers: [
          {
            name: "filesystem",
            command: "C:\\tools\\mcp.exe",
            args: ["--root", "C:\\workspace"],
            env: { MCP_TOKEN: "secret" },
          },
          {
            type: "http",
            name: "remote-tools",
            url: "https://mcp.example.com",
            headers: { Authorization: "Bearer token" },
          },
        ],
      },
    });

    expect(result.modelOverlay).toEqual({
      apiKey: "session-key",
      baseUrl: "https://model.example.com/v1",
      model: "session-model",
    });
    expect(result.engine).toBe("codex");
    expect(result.engineEnv).toEqual({
      OPENAI_API_KEY: "from-session-env",
      CUSTOM_SETTING: "enabled",
    });
    expect(result.mcpServers).toEqual([
      {
        name: "filesystem",
        command: "C:\\tools\\mcp.exe",
        args: ["--root", "C:\\workspace"],
        env: [{ name: "MCP_TOKEN", value: "secret" }],
      },
      {
        type: "http",
        name: "remote-tools",
        url: "https://mcp.example.com",
        headers: [{ name: "Authorization", value: "Bearer token" }],
      },
    ]);
  });

  it("rejects malformed MCP environment variables", () => {
    expect(() =>
      parseDownstreamSessionConfig({
        mcpServers: [
          {
            name: "bad",
            command: "mcp",
            env: { TOKEN: 123 },
          },
        ],
      }),
    ).toThrow("mcpServers[0].env.TOKEN 必须是字符串");
  });

  it("parses the NuwaClaw agent_config/model_provider contract", () => {
    const result = parseDownstreamSessionConfig({
      model_provider: {
        api_key: "provider-key",
        base_url: "https://provider.example.com",
        default_model: "provider-model",
      },
      agent_config: {
        agent_server: {
          command: "claude-code-acp-ts",
          env: {
            ANTHROPIC_API_KEY: "{MODEL_PROVIDER_API_KEY}",
            ANTHROPIC_BASE_URL: "{MODEL_PROVIDER_BASE_URL}",
            ANTHROPIC_MODEL: "{MODEL_PROVIDER_DEFAULT_MODEL}",
          },
        },
        context_servers: {
          filesystem: {
            command: "mcp-filesystem",
            args: ["/workspace"],
            env: { MCP_TOKEN: "token" },
          },
          disabled: {
            enabled: false,
            command: "ignored",
          },
        },
      },
    });

    expect(result.engine).toBe("claude");
    expect(result.modelOverlay).toEqual({
      apiKey: "provider-key",
      baseUrl: "https://provider.example.com",
      model: "provider-model",
    });
    expect(result.engineEnv).toEqual({
      ANTHROPIC_API_KEY: "provider-key",
      ANTHROPIC_BASE_URL: "https://provider.example.com",
      ANTHROPIC_MODEL: "provider-model",
    });
    expect(result.mcpServers).toEqual([
      {
        name: "filesystem",
        command: "mcp-filesystem",
        args: ["/workspace"],
        env: [{ name: "MCP_TOKEN", value: "token" }],
      },
    ]);
  });

  it("defaults a NuwaClaw URL context server to ACP http", () => {
    const result = parseDownstreamSessionConfig({
      agent_config: {
        context_servers: {
          remote: { url: "https://mcp.example.com/api" },
        },
      },
    });

    expect(result.mcpServers).toEqual([
      {
        type: "http",
        name: "remote",
        url: "https://mcp.example.com/api",
        headers: [],
      },
    ]);
  });

  it.each([
    ["claude-code", "claude"],
    ["claude-code-acp-ts", "claude"],
    ["codex", "codex"],
    ["codex-cli", "codex"],
    ["codex-acp", "codex"],
    ["nuwax-codex-acp", "codex"],
    ["nuwaxcode", "codex"],
    ["unknown-agent", "codex"],
  ])("maps downstream engine %s to %s", (command, engine) => {
    expect(
      parseDownstreamSessionConfig({
        agent_config: { agent_server: { command } },
      }).engine,
    ).toBe(engine);
  });
});
