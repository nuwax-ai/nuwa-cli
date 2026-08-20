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

  it("extracts top-level system_prompt for _meta.systemPrompt forwarding", () => {
    const result = parseDownstreamSessionConfig({
      prompt: "hi",
      system_prompt: "  你是 nuwax 测试助手。 ",
    });
    expect(result.systemPrompt).toBe("你是 nuwax 测试助手。");
  });

  it("unwraps mcp-proxy convert --config bridge entries (nuwaclaw extractRealMcpServers parity)", () => {
    const config = JSON.stringify({
      mcpServers: {
        "fetch-svc": { command: "uvx", args: ["mcp-server-fetch"] },
        "remote-x": { url: "https://mcp.example.com/mcp", transport: "stream" },
      },
    });
    const result = parseDownstreamSessionConfig({
      prompt: "hi",
      mcpServers: [
        { name: "bridge", command: "mcp-proxy", args: ["convert", "--config", config] },
      ],
    });
    // inner 条目以自身名字展开（连字符经 sanitize → 下划线），Rust 命令消失
    expect(result.mcpServers.map((s) => s.name).sort()).toEqual([
      "fetch_svc",
      "remote_x",
    ]);
    const fetchSvc = result.mcpServers.find((s) => s.name === "fetch_svc");
    expect(fetchSvc).toMatchObject({ command: "uvx", args: ["mcp-server-fetch"] });
    const remoteX = result.mcpServers.find((s) => s.name === "remote_x");
    expect(remoteX).toMatchObject({
      type: "http",
      url: "https://mcp.example.com/mcp",
    });
  });

  it("keeps mcp-proxy entries without --config as-is (URL form → proxyRewrite TS rewrite)", () => {
    const result = parseDownstreamSessionConfig({
      mcpServers: [
        {
          name: "chrome-tools",
          command: "mcp-proxy",
          args: ["convert", "http://127.0.0.1:18099", "--protocol", "stream"],
        },
      ],
    });
    expect(result.mcpServers).toHaveLength(1);
    expect(result.mcpServers[0]).toMatchObject({
      name: "chrome_tools",
      command: "mcp-proxy",
    });
  });

  it("unwraps mcp-proxy.exe convert --config (Windows basename)", () => {
    const config = JSON.stringify({
      mcpServers: {
        fetch: { command: "uvx", args: ["mcp-server-fetch"] },
      },
    });
    const result = parseDownstreamSessionConfig({
      mcpServers: [
        {
          name: "bridge",
          command: "C:\\tools\\mcp-proxy.exe",
          args: ["convert", "--config", config],
        },
      ],
    });
    expect(result.mcpServers.map((s) => s.name)).toEqual(["fetch"]);
    expect(result.mcpServers[0]).toMatchObject({
      command: "uvx",
      args: ["mcp-server-fetch"],
    });
  });

  it("keeps mcp-proxy entries with malformed --config as-is (engine-side error visible)", () => {
    const result = parseDownstreamSessionConfig({
      mcpServers: [
        { name: "bridge", command: "mcp-proxy", args: ["convert", "--config", "{not json"] },
      ],
    });
    expect(result.mcpServers).toHaveLength(1);
    expect(result.mcpServers[0]).toMatchObject({ command: "mcp-proxy" });
  });

  it("accepts camelCase systemPrompt and drops whitespace-only values", () => {
    expect(
      parseDownstreamSessionConfig({ systemPrompt: "ok" }).systemPrompt,
    ).toBe("ok");
    expect(
      parseDownstreamSessionConfig({ system_prompt: "   \n\t" }).systemPrompt,
    ).toBeUndefined();
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
      protocol: "openai",
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
        name: "remote_tools",
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
    ).toThrow("mcpServers[0].env.TOKEN must be a string");
  });

  it("parses the NuwaClaw agent_config/model_provider contract", () => {
    const result = parseDownstreamSessionConfig({
      model_provider: {
        api_key: "provider-key",
        base_url: "https://provider.example.com",
        default_model: "provider-model",
        api_protocol: "anthropic",
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
      protocol: "anthropic",
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

  it("sanitizes and deduplicates MCP names for OpenAI/Anthropic tool schemas", () => {
    const result = parseDownstreamSessionConfig({
      mcp_servers: [
        { name: "A股股票查询", command: "mcp-a" },
        { name: "A 股股票查询", command: "mcp-b" },
      ],
    });

    expect(result.mcpServers.map((server) => server.name)).toEqual([
      "A",
      "A_2",
    ]);
  });

  it("normalizes hyphens to underscores in MCP server names (codex mcp__server__tool namespace)", () => {
    const result = parseDownstreamSessionConfig({
      mcp_servers: [
        { name: "nuwax-openui", command: "mcp-a" },
        { name: "chrome-tools", command: "mcp-b" },
      ],
    });
    expect(result.mcpServers.map((s) => s.name)).toEqual([
      "nuwax_openui",
      "chrome_tools",
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

  describe("model protocol routing", () => {
    it("routes an explicit openai protocol to codex", () => {
      const result = parseDownstreamSessionConfig({
        model_provider: {
          api_key: "k",
          model: "gpt-4o",
          api_protocol: "openai",
        },
      });
      expect(result.engine).toBe("codex");
      expect(result.modelOverlay?.protocol).toBe("openai");
    });

    it("routes an explicit anthropic protocol to claude", () => {
      const result = parseDownstreamSessionConfig({
        model_provider: {
          api_key: "k",
          model: "claude-3-5-sonnet",
          api_protocol: "anthropic",
        },
      });
      expect(result.engine).toBe("claude");
      expect(result.modelOverlay?.protocol).toBe("anthropic");
    });

    it("infers anthropic from a claude-* model name when protocol is absent", () => {
      const result = parseDownstreamSessionConfig({
        acp: { model_config: { model: "claude-3-5-sonnet", api_key: "k" } },
      });
      expect(result.engine).toBe("claude");
      expect(result.modelOverlay?.protocol).toBe("anthropic");
    });

    it("infers openai from an o-series model name when protocol is absent", () => {
      const result = parseDownstreamSessionConfig({
        acp: { model_config: { model: "o4-mini", api_key: "k" } },
      });
      expect(result.engine).toBe("codex");
      expect(result.modelOverlay?.protocol).toBe("openai");
    });

    it("infers protocol from baseUrl", () => {
      const result = parseDownstreamSessionConfig({
        model_provider: {
          api_key: "k",
          model: "any",
          base_url: "https://api.anthropic.com",
        },
      });
      expect(result.modelOverlay?.protocol).toBe("anthropic");
      expect(result.engine).toBe("claude");
    });

    it("defaults to openai (codex) when nothing identifies the protocol", () => {
      const result = parseDownstreamSessionConfig({
        model_provider: { api_key: "k", model: "custom-model" },
      });
      expect(result.modelOverlay?.protocol).toBe("openai");
      expect(result.engine).toBe("codex");
    });

    it("does not route by protocol when no model is sent", () => {
      const result = parseDownstreamSessionConfig({
        agent_config: { agent_server: { command: "claude-code-acp-ts" } },
      });
      expect(result.modelOverlay).toBeUndefined();
      expect(result.engine).toBe("claude");
    });
  });
});
