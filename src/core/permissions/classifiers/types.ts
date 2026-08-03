// SensitiveClassifier 框架 + extract 辅助已抽进 @nuwax-ai/agent-kit（与 nuwaclaw 共用）。
// 本文件保留为 re-export，维持本地导入路径稳定（classifiers/sessionHistoryAccess.ts 仍从此导入）。
export {
  type SensitiveClassifier,
  extractCommandFromRawInput,
  extractPathHaystack,
} from "@nuwax-ai/agent-kit";
