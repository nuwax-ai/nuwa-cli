import * as crypto from "node:crypto";
import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
} from "@agentclientprotocol/sdk";

export interface PendingPermission {
  interventionId: string;
  appSessionId: string;
  acpSessionId: string;
  toolCallId: string;
  request: RequestPermissionRequest;
  /** 命中的敏感分类器 id（若有），用于 allow_always 缓存。 */
  classifierId?: string;
  status: "pending" | "resolved";
  createdAt: number;
  resolve: (response: RequestPermissionResponse) => void;
  timer?: ReturnType<typeof setTimeout>;
  resolvedResponse?: RequestPermissionResponse;
}

export interface CreatePendingArgs {
  appSessionId: string;
  acpSessionId: string;
  request: RequestPermissionRequest;
  classifierId?: string;
  /** 默认 120s；超时以 cancelled 结束。 */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;
/** 已 resolve 的记录保留多久，供云端 idempotent 重试返回 already_resolved。 */
const RESOLVED_RETENTION_MS = 60_000;

function permissionKey(acpSessionId: string, toolCallId: string): string {
  return `${acpSessionId}::${toolCallId}`;
}

function isValidResponse(
  response: RequestPermissionResponse,
  request: RequestPermissionRequest,
): boolean {
  if (response.outcome.outcome === "cancelled") return true;
  if (response.outcome.outcome === "selected") {
    const optionId = response.outcome.optionId;
    return request.options.some((opt) => opt.optionId === optionId);
  }
  return false;
}

/**
 * 管理 ACP permission 的 pending 状态（对齐 nuwaclaw approvalInterventionService 精简版）。
 * 同一 acpSessionId+toolCallId 重复请求会取消旧 pending。
 * resolve 后短期保留记录，支持 already_resolved 重试。
 */
export class ApprovalPendingService {
  private pending = new Map<string, PendingPermission>();
  private byPermissionKey = new Map<string, string>();
  /** key = permissionKey；resolve 后短暂保留。 */
  private recentResolved = new Map<string, PendingPermission>();

  get pendingCount(): number {
    return this.pending.size;
  }

  createPending(args: CreatePendingArgs): {
    interventionId: string;
    promise: Promise<RequestPermissionResponse>;
    pending: PendingPermission;
  } {
    const toolCallId = args.request.toolCall.toolCallId;
    const key = permissionKey(args.acpSessionId, toolCallId);
    const existingId = this.byPermissionKey.get(key);
    if (existingId) {
      this.resolveInternal(existingId, {
        outcome: { outcome: "cancelled" },
      });
    }
    // 新请求覆盖同 key 的 already_resolved 缓存
    this.recentResolved.delete(key);

    const interventionId = `itv_${crypto.randomUUID().replace(/-/g, "")}`;
    const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    let resolveFn!: (response: RequestPermissionResponse) => void;
    const promise = new Promise<RequestPermissionResponse>((resolve) => {
      resolveFn = resolve;
    });

    const timer = setTimeout(() => {
      this.resolveInternal(interventionId, {
        outcome: { outcome: "cancelled" },
      });
    }, timeoutMs);

    const pending: PendingPermission = {
      interventionId,
      appSessionId: args.appSessionId,
      acpSessionId: args.acpSessionId,
      toolCallId,
      request: args.request,
      classifierId: args.classifierId,
      status: "pending",
      createdAt: Date.now(),
      resolve: resolveFn,
      timer,
    };

    this.pending.set(interventionId, pending);
    this.byPermissionKey.set(key, interventionId);

    return { interventionId, promise, pending };
  }

