#!/usr/bin/env python3
"""library_export.py — 导出资料库页面（GET /repo/pages/{pageId}/export?format=）。

format：markdown | docx | pdf | xlsx | pptx | original（全实时：doc 编辑后快照自动回写）。
输出写到 --out（缺省 ./<title>.<ext>），markdown/文本类同时回显到 stdout（--print）。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request

from platform_http import api_ok, configure_stdio_utf8, data_of, resolve_access_key, resolve_platform_base

EXT = {"markdown": "md", "docx": "docx", "pdf": "pdf", "xlsx": "xlsx", "pptx": "pptx", "original": "bin"}


def main() -> None:
    configure_stdio_utf8()
    parser = argparse.ArgumentParser(description="导出资料库页面")
    parser.add_argument("page_id", help="页面 ID")
    parser.add_argument("--format", default="markdown", choices=sorted(EXT.keys()))
    parser.add_argument("--out", help="输出文件路径（缺省 ./<title>.<ext>）")
    parser.add_argument("--print", dest="print_text", action="store_true", help="文本类内容同时回显 stdout")
    args = parser.parse_args()

    payload = api_ok("GET", f"/pages/{args.page_id}/export?format={args.format}")
    data = data_of(payload)
    if not isinstance(data, dict):
        data = {}

    base = resolve_platform_base()
    token = resolve_access_key()
    title = str(data.get("title") or args.page_id)
    out = args.out or f"{title}.{EXT[args.format]}"

    markdown = data.get("markdown")
    if isinstance(markdown, str):
        content = markdown.encode("utf-8")
    else:
        url = f"{base}/api/v1/4sandbox/repo/pages/{args.page_id}/export?format={args.format}"
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            content = resp.read()

    with open(out, "wb") as f:
        f.write(content)
    print(f"[OK] 已导出 {out}（{len(content)} 字节）")
    if args.print_text and args.format in ("markdown",):
        try:
            print(content.decode("utf-8"))
        except UnicodeDecodeError:
            pass


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except json.JSONDecodeError as e:
        print(f"[ERROR] 响应非 JSON：{e}", file=sys.stderr)
        sys.exit(3)
    except Exception as e:  # noqa: BLE001
        print(f"[ERROR] 未预期异常：{e}", file=sys.stderr)
        sys.exit(3)
