import type { McpServer } from "@agentclientprotocol/sdk";
import type { ModelOverlay, ModelProtocol } from "../env/inheritEnv.js";
import type { EngineKind } from "../env/inheritEnv.js";

export interface DownstreamSessionConfig {
  engine: EngineKind;
  modelOverlay?: ModelOverlay;
  engineEnv?: NodeJS.ProcessEnv;
  mcpServers: McpServer[];
}

const CLAUDE_ENGINE_COMMANDS = new Set([
  "claude-code",
  "claude-code-acp-ts",
]);
const CODEX_ENGINE_COMMANDS = new Set([
  "codex",
  "codex-cli",
  "codex-acp",
  "nuwax-codex-acp",
]);

export function resolveDownstreamEngine(command: unknown): EngineKind {
  if (typeof command !== "string") return "codex";
  const normalized = command.trim().toLowerCase().split(/[\\/]/).at(-1) ?? "";
  if (CLAUDE_ENGINE_COMMANDS.has(normalized)) return "claude";
  if (CODEX_ENGINE_COMMANDS.has(normalized)) return "codex";
  return "codex";
}

export function resolveModelProtocol(
  sources: Record<string, unknown>[],
  overlay: Pick<ModelOverlay, "baseUrl" | "model">,
): ModelProtocol {
  const explicit = firstText(sources, "api_protocol", "protocol", "provider");
  if (explicit) {
    const norm = explicit.trim().toLowerCase();
    if (norm === "anthropic" || norm === "claude") return "anthropic";
    if (norm === "openai" || norm === "codex") return "openai";
  }
  const url = (overlay.baseUrl ?? "").toLowerCase();
  if (url.includes("anthropic")) return "anthropic";
  if (url.includes("openai")) return "openai";
  const model = overlay.model ?? "";
  if (/^claude/i.test(model)) return "anthropic";
  if (/^(gpt|o\d|chatgpt)/i.test(model)) return "openai";
  return "openai";
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function firstRecord(
  source: Record<string, unknown>,
  ...keys: string[]
): Record<string, unknown> | undefined {
  for (const key of keys) {
    const value = record(source[key]);
    if (value) return value;
  }
  return undefined;
}

function firstText(
  sources: Record<string, unknown>[],
  ...keys: string[]
): string | undefined {
  for (const source of sources) {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === "string" && value.length > 0) return value;
    }
  }
  return undefined;
}

function stringEnv(value: unknown, label: string): NodeJS.ProcessEnv | undefined {
  const source = record(value);
  if (!source) {
    if (value === undefined) return undefined;
    throw new Error(`${label} must be an object of string keys`);
  }
  const result: NodeJS.ProcessEnv = {};
  for (const [name, item] of Object.entries(source)) {
    if (typeof item !== "string") {
      throw new Error(`${label}.${name} must be a string`);
    }
    result[name] = item;
  }
  return result;
}

function envList(value: unknown, label: string): Array<{ name: string; value: string }> {
  if (value === undefined) return [];
  if (Array.isArray(value)) {
    return value.map((item, index) => {
      const entry = record(item);
      if (
        !entry ||
        typeof entry.name !== "string" ||
        typeof entry.value !== "string"
      ) {
        throw new Error(`${label}[${index}] must contain string name/value`);
      }
      return { name: entry.name, value: entry.value };
    });
  }
  const map = stringEnv(value, label) ?? {};
  return Object.entries(map).map(([name, item]) => ({
    name,
    value: item ?? "",
  }));
}

