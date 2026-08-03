// PermissionCoordinator — nuwa-cli 侧决策协调器。
//
// 决策原语（classifier 框架、allow_always 缓存、option pickers、chain runner）在
// @nuwax-ai/agent-kit。本类是 nuwa-cli 的产品级装配：[classifier 阶段 → mode 策略阶段]。
// nuwaclaw 用同一套原语装配自己的链（question-deny / strict guard / tool_rules /
// agent_mode），从而两边共享底层逻辑、各自持有产品语义。

import type { RequestPermissionRequest } from "@agentclientprotocol/sdk";
import type { RequestPermissionResponse } from "@agentclientprotocol/sdk";
import {
  runDecisionChain,
  createAllowAlwaysCache,
  findMatchingClassifier,
  pickAllow,
  pickReject,
  decisionToResponse,
  type ApprovePolicyMode,
  type PermissionDecision,
  type PermissionStage,
  type SensitiveClassifier,
} from "@nuwax-ai/agent-kit";
import { sessionHistoryAccessClassifier } from "./classifiers/sessionHistoryAccess.js";

export type { ApprovePolicyMode, PermissionDecision };

/** evaluate 的决策上下文（nuwa-cli 只需 mode + appSessionId）。 */
interface CoordinatorCtx {
  mode: ApprovePolicyMode;
  appSessionId?: string;
}

/**
 * ACP 权限决策协调器。
 *
 * 决策顺序（runDecisionChain 跑两个阶段，首个终结胜出）：
 * 1. classifier 阶段：敏感分类器命中 → deny 模式 reject / allow_always 缓存命中 select / 否则强制 ask
 * 2. mode 策略阶段：yolo 放行 / ask 人工 / deny 拒绝
 */
export class PermissionCoordinator {
  private classifiers: SensitiveClassifier[];
  private readonly cache = createAllowAlwaysCache();

  constructor(classifiers: SensitiveClassifier[] = [sessionHistoryAccessClassifier]) {
    this.classifiers = [...classifiers];
  }

  registerClassifier(classifier: SensitiveClassifier): void {
    if (this.classifiers.some((c) => c.id === classifier.id)) return;
    this.classifiers.push(classifier);
  }

  /** 用户选 allow_always 后，对本 app session + 分类器放行直至进程结束。 */
  rememberAllowAlways(appSessionId: string, classifierId: string): void {
    this.cache.add(appSessionId, classifierId);
  }

  clearSession(appSessionId: string): void {
    this.cache.clearSession(appSessionId);
  }

  matchedClassifier(
    request: RequestPermissionRequest,
  ): SensitiveClassifier | undefined {
    return findMatchingClassifier(request, this.classifiers);
  }

  /** classifier 阶段：命中敏感分类器时终结（deny→reject / 缓存→select / 否则 ask）。 */
  private readonly classifierStage: PermissionStage<CoordinatorCtx> = (
    request,
    ctx,
  ) => {
    const matched = findMatchingClassifier(request, this.classifiers);
    if (!matched) return null;
    if (ctx.mode === "deny") return pickReject(request);
    if (ctx.appSessionId && this.cache.has(ctx.appSessionId, matched.id)) {
      return { ...pickAllow(request), reason: "cached_allow_always" };
    }
    // 敏感访问：yolo / ask 都强制人工确认
    return {
      kind: "ask",
      reason: "sensitive_classifier",
      classifierId: matched.id,
    };
  };

  /** mode 策略阶段：非敏感请求按 approve 策略终结。 */
  private readonly modePolicyStage: PermissionStage<CoordinatorCtx> = (
    request,
    ctx,
  ) => {
    if (ctx.mode === "deny") return pickReject(request);
    if (ctx.mode === "ask") return { kind: "ask", reason: "approve_ask" };
    return pickAllow(request);
  };

  evaluate(
    request: RequestPermissionRequest,
    mode: ApprovePolicyMode,
    appSessionId?: string,
  ): PermissionDecision {
    return runDecisionChain<CoordinatorCtx>(
      [this.classifierStage, this.modePolicyStage],
      request,
      { mode, appSessionId },
    );
  }

  /** 把 decision 落成 ACP Response；ask 由调用方挂起，不在此处理。 */
  toImmediateResponse(
    decision: PermissionDecision,
  ): RequestPermissionResponse | null {
    return decisionToResponse(decision);
  }
}

export function createDefaultCoordinator(): PermissionCoordinator {
  return new PermissionCoordinator();
}
