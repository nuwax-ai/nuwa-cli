import * as crypto from "node:crypto";
import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
} from "@agentclientprotocol/sdk";

/** 合成一条 ACP RequestPermissionRequest，供 CLI/HTTP 旁路走同一审批总线。 */
export function buildSyntheticPermissionRequest(args: {
  acpSessionId: string;
  title: string;
  kind?: string;
  rawInput?: Record<string, unknown>;
  toolCallId?: string;
}): RequestPermissionRequest {
  const toolCallId = args.toolCallId ?? `synth_${crypto.randomUUID()}`;
  return {
    sessionId: args.acpSessionId,
    toolCall: {
      toolCallId,
      // ACP ToolKind 因引擎而异；合成请求用 read 表达「读本地历史」
      kind: (args.kind ?? "read") as "read",
      status: "pending",
      title: args.title,
      content: [],
      rawInput: args.rawInput ?? {},
      locations: [],
    },
    options: [
      {
        optionId: "allow_once",
        name: "允许本次",
        kind: "allow_once",
      },
      {
        optionId: "allow_always",
        name: "本会话始终允许",
        kind: "allow_always",
      },
      {
        optionId: "reject_once",
        name: "拒绝",
        kind: "reject_once",
      },
    ],
  };
}

/** 按 option kind 判断是否放行（合成请求与引擎原生 option 均适用）。 */
export function responseAllowsAccess(
  response: RequestPermissionResponse,
  request: RequestPermissionRequest,
): boolean {
  if (response.outcome.outcome !== "selected") return false;
  const optionId = response.outcome.optionId;
  const option = request.options.find((o) => o.optionId === optionId);
  if (!option) return false;
  return option.kind === "allow_once" || option.kind === "allow_always";
}
