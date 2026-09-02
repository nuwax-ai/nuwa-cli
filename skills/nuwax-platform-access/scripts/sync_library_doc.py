#!/usr/bin/env python3
"""sync_library_doc.py — 本地文档 → nuwax 资料库 的「替换式」自动同步。

语义（本地为最优先）：资料库里永远只保留最新一份，本地变 → 删旧页 + 导入新页。
  - 以文件的 sha256 做变更门闩：无变化直接跳过（静默）。
  - slug 每次会变（平台 /import 只建新页；原地改正文需 doc JSON，无沙箱转换接口）。

用法：
  sync_library_doc.py <file> --title <标题>            # 首次或常规同步（状态文件驱动）
  sync_library_doc.py <file> --title <标题> --replace-page-id 314
      # 首次接管：导入新页成功后，把旧的 314 删掉（旧页被新页顶替）

状态：~/.nuwa-cli/doc-sync-state.json（按文件绝对路径记录 sha/pageId/slugId/syncedAt）。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys

from platform_http import api_ok, configure_stdio_utf8, data_of

STATE_FILE = os.path.expanduser("~/.nuwa-cli/doc-sync-state.json")


def sha256_of(path: str) -> str:
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def load_state() -> dict:
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_state(key: str, entry: dict) -> None:
    state = load_state()
    state[key] = entry
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)
    os.chmod(STATE_FILE, 0o600)


def resolve_personal_space() -> str:
    payload = api_ok("GET", "/spaces")
    spaces = data_of(payload)
    items = spaces.get("data") if isinstance(spaces, dict) and isinstance(spaces.get("data"), list) else spaces
    if isinstance(items, list) and items:
        personal = next((s for s in items if s.get("type") == "Personal"), None)
        return str((personal or items[0])["id"])
    print("[ERROR] 未获取到空间列表", file=sys.stderr)
    sys.exit(4)


def delete_page(page_id: str) -> bool:
    try:
        api_ok("POST", f"/pages/{page_id}/delete")
        return True
    except SystemExit:
        return False


def import_page(space_id: str, title: str, text: str) -> dict:
    payload = api_ok("POST", "/import", {"spaceId": space_id, "title": title, "fileName": f"{title}.md", "text": text})
    data = data_of(payload)
    return data if isinstance(data, dict) else {}


def main() -> None:
    configure_stdio_utf8()
    parser = argparse.ArgumentParser(description="本地文档替换式同步到资料库")
    parser.add_argument("file", help="本地 md 文件")
    parser.add_argument("--title", help="页面标题（缺省文件名去扩展名）")
    parser.add_argument("--replace-page-id", help="首次接管：同步成功后删除该旧页")
    parser.add_argument("--force", action="store_true", help="忽略 sha 门闩强制同步")
    parser.add_argument("--quiet", action="store_true", help="无变更时不输出")
    args = parser.parse_args()

    file_path = os.path.abspath(args.file)
    if not os.path.isfile(file_path):
        print(f"[ERROR] 文件不存在: {file_path}", file=sys.stderr)
        sys.exit(1)

    key = file_path
    sha = sha256_of(file_path)
    state = load_state().get(key, {})

    if not args.force and state.get("sha") == sha:
        if not args.quiet:
            print(f"[UNCHANGED] 无变更（pageId={state.get('pageId')}）")
        sys.exit(0)

    title = args.title or os.path.splitext(os.path.basename(file_path))[0]
    with open(file_path, encoding="utf-8-sig") as f:
        text = f.read()

    space_id = resolve_personal_space()
    data = import_page(space_id, title, text)
    new_page = str(data.get("pageId") or data.get("id") or "")
    slug = str(data.get("slugId") or "")
    if not new_page:
        print("[ERROR] 导入成功但响应缺 pageId", file=sys.stderr)
        sys.exit(4)

    old_page = args.replace_page_id or str(state.get("pageId") or "")
    removed = None
    if old_page and old_page != new_page:
        removed = old_page if delete_page(old_page) else None

    base = os.environ.get("PLATFORM_BASE_URL", "").strip()
    if not base:
        from platform_http import resolve_platform_base
        base = resolve_platform_base()

    save_state(key, {"sha": sha, "pageId": new_page, "slugId": slug, "title": title,
                     "syncedAt": __import__("datetime").datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")})
    print(f"[SYNCED] {title} pageId={new_page} slug={slug}（旧页 {removed or '无'} 已删除）")
    print(f"[URL] {base}/repo/doc/{slug}")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        print(f"[ERROR] 未预期异常：{e}", file=sys.stderr)
        sys.exit(3)
