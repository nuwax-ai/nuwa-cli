// ApprovalPendingService — nuwa-cli 侧薄封装。
//
// 实现（recentResolved 保留窗 + already_resolved 幂等 + optionId 白名单 + 超集取消 +
// 超时）在 @nuwax-ai/agent-kit 的 createPendingService（与 nuwaclaw 共用）。本类保持
// nuwa-cli 既有公共 API 不变（sessionHub / uiServer / server 调用点零改动）。

import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
} from "@agentclientprotocol/sdk";
import {
  createPendingService,
  type CreatePendingArgs,
  type PendingPermission,
  type ResolveResult,
} from "@nuwax-ai/agent-kit";

export type { CreatePendingArgs, PendingPermission };

/**
 * 管理 ACP permission 的 pending 状态。实现见 @nuwax-ai/agent-kit createPendingService。
 * 同一 acpSessionId+toolCallId 重复请求会取消旧 pending；resolve 后短期保留记录，
 * 支持 already_resolved 重试。
 */
export class ApprovalPendingService {
  private readonly svc = createPendingService({
    defaultTimeoutMs: 120_000,
    retentionMs: 60_000,
  });

  get pendingCount(): number {
    return this.svc.pendingCount;
  }

  createPending(args: CreatePendingArgs): {
    interventionId: string;
    promise: Promise<RequestPermissionResponse>;
    pending: PendingPermission;
  } {
    return this.svc.createPending(args);
  }

  /** 按 acpSessionId + toolCallId 回执（/computer/notify-resolved 主路径）。 */
  resolveBySessionTool(
    acpSessionId: string,
    toolCallId: string,
    response: RequestPermissionResponse,
  ): ResolveResult {
    return this.svc.resolveBySessionTool(acpSessionId, toolCallId, response);
  }

  resolveByInterventionId(
    interventionId: string,
    response: RequestPermissionResponse,
  ): ResolveResult {
    return this.svc.resolveByInterventionId(interventionId, response);
  }

  cancelByAppSession(appSessionId: string): void {
    this.svc.cancelByAppSession(appSessionId);
  }

  cancelAll(): void {
    this.svc.cancelAll();
  }
}
