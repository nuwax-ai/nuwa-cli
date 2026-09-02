#!/usr/bin/env python3
"""check_env.py — 平台凭据体检：GET /repo/spaces。

通 = 列出空间并标出个人空间；不通按退出码约定报错。
"""

from __future__ import annotations

import argparse
import sys

from platform_http import api_ok, configure_stdio_utf8, data_of


def list_spaces() -> list[dict]:
    payload = api_ok("GET", "/spaces")
    spaces = data_of(payload)
    items = spaces.get("data") if isinstance(spaces, dict) and isinstance(spaces.get("data"), list) else spaces
    return items if isinstance(items, list) else []


def main() -> None:
    configure_stdio_utf8()
    parser = argparse.ArgumentParser(description="PLATFORM_BASE_URL/SANDBOX_ACCESS_KEY 体检")
    parser.add_argument("--quiet", action="store_true", help="仅输出 Personal spaceId 或空")
    args = parser.parse_args()

    items = list_spaces()
    personal = next((s for s in items if s.get("type") == "Personal"), None)
    if args.quiet:
        print(personal["id"] if personal else "")
        return

    print(f"[OK] 凭据可用，共 {len(items)} 个空间")
    for s in items[:10]:
        tag = "（个人）" if s.get("type") == "Personal" else ""
        print(f"  - id={s.get('id')} {s.get('name', s.get('title', ''))}{tag}")
    if personal:
        print(f"[OK] 个人空间 spaceId={personal['id']}（导入默认目标）")
    elif items:
        print("[WARN] 未找到 type=Personal 空间，导入将回退第一个空间")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        print(f"[ERROR] 未预期异常：{e}", file=sys.stderr)
        sys.exit(3)
