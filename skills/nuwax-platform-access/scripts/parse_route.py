#!/usr/bin/env python3
"""parse_route.py — nuwax(PC) / nuwax-mobile(移动端) 路由解析与业务参数对照。

解析 URL/路径 → 统一业务参数字典（conversationId/agentId/spaceId/...），标注参数
来源（路径段/query）与语义漂移警告（如两端 `id` 含义相反）。

用法:
  python3 parse_route.py <url_or_path> [--app pc|mobile|auto] [--json]
  python3 parse_route.py --compare                  # 两端业务参数对照表
  python3 parse_route.py --routes [pc|mobile]       # 列路由/页面快照

内置路由快照提取自仓库（提取日期见 ROUTE_SNAPSHOT_DATE）：
  PC     nuwax/src/routes/index.ts（umi4，:param 动态段）
  Mobile nuwax-mobile/pages.json + 页面 onLoad 实测（静态页 + query 传参）
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from urllib.parse import urlsplit, parse_qsl

ROUTE_SNAPSHOT_DATE = "2026-09-02"

# ---- PC 路由 pattern（动态段 :name）。语义映射后缀：段名 -> 规范业务参数 ----
PC_PATTERNS = [
    ("/home/chat/:id/:agentId", {"id": "conversationId"}),
    ("/app/chat/:agentId/:id", {"id": "conversationId"}),  # 注意顺序与 /home/chat 相反
    ("/agent/:agentId", {}),
    ("/chat-temp/:chatKey", {}),
    ("/open-iframe-page/:menuCode", {}),
    ("/app/open-iframe-page/:agentId", {}),
    ("/app/history/conversation/:agentId", {}),
    ("/history/conversation/:agentId", {}),
    ("/space/:spaceId/agent/:agentId", {}),
    ("/space/:spaceId/:agentId/log", {}),
    ("/space/:spaceId/skill-details/:skillId", {}),
    ("/space/:spaceId/apply/skill-details/:skillId", {}),
    ("/space/:spaceId/published/skill-details/:skillId", {}),
    ("/space/:spaceId/skill-details-conversation/:skillId", {}),
    ("/space/:spaceId/plugin/:pluginId", {}),
    ("/space/:spaceId/plugin/:pluginId/cloud-tool", {}),
    ("/space/:spaceId/mcp/edit/:mcpId", {}),
    ("/space/:spaceId/knowledge/:knowledgeId", {}),
    ("/space/:spaceId/table/:tableId", {}),
    ("/space/:spaceId/workflow/:workflowId", {}),
    ("/space/:spaceId/app-dev/:projectId", {}),
    ("/space/:spaceId/app-dev-design/:projectId", {}),
    ("/space/original-text/:segmentId/:agentId", {}),
    ("/space/publish/plugin/:pluginId", {}),
    ("/space/publish/workflow/:workflowId", {}),
    ("/space/publish/skill/:skillId", {}),
    ("/square/publish/plugin/:pluginId", {}),
    ("/square/publish/workflow/:workflowId", {}),
    ("/square/publish/skill/:skillId", {}),
    ("/app/:agentId", {}),  # 开放应用前缀（子页 /app/:agentId/my-subscriptions 等）
    ("/lang-content/:lang", {}),
]

# ---- Mobile 页面参数语义（页面路径 -> {query 键 -> 规范业务参数}）----
# 仅收录已实证（源码 onLoad / 跳转 URL 实测）的映射；"id" 语义按页面标注。
MOBILE_PAGES = {
    "subpackages/pages/agent-detail/agent-detail": {
        "id": "agentId",  # [!] 与 PC /home/chat/:id 相反
        "conversationId": "conversationId",
        "accessToken": "_shell_token",
        "statusBarHeight": "_shell_ui",
        "_rs": "_shell_nonce",
    },
    "subpackages/pages/terminal/terminal-device-detail": {"deviceId": "deviceId"},
    "pages/chat-temp/chat-temp": {"chatKey": "chatKey"},
    "subpackages/pages/chat-temp/chat-temp": {"chatKey": "chatKey"},
    "subpackages/pages/terminal-goods-detail": {"goodsId": "goodsId"},
    "subpackages/pages/my-subscriptions/my-subscriptions": {"planId": "planId", "payMode": "payMode"},
    "subpackages/pages/my-orders/my-orders": {"orderId": "orderId", "payMode": "payMode"},
}

# 跳转 URL 实测出现过的 query 键（页面未逐一标注语义的兜底直传）
MOBILE_PASSTHROUGH = {
    "agentId": "agentId", "conversationId": "conversationId", "spaceId": "spaceId",
    "deviceId": "deviceId", "bindingId": "bindingId", "planId": "planId",
    "packageId": "packageId", "goodsId": "goodsId", "payMode": "payMode",
    "categoryKey": "categoryKey", "orderId": "orderId", "cId": "workspaceConversationId",
    "chatKey": "chatKey", "fileProxyUrl": "fileProxyUrl",
}
MOBILE_SHELL_KEYS = {"_rs", "statusBarHeight", "accessToken", "noTicket", "hideShare", "subview", "title", "redirect"}

WARNINGS = [
    "语义漂移[!]: PC /home/chat/:id/:agentId 的 :id=conversationId；mobile agent-detail 的 id=agentId。同名不同义，跨端拼接 URL 必须换名。",
    "顺序漂移[!]: /home/chat/:id/:agentId 与 /app/chat/:agentId/:id 两段顺序相反。",
    "spaceId 仅 PC 有空间域路由（/space/:spaceId/**）；mobile 无对应原生页。",
    "mobile H5 形态 = {API_BASE}/m/?_rs=<nonce>#/<page-path>?<query>（hash 路由），壳参数 _rs/statusBarHeight/accessToken 非业务参数。",
]


def _match_pc(path: str):
    path = path.rstrip("/") or "/"
    for pattern, sem in PC_PATTERNS:
        pp = pattern.rstrip("/")
        p_parts, u_parts = pp.split("/"), path.split("/")
        if len(p_parts) != len(u_parts):
            continue
        params, ok = {}, True
        for p_seg, u_seg in zip(p_parts, u_parts):
            if p_seg.startswith(":"):
                params[p_seg[1:]] = u_seg
            elif p_seg != u_seg:
                ok = False
                break
        if ok:
            return pattern, params, sem
    return None, {}, {}


def _norm_pc(raw: dict, sem: dict):
    out = {}
    for k, v in raw.items():
        # PC pattern 段名本身已语义化（:agentId→agentId）；仅 :id 这类无义名需 sem 映射
        name = sem.get(k, "conversationId?" if k == "id" else k)
        out[name] = {"value": v, "source": f"path:{k}"}
    return out


def _split_mobile(target: str):
    """mobile 原生页路径或 H5 形态（/m/?_rs=..#/page?query）→ (page, query dict, is_h5)"""
    is_h5 = "/m/" in target or "#/" in target
    if is_h5:
        hash_part = target.split("#/", 1)[1] if "#/" in target else ""
        page, _, qs = hash_part.partition("?")
    else:
        target = urlsplit(target)
        page, qs = target.path, target.query
        page = page.lstrip("/").replace(".uvue", "")
    return page.strip("/"), dict(parse_qsl(qs, keep_blank_values=True)), is_h5


