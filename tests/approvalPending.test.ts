import { describe, it, expect, vi } from "vitest";
import type { RequestPermissionRequest } from "@agentclientprotocol/sdk";
import { ApprovalPendingService } from "../src/core/permissions/approvalPending.js";
import {
  parseComputerPermissionResolveRequest,
  toComputerPermissionProgressData,
} from "../src/core/permissions/notifyResolved.js";
import { buildSyntheticPermissionRequest } from "../src/core/permissions/syntheticRequest.js";

function baseRequest(): RequestPermissionRequest {
  return buildSyntheticPermissionRequest({
    acpSessionId: "acp-1",
    title: "local_sessions_list",
  });
}

describe("ApprovalPendingService", () => {
  it("resolves by session+toolCall and validates optionId", async () => {
    const svc = new ApprovalPendingService();
    const request = baseRequest();
    const { promise } = svc.createPending({
      appSessionId: "app-1",
      acpSessionId: request.sessionId,
      request,
      classifierId: "session-history",
      timeoutMs: 5_000,
    });

    const result = svc.resolveBySessionTool(request.sessionId, request.toolCall.toolCallId, {
      outcome: { outcome: "selected", optionId: "allow_once" },
    });
    expect(result.ok).toBe(true);
    await expect(promise).resolves.toMatchObject({
      outcome: { outcome: "selected", optionId: "allow_once" },
    });
  });

  it("rejects unknown optionId", () => {
    const svc = new ApprovalPendingService();
    const request = baseRequest();
    svc.createPending({
      appSessionId: "app-1",
      acpSessionId: request.sessionId,
      request,
      timeoutMs: 5_000,
    });
    const result = svc.resolveBySessionTool(
      request.sessionId,
      request.toolCall.toolCallId,
      { outcome: { outcome: "selected", optionId: "not-a-real-option" } },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_acp_response");
  });

  it("times out as cancelled", async () => {
    vi.useFakeTimers();
    const svc = new ApprovalPendingService();
    const request = baseRequest();
    const { promise } = svc.createPending({
      appSessionId: "app-1",
      acpSessionId: request.sessionId,
      request,
      timeoutMs: 100,
    });
    vi.advanceTimersByTime(150);
    await expect(promise).resolves.toMatchObject({
      outcome: { outcome: "cancelled" },
    });
    vi.useRealTimers();
  });

  it("returns gone for unknown tool_call_id", () => {
    const svc = new ApprovalPendingService();
    const result = svc.resolveBySessionTool("acp-x", "tool-y", {
      outcome: { outcome: "cancelled" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.hostStatus).toBe("gone");
  });

  it("returns already_resolved on idempotent retry", () => {
    const svc = new ApprovalPendingService();
    const request = baseRequest();
    svc.createPending({
      appSessionId: "app-1",
      acpSessionId: request.sessionId,
      request,
      timeoutMs: 5_000,
    });
    const first = svc.resolveBySessionTool(
      request.sessionId,
      request.toolCall.toolCallId,
      { outcome: { outcome: "selected", optionId: "allow_once" } },
    );
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.hostStatus).toBe("resolved");

    const second = svc.resolveBySessionTool(
      request.sessionId,
      request.toolCall.toolCallId,
      { outcome: { outcome: "selected", optionId: "allow_once" } },
    );
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.hostStatus).toBe("already_resolved");
  });
});

describe("parseComputerPermissionResolveRequest", () => {
  it("parses Selected.option_id (RCoder shape)", () => {
    const parsed = parseComputerPermissionResolveRequest({
      permission_resolve_request: {
        session_id: "s1",
        tool_call_id: "t1",
        request_permission_response: {
          outcome: { Selected: { option_id: "allow_once" } },
        },
      },
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.command.acpResponse).toEqual({
        outcome: { outcome: "selected", optionId: "allow_once" },
      });
    }
  });

  it("parses legacy outcome/optionId", () => {
    const parsed = parseComputerPermissionResolveRequest({
      permission_resolve_request: {
        session_id: "s1",
        tool_call_id: "t1",
        request_permission_response: {
          outcome: { outcome: "selected", optionId: "reject_once" },
        },
      },
    });
    expect(parsed.ok).toBe(true);
  });

  it("marks missing permission_resolve_request as not-permission", () => {
    const parsed = parseComputerPermissionResolveRequest({ ok: true });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.body.error.code).toBe("ERR_NOT_PERMISSION_RESOLVE");
    }
  });
});

describe("toComputerPermissionProgressData", () => {
  it("embeds request_permission_request and tool_call_id", () => {
    const request = baseRequest();
    const data = toComputerPermissionProgressData({
      request,
      interventionId: "itv_abc",
      revision: 1,
    });
    expect(data.tool_call_id).toBe(request.toolCall.toolCallId);
    expect(data).toHaveProperty("request_permission_request");
    expect((data._meta as { nuwa_cli_intervention_id: string }).nuwa_cli_intervention_id).toBe(
      "itv_abc",
    );
  });
});
