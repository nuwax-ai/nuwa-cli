// 协议层（parse notify-resolved + 构造 SSE 进度数据）已抽进 @nuwax-ai/agent-kit
//（与 nuwaclaw 共用同一 legacy option_id/optionId 兼容面）。本文件保留为 re-export。
export {
  parseComputerPermissionResolveRequest,
  toComputerPermissionProgressData,
  type ComputerPermissionResolveCommand,
  type NotifyResolvedParseResult,
} from "@nuwax-ai/agent-kit";
