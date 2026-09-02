#!/usr/bin/env python3
"""conversation.py — 平台会话创建/继续/收尾（/api/v1/4sandbox/agent 前缀）。

子命令：
  new      POST /conversation/create {agentId, devMode} → data.id（打印 conversationId）
           与平台 UI「新调试会话」等价；devMode=true 时后端回写 agent.devConversationId。
  config   GET /{devAgentId} 读 agent 配置全文（含 devConversationId——当前会话的权威来源）。
  refresh  只打印当前 devConversationId（GET config 提取）。
  cancel   POST /conversation/chat/stop/{conversationId}（页面「停止」）。

--agent-id 缺省读环境变量 DEV_AGENT_ID。
"""

from __future__ import annotations

import argparse
import json
import sys

from platform_http import AGENT_PREFIX, api_ok, configure_stdio_utf8, data_of


def resolve_agent_id(explicit: str | None) -> str:
    import os

    val = (explicit or os.environ.get("DEV_AGENT_ID", "")).strip()
    if not val:
        print("[ERROR] 缺少 agentId：传 --agent-id 或设 DEV_AGENT_ID 环境变量", file=sys.stderr)
        sys.exit(1)
    return val


def main() -> None:
    configure_stdio_utf8()
    parser = argparse.ArgumentParser(description="平台会话创建/继续/收尾")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_new = sub.add_parser("new", help="新建会话（POST /conversation/create）")
    p_new.add_argument("--agent-id", help="智能体 ID（缺省 DEV_AGENT_ID）")
    p_new.add_argument("--dev-mode", action="store_true", default=True, help="dev 调试会话（默认 true）")
    p_new.add_argument("--quiet", action="store_true")

    p_cfg = sub.add_parser("config", help="读 agent 配置全文（GET /{devAgentId}）")
    p_cfg.add_argument("--agent-id", help="智能体 ID（缺省 DEV_AGENT_ID）")
    p_cfg.add_argument("--quiet", action="store_true")

    p_ref = sub.add_parser("refresh", help="只打印当前 devConversationId")
    p_ref.add_argument("--agent-id", help="智能体 ID（缺省 DEV_AGENT_ID）")
    p_ref.add_argument("--quiet", action="store_true")

    p_cancel = sub.add_parser("cancel", help="停止会话执行（POST /conversation/chat/stop/{id}）")
    p_cancel.add_argument("conversation_id")

    args = parser.parse_args()

    if args.cmd == "new":
        agent_id = resolve_agent_id(args.agent_id)
        payload = api_ok(
            "POST",
            "/conversation/create",
            body={"agentId": int(agent_id), "devMode": args.dev_mode},
            prefix=AGENT_PREFIX,
        )
        data = data_of(payload)
        cid = str((data or {}).get("id") or "").strip()
        if not cid:
            print("[ERROR] create 成功但响应缺 data.id", file=sys.stderr)
            sys.exit(4)
        print(cid if args.quiet else f"[OK] 新建会话 conversationId={cid}")

    elif args.cmd == "config":
        agent_id = resolve_agent_id(args.agent_id)
        payload = api_ok("GET", f"/{agent_id}", prefix=AGENT_PREFIX)
        if args.quiet:
            print(json.dumps(data_of(payload), ensure_ascii=False))
        else:
            print(json.dumps(data_of(payload), ensure_ascii=False, indent=2))

    elif args.cmd == "refresh":
        agent_id = resolve_agent_id(args.agent_id)
        data = data_of(api_ok("GET", f"/{agent_id}", prefix=AGENT_PREFIX)) or {}
        cid = str(data.get("devConversationId") or "").strip()
        print(cid if args.quiet else (f"[OK] devConversationId={cid}" if cid else "[WARN] agent 尚无 devConversationId"))

    elif args.cmd == "cancel":
        api_ok("POST", f"/conversation/chat/stop/{args.conversation_id}", prefix=AGENT_PREFIX)
        print(f"[OK] 已请求停止 conversationId={args.conversation_id}")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        print(f"[ERROR] 未预期异常：{e}", file=sys.stderr)
        sys.exit(3)
