import * as clack from "@clack/prompts";
import pc from "picocolors";
import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
} from "@agentclientprotocol/sdk";
import {
  createDefaultCoordinator,
  type ApprovePolicyMode,
  type PermissionCoordinator,
} from "./coordinator.js";

/**
 * ACP 客户端侧权限模式：
 * - interactive: 本机 TTY clack 询问（chat 默认）
 * - yolo: 普通工具自动放行；敏感分类器仍强制 ask（若提供 onAsk）
 * - ask: 全部工具走 onAsk / TTY
 * - deny-noninteractive: 全部拒绝
 */
export type PermissionMode =
  | "interactive"
  | "yolo"
  | "ask"
  | "deny-noninteractive";

export function permissionModeToApprovePolicy(
  mode: PermissionMode,
): ApprovePolicyMode {
  if (mode === "deny-noninteractive") return "deny";
  if (mode === "ask") return "ask";
  return "yolo";
}

function firstOptionOfKind(request: RequestPermissionRequest, kinds: string[]) {
  for (const kind of kinds) {
    const found = request.options.find((option) => option.kind === kind);
    if (found) return found;
  }
  return undefined;
}

export interface DecidePermissionHandlers {
  mode: PermissionMode;
  /** 默认内置 session-history 等分类器。 */
  coordinator?: PermissionCoordinator;
  /** serve：SSE + notify-resolved；chat interactive 可不传（走 clack）。 */
  onAsk?: (
    request: RequestPermissionRequest,
    meta: { classifierId?: string; reason: string },
  ) => Promise<RequestPermissionResponse>;
  appSessionId?: string;
}

const sharedCoordinator = createDefaultCoordinator();

/**
 * Decides the outcome of an ACP `session/request_permission` call.
 * 敏感分类命中时，即使 yolo 也会走 onAsk（无 onAsk 且非 interactive 则拒绝）。
 */
export async function decidePermission(
  request: RequestPermissionRequest,
  modeOrHandlers: PermissionMode | DecidePermissionHandlers,
): Promise<RequestPermissionResponse> {
  const handlers: DecidePermissionHandlers =
    typeof modeOrHandlers === "string"
      ? { mode: modeOrHandlers }
      : modeOrHandlers;

  const { mode, onAsk, appSessionId } = handlers;
  const coordinator = handlers.coordinator ?? sharedCoordinator;

  // chat 本机交互：一律 TTY 询问（敏感与否都由人点），不走 yolo 自动放行
  if (mode === "interactive" && !onAsk) {
    return promptInteractive(request);
  }

  const policy = permissionModeToApprovePolicy(mode);

  const decision = coordinator.evaluate(request, policy, appSessionId);
  const immediate = coordinator.toImmediateResponse(decision);
  if (immediate) return immediate;

  // decision.kind === "ask"
  if (onAsk) {
    return onAsk(request, {
      classifierId: decision.kind === "ask" ? decision.classifierId : undefined,
      reason: decision.kind === "ask" ? decision.reason : "ask",
    });
  }

  if (process.stdin.isTTY) {
    return promptInteractive(request);
  }

  // serve/yolo 敏感访问却没有 onAsk：安全默认拒绝，避免静默放行
  console.error(
    pc.yellow(
      `[nuwa-cli] 敏感工具调用需要审批，但当前无审批通道，已拒绝（${decision.kind === "ask" ? decision.reason : "ask"}）。请使用 serve 的 SSE/notify-resolved，或 --approve deny / 交互式 chat。`,
    ),
  );
  const reject = firstOptionOfKind(request, ["reject_once", "reject_always"]);
  if (!reject) return { outcome: { outcome: "cancelled" } };
  return { outcome: { outcome: "selected", optionId: reject.optionId } };
}

async function promptInteractive(
  request: RequestPermissionRequest,
): Promise<RequestPermissionResponse> {
  const toolTitle = request.toolCall.title ?? request.toolCall.toolCallId;
  const selected = await clack.select({
    message: `是否允许工具调用「${toolTitle}」？`,
    options: request.options.map((option) => ({
      value: option.optionId,
      label: option.name,
    })),
  });

  if (clack.isCancel(selected)) {
    return { outcome: { outcome: "cancelled" } };
  }
  return { outcome: { outcome: "selected", optionId: selected } };
}

/** 将 CLI --approve 映射为 PermissionMode。 */
export function parseApproveFlag(
  value: string | undefined,
):
  | { ok: true; mode: PermissionMode; approve: "auto" | "ask" | "deny" }
  | { ok: false; message: string } {
  const raw = value ?? "auto";
  if (raw === "auto") return { ok: true, mode: "yolo", approve: "auto" };
  if (raw === "ask") return { ok: true, mode: "ask", approve: "ask" };
  if (raw === "deny") {
    return { ok: true, mode: "deny-noninteractive", approve: "deny" };
  }
  return {
    ok: false,
    message: `--approve 只支持 auto、ask 或 deny，收到 "${raw}"。`,
  };
}