def parse(target: str, app: str = "auto", as_json: bool = False):
    low = target
    if app == "pc" or (app == "auto" and "/m/" not in low and "#/" not in low
                       and not re.match(r"^(pages|subpackages)/", low)):
        path = urlsplit(target).path or target.split("?")[0]
        pattern, params, sem = _match_pc(path)
        extra = dict(parse_qsl(urlsplit(target).query, keep_blank_values=True))
        if pattern is None:
            # 静态路由直报
            result = {"app": "pc", "route": path, "matched": False,
                      "params": {k: {"value": v, "source": "query"} for k, v in extra.items()}}
        else:
            p = _norm_pc(params, sem)
            p.update({k: {"value": v, "source": "query"} for k, v in extra.items()})
            result = {"app": "pc", "route": pattern, "matched": True, "params": p}
    else:
        page, query, is_h5 = _split_mobile(target)
        sem = MOBILE_PAGES.get(page) or MOBILE_PAGES.get(page.rsplit("/", 1)[0]) or {}
        params = {}
        for k, v in query.items():
            name = sem.get(k) or MOBILE_PASSTHROUGH.get(k) or ("_shell_" + k if k in MOBILE_SHELL_KEYS else k)
            params[name] = {"value": v, "source": f"query:{k}"}
        result = {"app": "mobile", "route": page, "h5_form": is_h5, "matched": page in MOBILE_PAGES, "params": params}
    result["snapshot_date"] = ROUTE_SNAPSHOT_DATE
    if not as_json:
        lines = [f"[{result['app']}] {result['route']}  (matched={result.get('matched', True)})"
                 + ("  [H5 hash 形态]" if result.get("h5_form") else "")]
        for k, v in result["params"].items():
            lines.append(f"  {k} = {v['value']}   <- {v['source']}")
        if not result["params"]:
            lines.append("  (无业务参数)")
        return "\n".join(lines)
    return json.dumps(result, ensure_ascii=False, indent=2)