  /**
   * 按 acpSessionId + toolCallId 回执（RCoder /computer/notify-resolved 主路径）。
   */
  resolveBySessionTool(
    acpSessionId: string,
    toolCallId: string,
    response: RequestPermissionResponse,
  ):
    | {
        ok: true;
        hostStatus: "resolved" | "already_resolved";
        pending: PendingPermission;
      }
    | {
        ok: false;
        hostStatus?: "gone";
        error: { code: string; message: string };
      } {
    const key = permissionKey(acpSessionId, toolCallId);
    const interventionId = this.byPermissionKey.get(key);
    if (interventionId) {
      return this.resolveByInterventionId(interventionId, response);
    }

    const recent = this.recentResolved.get(key);
    if (recent) {
      if (
        recent.resolvedResponse &&
        JSON.stringify(recent.resolvedResponse) === JSON.stringify(response)
      ) {
        return { ok: true, hostStatus: "already_resolved", pending: recent };
      }
      return {
        ok: false,
        error: {
          code: "already_resolved_conflict",
          message: "permission already resolved with different response",
        },
      };
    }

    return {
      ok: false,
      hostStatus: "gone",
      error: {
        code: "ERR_PERMISSION_NOT_FOUND",
        message: "pending permission not found",
      },
    };
  }

  resolveByInterventionId(
    interventionId: string,
    response: RequestPermissionResponse,
  ):
    | {
        ok: true;
        hostStatus: "resolved" | "already_resolved";
        pending: PendingPermission;
      }
    | {
        ok: false;
        hostStatus?: "gone";
        error: { code: string; message: string };
      } {
    const pending = this.pending.get(interventionId);
    if (!pending) {
      // 可能已 resolve 并迁到 recentResolved
      for (const recent of this.recentResolved.values()) {
        if (recent.interventionId === interventionId) {
          if (
            recent.resolvedResponse &&
            JSON.stringify(recent.resolvedResponse) === JSON.stringify(response)
          ) {
            return {
              ok: true,
              hostStatus: "already_resolved",
              pending: recent,
            };
          }
          return {
            ok: false,
            error: {
              code: "already_resolved_conflict",
              message: "permission already resolved with different response",
            },
          };
        }
      }
      return {
        ok: false,
        hostStatus: "gone",
        error: {
          code: "ERR_PERMISSION_NOT_FOUND",
          message: "pending permission not found",
        },
      };
    }

    if (pending.status !== "pending") {
      if (
        pending.resolvedResponse &&
        JSON.stringify(pending.resolvedResponse) === JSON.stringify(response)
      ) {
        return { ok: true, hostStatus: "already_resolved", pending };
      }
      return {
        ok: false,
        error: {
          code: "already_resolved_conflict",
          message: "permission already resolved with different response",
        },
      };
    }

    if (!isValidResponse(response, pending.request)) {
      return {
        ok: false,
        error: {
          code: "invalid_acp_response",
          message: "invalid ACP permission response",
        },
      };
    }

    this.resolveInternal(interventionId, response);
    return { ok: true, hostStatus: "resolved", pending };
  }

  cancelByAppSession(appSessionId: string): void {
    for (const pending of [...this.pending.values()]) {
      if (pending.appSessionId === appSessionId && pending.status === "pending") {
        this.resolveInternal(pending.interventionId, {
          outcome: { outcome: "cancelled" },
        });
      }
    }
  }

  cancelAll(): void {
    for (const pending of [...this.pending.values()]) {
      if (pending.status === "pending") {
        this.resolveInternal(pending.interventionId, {
          outcome: { outcome: "cancelled" },
        });
      }
    }
  }

  private resolveInternal(
    interventionId: string,
    response: RequestPermissionResponse,
  ): void {
    const pending = this.pending.get(interventionId);
    if (!pending || pending.status !== "pending") return;
    pending.status = "resolved";
    pending.resolvedResponse = response;
    if (pending.timer) clearTimeout(pending.timer);
    const key = permissionKey(pending.acpSessionId, pending.toolCallId);
    this.byPermissionKey.delete(key);
    this.pending.delete(interventionId);
    this.recentResolved.set(key, pending);
    setTimeout(() => {
      const cur = this.recentResolved.get(key);
      if (cur?.interventionId === interventionId) {
        this.recentResolved.delete(key);
      }
    }, RESOLVED_RETENTION_MS).unref?.();
    pending.resolve(response);
  }
}
