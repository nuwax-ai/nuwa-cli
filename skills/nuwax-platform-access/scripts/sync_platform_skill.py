#!/usr/bin/env python3
"""sync_platform_skill.py — skill 全链同步：本地正本 → S3 → 平台技能库 → 发布。

把 references/platform-skill-sync.md 的人工五步代码化（2026-09-02 契约）：
  1. 读正本 frontmatter（name/description/metadata.version）
  2. S3 发布（委托 skills/scripts/publish-skill.sh，含 frontmatter 门禁 + syncedAt 刷新）
  3. 平台 add（首配）或 update（文件差集：create/modify/delete）
  4. GET /skill/export/{id} 解包逐文件 sha256 比对
  5. POST /publish/apply 发布并确认 publishStatus=Published；add 场景回写 platformSkillId 再同步一轮

用法:
  python3 sync_platform_skill.py [skillDir ...] [--skip-s3] [--dry-run]
  缺省同步本仓库 skills/ 下全部套件成员（nuwa-cli-usage、nuwax-platform-access）。

退出码：0 成功 | 1 参数错 | 2 缺环境 | 3 HTTP 失败 | 4 业务/核验失败。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

from platform_http import AGENT_PREFIX, api_ok, configure_stdio_utf8

SANDBOX_PREFIX = "/api/v1/4sandbox"
EXCLUDE_NAMES = {".DS_Store", "__pycache__", ".installed", ".nuwa-app-version"}
HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent.parent.parent  # skills/nuwax-platform-access/scripts → 仓库根
DEFAULT_SKILLS = ["nuwa-cli-usage", "nuwax-platform-access"]


def read_frontmatter(skill_dir: Path) -> dict:
    text = (skill_dir / "SKILL.md").read_text(encoding="utf-8")
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not m:
        fail(f"{skill_dir}/SKILL.md 缺 frontmatter", 1)
    fm = m.group(1)
    name = re.search(r"^name: (.+)$", fm, re.M)
    desc = re.search(r"^description: (.+)$", fm, re.M)
    ver = re.search(r'^  version: "([^"]+)"', fm, re.M)
    sid = re.search(r"^  platformSkillId: (\d+)", fm, re.M)
    if not (name and desc and ver):
        fail("frontmatter 缺 name/description/metadata.version（先过 publish-skill.sh 门禁）", 1)
    return {
        "name": name.group(1).strip(),
        "description": desc.group(1).strip(),
        "version": ver.group(1),
        "platformSkillId": int(sid.group(1)) if sid else None,
    }


def collect_files(skill_dir: Path) -> list[tuple[str, bytes]]:
    """[(相对路径, 字节)]，排除杂项；排序保证 manifest 与比对稳定。"""
    out = []
    for p in sorted(skill_dir.rglob("*")):
        if not p.is_file():
            continue
        if any(part in EXCLUDE_NAMES for part in p.parts):
            continue
        out.append((p.relative_to(skill_dir).as_posix(), p.read_bytes()))
    return out


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def personal_space_id() -> int:
    data = api_ok("GET", "/space/list", prefix=SANDBOX_PREFIX).get("data") or []
    for sp in data:
        if sp.get("type") == "Personal":
            return int(sp["id"])
    fail("未找到个人空间（GET /space/list 无 type=Personal）", 4)


def platform_skill_detail(skill_id: int) -> dict:
    return api_ok("GET", f"/skill/{skill_id}", prefix=SANDBOX_PREFIX).get("data") or {}


def remote_file_set(skill_id: int) -> set[str]:
    detail = platform_skill_detail(skill_id)
    return {f.get("name") for f in (detail.get("files") or []) if isinstance(f, dict)}


def push_to_platform(skill_dir: Path, fm: dict, skill_id: int | None, space_id: int, dry: bool) -> int:
    """add 或 update；返回 skillId。文件差集算 operation。"""
    files_local = collect_files(skill_dir)
    body_files = []
    if skill_id:
        remote = remote_file_set(skill_id)
        for rel, blob in files_local:
            op = "modify" if rel in remote else "create"
            body_files.append({"name": rel, "contents": blob.decode("utf-8", errors="strict")
                               if _is_text(rel) else _fail_binary(rel), "operation": op, "isDir": False})
        for rel in sorted(remote - {r for r, _ in files_local}):
            body_files.append({"name": rel, "contents": "", "operation": "delete", "isDir": False})
    else:
        for rel, blob in files_local:
            body_files.append({"name": rel, "contents": _fail_binary(rel) if not _is_text(rel) else blob.decode("utf-8"), "operation": "create", "isDir": False})

    body = {
        "name": fm["name"],
        "description": fm["description"],
        "usageScenarios": ["TaskAgent"],
        "spaceId": space_id,
        "files": body_files,
    }
    if skill_id:
        body["id"] = skill_id
        if dry:
            print(f"  [dry] POST /skill/update id={skill_id} files={len(body_files)}")
            return skill_id
        api_ok("POST", "/skill/update", body=body, prefix=SANDBOX_PREFIX)
        print(f"  [OK] 平台已更新 skill {skill_id}（{len(body_files)} 文件项）")
        return skill_id
    if dry:
        print(f"  [dry] POST /skill/add files={len(body_files)}")
        return 0
    data = api_ok("POST", "/skill/add", body=body, prefix=SANDBOX_PREFIX).get("data")
    new_id = int(data)
    print(f"  [OK] 平台已新建 skillId={new_id}")
    return new_id


def _is_text(rel: str) -> bool:
    return Path(rel).suffix.lower() in {".md", ".py", ".sh", ".json", ".yaml", ".yml", ".js", ".ts", ".txt", ".html", ".css"}


def _fail_binary(rel: str) -> str:
    fail(f"二进制文件 {rel} 不能走 REST contents 内嵌——走备选链路（platform-skill-sync.md §备选：agent 会话 + 工作区直写）", 4)


def verify_export(skill_id: int, skill_dir: Path) -> None:
    """GET /skill/export/{id} → zip 解包逐文件 sha256 比对。"""
    import urllib.request
    from platform_http import resolve_access_key, resolve_platform_base
    base, token = resolve_platform_base(), resolve_access_key()
    req = urllib.request.Request(f"{base}{SANDBOX_PREFIX}/skill/export/{skill_id}",
                                 headers={"Authorization": f"Bearer {token}", "Accept": "application/octet-stream"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        blob = resp.read()
    local = dict(collect_files(skill_dir))
    bad = []
    with tempfile.TemporaryDirectory() as td:
        zf_path = Path(td) / "export.zip"
        zf_path.write_bytes(blob)
        with zipfile.ZipFile(zf_path) as zf:
            remote = {}
            for info in zf.infolist():
                if info.is_dir():
                    continue
                rel = info.filename.split("/", 1)[1] if "/" in info.filename else info.filename
                remote[rel] = zf.read(info)
    for rel in sorted(set(local) | set(remote)):
        l, r = local.get(rel), remote.get(rel)
        if l != r:
            bad.append(f"{rel}: local={sha256(l) if l else '∅'} remote={sha256(r) if r else '∅'}")
    if bad:
        print("[ERROR] export 核验不一致：\n  " + "\n  ".join(bad), file=sys.stderr)
        sys.exit(4)
    print(f"  [OK] export 核验 {len(local)} 文件逐字节一致")


def publish_skill(skill_id: int, fm: dict, dry: bool) -> None:
    body = {"targetType": "Skill", "targetId": skill_id,
            "remark": f"{fm['name']} v{fm['version']}",
            "items": [{"scope": "Space", "allowCopy": 1, "onlyTemplate": 0}]}
    if dry:
        print(f"  [dry] POST /publish/apply targetId={skill_id}")
        return
    api_ok("POST", "/publish/apply", body=body, prefix=SANDBOX_PREFIX)
    detail = platform_skill_detail(skill_id)
    status = detail.get("publishStatus")
    if status != "Published":
        fail(f"发布后 publishStatus={status}（预期 Published；publishDate 回填有延迟，可稍后复核）", 4)
    print(f"  [OK] 已发布 skill {skill_id} → Published")


def write_back_platform_id(skill_dir: Path, fm: dict, skill_id: int) -> None:
    if fm["platformSkillId"] == skill_id:
        return
    path = skill_dir / "SKILL.md"
    text = path.read_text(encoding="utf-8")
    if "platformSkillId:" in text:
        text = re.sub(r"^  platformSkillId: \d+", f"  platformSkillId: {skill_id}", text, flags=re.M)
    else:
        text = text.replace("metadata:", f"metadata:\n  platformSkillId: {skill_id}", 1)
    path.write_text(text, encoding="utf-8")
    print(f"  [OK] frontmatter 回写 platformSkillId={skill_id}（需再同步一轮保持逐字节一致）")


def fail(msg: str, code: int) -> None:
    print(f"[ERROR] {msg}", file=sys.stderr)
    sys.exit(code)


def sync_one(skill_name: str, skip_s3: bool, dry: bool) -> None:
    skill_dir = REPO_ROOT / "skills" / skill_name
    if not (skill_dir / "SKILL.md").is_file():
        fail(f"skill 目录不存在：{skill_dir}", 1)
    fm = read_frontmatter(skill_dir)
    print(f"== {fm['name']} v{fm['version']} (platformSkillId={fm['platformSkillId'] or '未配'})")

    if not skip_s3:
        script = REPO_ROOT / "skills" / "scripts" / "publish-skill.sh"
        cmd = ["bash", str(script), str(skill_dir)] + (["--dry-run"] if dry else [])
        r = subprocess.run(cmd, capture_output=True, text=True)
        tail = (r.stdout + r.stderr).strip().splitlines()
        print("  [S3] " + tail[0] if tail else "  [S3] (无输出)")
        if r.returncode != 0:
            print("[ERROR] publish-skill.sh 失败：\n" + "\n".join(tail[-10:]), file=sys.stderr)
            sys.exit(r.returncode or 3)
        fm = read_frontmatter(skill_dir)  # syncedAt 可能被刷新，重读

    space_id = personal_space_id()
    skill_id = fm["platformSkillId"]
    skill_id = push_to_platform(skill_dir, fm, skill_id, space_id, dry)
    if dry:
        print("  [dry] 跳过 export 核验与发布")
        return
    verify_export(skill_id, skill_dir)
    publish_skill(skill_id, fm, dry=False)
    # add 场景回写 id 后需再来一轮 update+publish 保持逐字节一致
    if fm["platformSkillId"] != skill_id:
        write_back_platform_id(skill_dir, fm, skill_id)
        fm2 = read_frontmatter(skill_dir)
        push_to_platform(skill_dir, fm2, skill_id, space_id, False)
        verify_export(skill_id, skill_dir)
        publish_skill(skill_id, fm2, dry=False)


def main() -> None:
    configure_stdio_utf8()
    p = argparse.ArgumentParser(description="skill 全链同步：本地 → S3 → 平台 → 发布")
    p.add_argument("skills", nargs="*", help="skill 目录名（缺省同步套件全部成员）")
    p.add_argument("--skip-s3", action="store_true", help="跳过 S3 发布（只同步平台）")
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()
    names = args.skills or DEFAULT_SKILLS
    for name in names:
        sync_one(name, args.skip_s3, args.dry_run)
    print("[DONE] 全链同步完成")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        print(f"[ERROR] 未预期异常：{e}", file=sys.stderr)
        sys.exit(3)
