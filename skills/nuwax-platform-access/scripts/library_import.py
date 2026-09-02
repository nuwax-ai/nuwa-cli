#!/usr/bin/env python3
"""library_import.py — 把本地 md/文本一步导入 nuwax 资料库（POST /repo/import）。

不传 --space-id 自动选个人空间（type=Personal，退化取第一个）。
文本类（md/txt/html/csv）走 text 字段即可；二进制原件深度解析需 --content-base64（见 references/api-library.md）。
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys

from platform_http import api_ok, configure_stdio_utf8, data_of


def resolve_space(explicit: str | None) -> str:
    if explicit:
        return explicit
    payload = api_ok("GET", "/spaces")
    spaces = data_of(payload)
    items = spaces.get("data") if isinstance(spaces, dict) and isinstance(spaces.get("data"), list) else spaces
    if not isinstance(items, list) or not items:
        print("[ERROR] 未获取到任何空间，无法自动选择 spaceId", file=sys.stderr)
        sys.exit(4)
    personal = next((s for s in items if s.get("type") == "Personal"), None)
    chosen = personal or items[0]
    if not personal:
        print(f"[WARN] 无 Personal 空间，回退第一个 spaceId={chosen.get('id')}", file=sys.stderr)
    return str(chosen["id"])


def main() -> None:
    configure_stdio_utf8()
    parser = argparse.ArgumentParser(description="导入 md/文本到 nuwax 资料库")
    parser.add_argument("file", help="本地文件路径（文本类）")
    parser.add_argument("--title", help="页面标题（缺省取文件名去扩展名）")
    parser.add_argument("--space-id", help="目标空间（缺省自动选个人空间）")
    parser.add_argument("--parent-id", help="父页面 ID（可选）")
    parser.add_argument("--content-base64", action="store_true", help="二进制原件：读文件转 base64 放 content（触发 Sidecar 深度解析）")
    parser.add_argument("--quiet", action="store_true", help="仅输出 pageId slugId")
    args = parser.parse_args()

    if not os.path.isfile(args.file):
        print(f"[ERROR] 文件不存在: {args.file}", file=sys.stderr)
        sys.exit(1)

    title = args.title or os.path.splitext(os.path.basename(args.file))[0]
    space_id = resolve_space(args.space_id)

    body: dict = {"spaceId": space_id, "title": title, "fileName": os.path.basename(args.file)}
    if args.parent_id:
        body["parentId"] = args.parent_id
    if args.content_base64:
        with open(args.file, "rb") as f:
            body["content"] = base64.b64encode(f.read()).decode("ascii")
    else:
        with open(args.file, encoding="utf-8-sig") as f:
            body["text"] = f.read()

    payload = api_ok("POST", "/import", body)
    data = data_of(payload)
    if not isinstance(data, dict):
        data = {}
    page_id = data.get("pageId") or data.get("id")
    slug_id = data.get("slugId", "")
    parsed = data.get("parsed")
    if args.quiet:
        print(f"{page_id} {slug_id}".strip())
        return
    print(f"[OK] 已导入资料库 pageId={page_id} slugId={slug_id} title={title!r} spaceId={space_id}")
    if parsed is False:
        print("[WARN] parsed=false：二进制类型需 --content-base64 触发深度解析（当前仅原件占位）", file=sys.stderr)
    base = os.environ.get("PLATFORM_BASE_URL", "").rstrip("/")
    if base and slug_id:
        print(f"[OK] 访问：{base}/repo/doc/{slug_id}")


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
