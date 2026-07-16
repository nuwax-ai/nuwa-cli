import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
} from "@agentclientprotocol/sdk";
import type { SensitiveClassifier } from "./classifiers/types.js";
import { sessionHistoryAccessClassifier } from "./classifiers/sessionHistoryAccess.js";

/** serve/chat 侧权限模式（与 --approve / --yolo 映射）。 */
export type ApprovePolicyMode = "yolo" | "ask" | "deny";

export type PermissionDecision =
  | { kind: "select"; optionId: string; reason: string }
  | { kind: "cancel"; reason: string }
  | { kind: "ask"; reason: string; classifierId?: string };

function firstOptionOfKind(
  request: RequestPermissionRequest,
  kinds: string[],
): { optionId: string } | undefined {
  for (const kind of kinds) {
    const found = request.options.find((option) => option.kind === kind);
    if (found) return found;
  }
  return undefined;
}

function pickAllow(request: RequestPermissionRequest): PermissionDecision {
  const option = firstOptionOfKind(request, ["allow_always", "allow_once"]);
  if (!option) return { kind: "cancel", reason: "no_allow_option" };
  return {
    kind: "select",
    optionId: option.optionId,
    reason: "auto_allow",
  };
}

function pickReject(request: RequestPermissionRequest): PermissionDecision {
  const option = firstOptionOfKind(request, ["reject_once", "reject_always"]);
  if (!option) return { kind: "cancel", reason: "no_reject_option" };
  return {
    kind: "select",
    optionId: option.optionId,
    reason: "auto_deny",
  };
}

/**
 * ACP 权限决策协调器（精简对齐 nuwaclaw AcpPermissionCoordinator）。
 *
 * 决策顺序：
 * 1. 敏感分类器命中 → 强制 ask（deny 模式下直接 reject）
 * 2. 进程内 allow_always 缓存命中 → select
 * 3. 按 mode：yolo 放行 / ask 人工 / deny 拒绝
 */
export class PermissionCoordinator {
  private classifiers: SensitiveClassifier[];
  /** key = `${appSessionId}::${classifierId}` */
  private alwaysAllowed = new Set<string>();

  constructor(classifiers: SensitiveClassifier[] = [sessionHistoryAccessClassifier]) {
    this.classifiers = [...classifiers];
  }

  registerClassifier(classifier: SensitiveClassifier): void {
    if (this.classifiers.some((c) => c.id === classifier.id)) return;
    this.classifiers.push(classifier);
  }

  /** 用户选 allow_always 后，对本 app session + 分类器放行直至进程结束。 */
  rememberAllowAlways(appSessionId: string, classifierId: string): void {
    this.alwaysAllowed.add(`${appSessionId}::${classifierId}`);
  }

  clearSession(appSessionId: string): void {
    for (const key of [...this.alwaysAllowed]) {
      if (key.startsWith(`${appSessionId}::`)) this.alwaysAllowed.delete(key);
    }
  }

  matchedClassifier(
    request: RequestPermissionRequest,
  ): SensitiveClassifier | undefined {
    return this.classifiers.find((c) => c.match(request));
  }

  evaluate(
    request: RequestPermissionRequest,
    mode: ApprovePolicyMode,
    appSessionId?: string,
  ): PermissionDecision {
    const matched = this.matchedClassifier(request);

    if (matched) {
      if (mode === "deny") {
        return pickReject(request);
      }
      if (
        appSessionId &&
        this.alwaysAllowed.has(`${appSessionId}::${matched.id}`)
      ) {
        return { ...pickAllow(request), reason: "cached_allow_always" };
      }
      // 敏感访问：yolo / ask 都强制人工确认
      return {
        kind: "ask",
        reason: "sensitive_classifier",
        classifierId: matched.id,
      };
    }

    if (mode === "deny") return pickReject(request);
    if (mode === "ask") return { kind: "ask", reason: "approve_ask" };
    return pickAllow(request);
  }

  /**
   * 把 decision 落成 ACP Response；ask 由调用方挂起，不在此处理。
   */
  toImmediateResponse(
    decision: PermissionDecision,
  ): RequestPermissionResponse | null {
    if (decision.kind === "ask") return null;
    if (decision.kind === "cancel") {
      return { outcome: { outcome: "cancelled" } };
    }
    return {
      outcome: { outcome: "selected", optionId: decision.optionId },
    };
  }
}

export function createDefaultCoordinator(): PermissionCoordinator {
  return new PermissionCoordinator();
}