def compare() -> str:
    rows = [
        ("会话 conversationId", "path 段 :id（/home/chat/:id/:agentId；/app/chat 中 :id 居末）", "query conversationId（agent-detail，伴随 id=<agentId>）"),
        ("智能体 agentId", "path 段 :agentId（/agent、/space/:s/agent、/app 前缀）", "query agentId；[!] agent-detail 页用 id=agentId"),
        ("空间 spaceId", "path 段 :spaceId（/space/** 域路由）", "无对应原生页（移动端弱化空间域）"),
        ("技能 skillId", "path 段 :skillId（skill-details 三个变体）", "无独立页（H5 内承载）"),
        ("设备 deviceId", "—", "query deviceId（terminal-device-detail）"),
        ("订阅 planId / 积分 packageId", "页内状态，无路由段", "query planId / packageId / payMode"),
        ("临时会话", "/chat-temp/:chatKey（路径段）", "pages/chat-temp（query，键以页面为准）"),
        ("工作区会话 cId", "—", "query cId（nuwax 文件工作区会话）"),
    ]
    out = [f"nuwax(PC) vs nuwax-mobile 业务参数对照（快照 {ROUTE_SNAPSHOT_DATE}）", ""]
    out.append(f"{'业务实体':<18} | {'PC（umi 路径段）':<42} | Mobile（query）")
    out.append("-" * 100)
    for r in rows:
        out.append(f"{r[0]:<18} | {r[1]:<42} | {r[2]}")
    out.append("")
    out.extend("[!] " + w for w in WARNINGS)
    return "\n".join(out)


def routes(which: str) -> str:
    if which == "pc":
        return f"PC 动态段路由 {len(PC_PATTERNS)} 条（快照 {ROUTE_SNAPSHOT_DATE}，全量见 nuwax/src/routes/index.ts）：\n" + "\n".join(f"  {p}" for p, _ in PC_PATTERNS)
    return f"mobile 已知页面参数映射（快照 {ROUTE_SNAPSHOT_DATE}）：\n" + "\n".join(f"  {k}: {v}" for k, v in MOBILE_PAGES.items())


def main() -> None:
    ap = argparse.ArgumentParser(description="nuwax/nuwax-mobile 路由解析与业务参数对照")
    ap.add_argument("target", nargs="?", help="URL 或路由路径")
    ap.add_argument("--app", default="auto", choices=["auto", "pc", "mobile"])
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--compare", action="store_true", help="输出两端业务参数对照表")
    ap.add_argument("--routes", choices=["pc", "mobile"], help="列路由快照")
    a = ap.parse_args()

    if a.compare:
        print(compare())
        return
    if a.routes:
        print(routes(a.routes))
        return
    if not a.target:
        ap.error("需要 target 或 --compare/--routes")
    print(parse(a.target, a.app, a.json))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001
        print(f"[ERROR] {e}", file=sys.stderr)
        sys.exit(1)