function stringList(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be an array of strings`);
  }
  return value as string[];
}

function headerList(value: unknown, label: string): Array<{ name: string; value: string }> {
  return envList(value, label);
}

function normalizeMcpServer(value: unknown, index: number): McpServer {
  const item = record(value);
  const label = `mcpServers[${index}]`;
  if (!item || typeof item.name !== "string" || !item.name) {
    throw new Error(`${label}.name must be a non-empty string`);
  }

  if (typeof item.command === "string" && item.command) {
    return {
      name: item.name,
      command: item.command,
      args: stringList(item.args, `${label}.args`),
      env: envList(item.env, `${label}.env`),
    };
  }

  if (typeof item.url === "string" && item.url) {
    const type = item.type === "sse" ? "sse" : "http";
    return {
      type,
      name: item.name,
      url: item.url,
      headers: headerList(item.headers, `${label}.headers`),
    };
  }

  if (
    item.type === "acp" &&
    typeof item.serverId === "string" &&
    item.serverId
  ) {
    return { type: "acp", name: item.name, serverId: item.serverId };
  }

  throw new Error(`${label} is missing a valid command, HTTP/SSE url, or ACP serverId`);
}

function sanitizeMcpServerNames(servers: McpServer[]): McpServer[] {
  const used = new Set<string>();
  return servers.map((server) => {
    // codex forms MCP tool names as `mcp__<server>__<tool>` and references the
    // server by this name; a hyphen in the server name (e.g. "nuwax-openui")
    // collides with codex/model using the underscore form ("nuwax_openui") and
    // surfaces as "unknown MCP server 'nuwax_openui'". Normalize hyphens (and
    // any other non-[a-z0-9_] char) to underscore so the name is consistent
    // everywhere downstream.
    let base = server.name
      .replace(/[^a-zA-Z0-9_]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");
    if (!base) base = "mcp_server";
    let name = base;
    let suffix = 2;
    while (used.has(name)) name = `${base}_${suffix++}`;
    used.add(name);
    return name === server.name ? server : { ...server, name };
  });
}

function resolveModelTemplate(
  value: string,
  modelProvider: Record<string, unknown> | undefined,
): string | undefined {
  if (!modelProvider) return value;
  const replacements: Record<string, string> = {
    MODEL_PROVIDER_BASE_URL:
      firstText([modelProvider], "base_url", "baseUrl") ?? "",
    MODEL_PROVIDER_API_KEY:
      firstText([modelProvider], "api_key", "apiKey") ?? "",
    MODEL_PROVIDER_MODEL:
      firstText([modelProvider], "model") ?? "",
    MODEL_PROVIDER_DEFAULT_MODEL:
      firstText([modelProvider], "default_model", "defaultModel", "model") ??
      "",
  };
  const resolved = value.replace(
    /\{(MODEL_PROVIDER_(?:BASE_URL|API_KEY|MODEL|DEFAULT_MODEL))\}/g,
    (_match, key: string) => replacements[key] ?? "",
  );
  return /\{MODEL_PROVIDER_\w+\}/.test(resolved) ? undefined : resolved;
}

function resolveAgentServerEnv(
  value: unknown,
  modelProvider: Record<string, unknown> | undefined,
): NodeJS.ProcessEnv | undefined {
  const raw = stringEnv(value, "agent_config.agent_server.env");
  if (!raw) return undefined;
  const result: NodeJS.ProcessEnv = {};
  for (const [name, item] of Object.entries(raw)) {
    if (item === undefined) continue;
    const resolved = resolveModelTemplate(item, modelProvider);
    if (resolved !== undefined) result[name] = resolved;
  }
  return result;
}

function contextServersAsArray(value: unknown): unknown[] | undefined {
  const servers = record(value);
  if (!servers) return undefined;
  return Object.entries(servers)
    .filter(([, item]) => record(item)?.enabled !== false)
    .map(([name, item]) => ({ name, ...record(item) }));
}

/**
 * Parses per-session configuration delivered with /computer/chat.
 * Precedence is enforced later by SessionHub:
 * downstream session config > Gateway flags > the user's local environment.
 */
export function parseDownstreamSessionConfig(
  body: Record<string, unknown>,
): DownstreamSessionConfig {
  const acp =
    firstRecord(body, "acp", "acpConfig", "acp_config") ?? body;
  const agentConfig = firstRecord(body, "agent_config", "agentConfig");
  const agentServer = agentConfig
    ? firstRecord(agentConfig, "agent_server", "agentServer")
    : undefined;
  const modelProvider = firstRecord(body, "model_provider", "modelProvider");
  const model =
    firstRecord(acp, "modelConfig", "model_config", "modelInfo", "model_info") ??
    firstRecord(body, "modelConfig", "model_config", "modelInfo", "model_info");
  const modelSources = [modelProvider, model, acp, body].filter(
    (item): item is Record<string, unknown> => Boolean(item),
  );
  const modelOverlay: ModelOverlay = {
    apiKey: firstText(
      modelSources,
      "apiKey",
      "api_key",
      "modelApiKey",
      "model_api_key",
    ),
    baseUrl: firstText(
      modelSources,
      "baseUrl",
      "base_url",
      "modelBaseUrl",
      "model_base_url",
    ),
    model: firstText(
      modelSources,
      "model",
      "default_model",
      "defaultModel",
      "modelId",
      "model_id",
    ),
  };
  const hasModelOverlay = Object.values(modelOverlay).some(Boolean);
  if (hasModelOverlay) {
    modelOverlay.protocol = resolveModelProtocol(modelSources, modelOverlay);
  }

  const genericEnvValue =
    acp.engineEnv ??
    acp.engine_env ??
    acp.environment ??
    acp.env ??
    body.engineEnv ??
    body.engine_env ??
    body.environment ??
    body.env;
  const genericEnv = stringEnv(genericEnvValue, "env");
  const agentServerEnv = resolveAgentServerEnv(agentServer?.env, modelProvider);
  const engineEnv =
    genericEnv || agentServerEnv
      ? { ...genericEnv, ...agentServerEnv }
      : undefined;

  const canonicalMcpValue =
    acp.mcpServers ??
    acp.mcp_servers ??
    body.mcpServers ??
    body.mcp_servers;
  const mcpValue =
    canonicalMcpValue ??
    contextServersAsArray(
      agentConfig?.context_servers ?? agentConfig?.contextServers,
    ) ??
    [];
  if (!Array.isArray(mcpValue)) throw new Error("mcpServers must be an array");

  const engine = hasModelOverlay
    ? modelOverlay.protocol === "anthropic"
      ? "claude"
      : "codex"
    : resolveDownstreamEngine(
        agentServer?.command ??
          agentServer?.engine ??
          agentServer?.engine_type ??
          agentServer?.engineType,
      );

  return {
    engine,
    modelOverlay: hasModelOverlay ? modelOverlay : undefined,
    engineEnv,
    mcpServers: sanitizeMcpServerNames(mcpValue.map(normalizeMcpServer)),
  };
}
