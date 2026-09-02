#!/usr/bin/env python3
"""check_env.py — nuwax-platform-access 前置体检（分层门禁）。

使用本 skill 任何核心功能前先跑一遍。五层，任一层 FAIL 给出修复指引：

  L1 安装     nuwa-cli 可执行（shutil.which）
  L2 版本     当前版本 vs npm 最新（网络失败降级 SKIP，不阻塞）
  L3 服务     gateway/file-server/lanproxy 存活（nuwa-cli status，兜底端口探活）
  L4 登录态   ~/.nuwa-cli/credentials.json 有 domain+savedKey
  L5 平台 API SANDBOX_ACCESS_KEY → GET /repo/spaces（原体检逻辑）

用法:
  python3 check_env.py                 # 全层体检
  python3 check_env.py --skip-npm      # 跳过 L2 的 npm 网络查询
  python3 check_env.py --json          # 结构化输出
  python3 check_env.py --quiet         # 仅输出 Personal spaceId 或空（兼容旧用法）
退出码: 0 全过（WARN/SKIP 不算失败）| 1 体检 FAIL（L1-L4）| 2 缺环境/缺 AK（L5）| 3 HTTP 失败/超时（L5）| 4 平台业务错误（L5）
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import socket
import subprocess
import sys
from pathlib import Path

from platform_http import api_ok, configure_stdio_utf8, data_of

CREDENTIALS_FILE = Path.home() / ".nuwa-cli" / "credentials.json"
NPM_PACKAGE = "@nuwax-ai/nuwa-cli"
SERVICE_PORTS = {"gateway": 60016, "file-server": 60015, "lanproxy": 10076}


def _run(cmd: list[str], timeout: int = 10) -> tuple[int, str]:
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return r.returncode, (r.stdout or r.stderr or "").strip()
    except (OSError, subprocess.TimeoutExpired) as e:
        return 127, str(e)


def _port_open(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(1.5)
        return s.connect_ex(("127.0.0.1", port)) == 0


def check_install() -> tuple[str, str]:
    """L1 安装。→ (state, detail)"""
    path = shutil.which("nuwa-cli")
    if not path:
        return "FAIL", "未找到 nuwa-cli。修复: npx @nuwax-ai/nuwa-cli@latest install"
    return "OK", path


def check_version(skip_npm: bool) -> tuple[str, str]:
    """L2 版本与升级。npm 查询失败降级 SKIP。"""
    code, out = _run(["nuwa-cli", "--version"])
    if code != 0:
        return "FAIL", f"nuwa-cli --version 失败: {out[:120]}"
    cur = out.splitlines()[0].strip()
    if skip_npm:
        return "SKIP", f"当前 {cur}（未查 npm 最新）"
    code, out = _run(["npm", "view", NPM_PACKAGE, "version"], timeout=15)
    if code != 0:
        return "SKIP", f"当前 {cur}（npm 查询失败: {out[:80]}）"
    latest = out.splitlines()[-1].strip()
    if cur != latest:
        return "WARN", f"当前 {cur} < 最新 {latest}。升级: nuwa-cli update"
    return "OK", f"当前 {cur} = npm 最新"


def check_services() -> tuple[str, str]:
    """L3 本机服务。优先 nuwa-cli status（正则忽略大小写），down 项用端口探活复核兜底。"""
    code, out = _run(["nuwa-cli", "status"], timeout=15)
    if code == 0 and out:
        down = [n for n in SERVICE_PORTS if not re.search(rf"{n}\s*:\s*running", out, re.I)]
        down = [n for n in down if not _port_open(SERVICE_PORTS[n])]  # status 格式漂移时以端口为准
        if not down:
            return "OK", "status: gateway/file-server/lanproxy 均 running"
        return "FAIL", f"服务未运行: {', '.join(down)}。修复: nuwa-cli start"
    alive = [n for n, p in SERVICE_PORTS.items() if _port_open(p)]
    if len(alive) >= 2:
        return "OK", f"status 命令不可用，端口探活: {', '.join(alive)} 存活"
    return "FAIL", "gateway/file-server 未探活。修复: nuwa-cli start"


def check_login() -> tuple[str, str]:
    """L4 登录态。credentials.json 有 domain+savedKey 即视为已登录。"""
    try:
        creds = json.loads(CREDENTIALS_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return "FAIL", f"无登录态（{CREDENTIALS_FILE} 缺失/损坏）。修复: nuwa-cli login"
    domain = str(creds.get("domain") or "").strip()
    saved = str(creds.get("savedKey") or "").strip()
    if domain and saved:
        return "OK", f"已登录 {domain}（{creds.get('username', '?')}）"
    return "FAIL", "credentials.json 缺 domain/savedKey。修复: nuwa-cli login"


def check_platform_api(quiet: bool = False) -> tuple[str, str, list[dict], int | None]:
    """L5 平台 API（AK → /repo/spaces）。返回 (state, detail, spaces, exit_code)。"""
    try:
        payload = api_ok("GET", "/spaces")
    except SystemExit as e:
        # platform_http 退出码：2 缺环境/缺 AK | 3 HTTP 失败/超时 | 4 业务错误——按码透传，不折叠
        code = e.code if isinstance(e.code, int) else 3
        hints = {
            2: "缺 SANDBOX_ACCESS_KEY/平台地址：export SANDBOX_ACCESS_KEY 或写 ~/.nuwa-cli/skill-env.json 的 aks",
            3: "HTTP 失败/超时（网络或平台侧），原始错误见上方 stderr",
            4: "平台业务错误（code≠0000，如 AK 无权限/不在目标 space），响应见上方 stderr",
        }
        return "FAIL", f"{hints.get(code, '未知失败')}（exit {code}）", [], code
    spaces = data_of(payload)
    items = spaces.get("data") if isinstance(spaces, dict) and isinstance(spaces.get("data"), list) else spaces
    items = items if isinstance(items, list) else []
    if quiet:
        return "OK", "", items, None
    personal = next((s for s in items if s.get("type") == "Personal"), None)
    detail = f"凭据可用，共 {len(items)} 个空间" + (f"；个人空间 id={personal['id']}" if personal else "；无 Personal 空间(WARN)")
    return "OK", detail, items, None


def main() -> None:
    configure_stdio_utf8()
    parser = argparse.ArgumentParser(description="nuwa-cli 安装/升级/服务/登录 + 平台 API 前置体检")
    parser.add_argument("--skip-npm", action="store_true", help="跳过 L2 npm 最新版本网络查询")
    parser.add_argument("--json", action="store_true", help="结构化输出")
    parser.add_argument("--quiet", action="store_true", help="兼容旧用法：仅输出 Personal spaceId")
    args = parser.parse_args()

    results = []
    results.append(("L1 安装", *check_install()[:2]))
    if results[-1][1] != "FAIL":
        results.append(("L2 版本", *check_version(args.skip_npm)[:2]))
        results.append(("L3 服务", *check_services()[:2]))
        results.append(("L4 登录态", *check_login()[:2]))
    else:
        results += [("L2 版本", "SKIP", "未安装"), ("L3 服务", "SKIP", "未安装"), ("L4 登录态", "SKIP", "未登录")]
    state, detail, items, l5_code = check_platform_api(args.quiet)
    results.append(("L5 平台API", state, detail))

    if args.quiet:
        if state == "OK":
            personal = next((s for s in items if s.get("type") == "Personal"), None)
            print(personal["id"] if personal else "")
        sys.exit(l5_code if l5_code else 0)

    has_fail = any(s == "FAIL" for _, s, _ in results)
    if args.json:
        print(json.dumps({"ok": not has_fail, "checks": [{"layer": l, "state": s, "detail": d} for l, s, d in results]},
                         ensure_ascii=False, indent=2))
    else:
        icon = {"OK": "[OK]  ", "WARN": "[WARN]", "SKIP": "[SKIP]", "FAIL": "[FAIL]"}
        for layer, state_, detail_ in results:
            print(f"{icon[state_]} {layer}: {detail_}")
        if not has_fail:
            print("[OK] 前置体检通过，可使用本 skill 核心功能")
    if l5_code:  # L5 失败按 platform_http 原生退出码透传（2 缺 AK/3 HTTP/4 业务）
        sys.exit(l5_code)
    sys.exit(1 if has_fail else 0)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        print(f"[ERROR] 未预期异常：{e}", file=sys.stderr)
        sys.exit(3)
