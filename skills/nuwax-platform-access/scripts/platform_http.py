#!/usr/bin/env python3
"""platform_http.py — nuwax 平台 API 共享 HTTP 基座。

鉴权契约（与 flow-debugger/debug_http.py 同源）：
  Authorization: Bearer $SANDBOX_ACCESS_KEY
  Base: $PLATFORM_BASE_URL

约定：
  - 业务成败看响应 JSON 的 code（"0000" 才是成功），HTTP 200 不代表成功。
  - 所有脚本仅依赖标准库；同目录直接 import 本模块。
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

REPO_PREFIX = "/api/v1/4sandbox/repo"
AGENT_PREFIX = "/api/v1/4sandbox/agent"
TIMEOUT = 30
CREDENTIALS_FILE = os.path.expanduser("~/.nuwa-cli/credentials.json")
SKILL_ENV_FILE = os.path.expanduser("~/.nuwa-cli/skill-env.json")


def _load_json(path: str) -> dict:
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _nuwa_cli_domain() -> str:
    """nuwa-cli 登录域名（动态：测试 testagent.xspaceagi.com / 生产 agent.nuwax.com 跟随登录）。"""
    creds = _load_json(CREDENTIALS_FILE)
    return str(creds.get("domain") or "").strip().rstrip("/")


def _nuwa_cli_ak_candidates() -> list[str]:
    """nuwa-cli 登录态里可能充当 SANDBOX_ACCESS_KEY 的字段（按优先级）。"""
    creds = _load_json(CREDENTIALS_FILE)
    out: list[str] = []
    for k in ("sandboxAccessKey", "token", "savedKey", "configKey"):
        v = str(creds.get(k) or "").strip()
        if v:
            out.append(v)
    return out


def _skill_env_file_value(key: str) -> str:
    env = _load_json(SKILL_ENV_FILE)
    return str(env.get(key) or "").strip()


def resolve_platform_base() -> str:
    """解析顺序：env > skill-env.json > nuwa-cli 登录域名。

    注意：登录域名永远优先级高于 skill-env.json 缓存 —— 缓存仅在从未登录过时兜底，
    避免换环境（测试 ↔ 生产）后仍指向旧域名。
    """
    val = os.environ.get("PLATFORM_BASE_URL", "").strip()
    if val:
        return val.rstrip("/")
    val = _nuwa_cli_domain()
    if val:
        return val
    val = _skill_env_file_value("PLATFORM_BASE_URL")
    if val:
        return val
    print("[ERROR] 无法确定平台地址：设 PLATFORM_BASE_URL 或先用 nuwa-cli login 登录", file=sys.stderr)
    sys.exit(2)


def resolve_access_key(probe: bool = True) -> str:
    """解析顺序：env > skill-env.json（按域名缓存）> nuwa-cli 登录态候选（在线试出来）。

    AK 缓存按域名分桶 —— 域名跟随当前 nuwa-cli 登录态，切环境自动切对应 AK。
    当前 nuwa-cli 登录态（savedKey/configKey）通常不含 4sandbox 的 SANDBOX_ACCESS_KEY，
    探测失败时给出可执行的补救指引。首个探通的值按域名回写 skill-env.json。
    """
    val = os.environ.get("SANDBOX_ACCESS_KEY", "").strip()
    if val:
        return val
    base = resolve_platform_base()
    val = _cached_ak(base)
    if val:
        return val

    for cand in _nuwa_cli_ak_candidates():
        if _probe_ak(base, cand):
            _remember_ak(base, cand)
            return cand
        if not probe:
            break

    print(
        "[ERROR] 未找到可用的 SANDBOX_ACCESS_KEY：\n"
        f"  当前平台地址（跟随 nuwa-cli 登录）：{base}\n"
        "  1) export SANDBOX_ACCESS_KEY=<平台签发的 AK>；或\n"
        "  2) 在 ~/.nuwa-cli/skill-env.json 的 \"aks\" 下按域名写入：\n"
        f'     {{"aks": {{"{base}": "ak-..."}}}}\n'
        "  说明：AK 按 (用户, 域名) 有效，跨环境不通用；nuwa-cli 登录态（savedKey）不是 4sandbox 的 AK。",
        file=sys.stderr,
    )
    sys.exit(2)


def _cached_ak(base: str) -> str:
    env = _load_json(SKILL_ENV_FILE)
    aks = env.get("aks") if isinstance(env.get("aks"), dict) else {}
    val = str(aks.get(base) or env.get("SANDBOX_ACCESS_KEY") or "").strip()
    return val


def _probe_ak(base: str, key: str) -> bool:
    url = f"{base}{REPO_PREFIX}/spaces"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {key}", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            payload = json.loads(resp.read() or b"{}")
        return str(payload.get("code", "")) == "0000"
    except Exception:
        return False


def _remember_ak(base: str, key: str) -> None:
    env = _load_json(SKILL_ENV_FILE)
    aks = env.get("aks") if isinstance(env.get("aks"), dict) else {}
    aks[base] = key
    env["aks"] = aks
    env.pop("SANDBOX_ACCESS_KEY", None)  # 迁移走旧的单值格式，避免串环境
    try:
        with open(SKILL_ENV_FILE, "w", encoding="utf-8") as f:
            json.dump(env, f, ensure_ascii=False, indent=2)
        os.chmod(SKILL_ENV_FILE, 0o600)
    except Exception:
        pass  # 缓存失败不影响本次运行


def require_env(name: str) -> str:
    val = os.environ.get(name, "").strip()
    if not val:
        print(f"[ERROR] 缺少环境变量 {name}（鉴权/地址契约见 SKILL.md）", file=sys.stderr)
        sys.exit(2)
    return val


def configure_stdio_utf8() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except AttributeError:
            pass


def ensure_ok(status: int, payload: dict) -> dict:
    """HTTP 200 且 code=="0000"（或 success!=False）才算过；否则按退出码约定终止。"""
    if status == 404:
        print("[ERROR] 端点不存在或资源不存在 (404)。核对路径与方法（references/）。", file=sys.stderr)
        sys.exit(3)
    if status != 200:
        print(f"[ERROR] HTTP {status}:", file=sys.stderr)
        print(json.dumps(payload, ensure_ascii=False, indent=2), file=sys.stderr)
        sys.exit(3)
    code = str(payload.get("code", ""))
    if (code and code != "0000") or payload.get("success") is False:
        msg = payload.get("message", "") or payload.get("error", "")
        print(f"[ERROR] 业务错误 (code={code}): {msg}", file=sys.stderr)
        print(json.dumps(payload, ensure_ascii=False, indent=2), file=sys.stderr)
        sys.exit(4)
    return payload


def data_of(payload: dict):
    """平台响应统一包 {code, message, data, success}；取 data（dict 原样、其余透传）。"""
    return payload.get("data")


def api_request(method: str, path: str, body: dict | None = None, prefix: str = REPO_PREFIX) -> tuple[int, dict]:
    base = resolve_platform_base()
    token = resolve_access_key()
    url = f"{base}{prefix}{path}"
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "Accept": "application/json; charset=utf-8",
            "Authorization": f"Bearer {token}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            raw = resp.read()
            charset = resp.headers.get_content_charset() or "utf-8"
            text = raw.decode(charset, errors="replace")
            return resp.status, (json.loads(text) if text else {})
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            payload = json.loads(raw.decode("utf-8"))
        except Exception:
            payload = {"message": raw.decode("utf-8", errors="replace")}
        return e.code, payload
    except urllib.error.URLError as e:
        print(f"[ERROR] 无法连接平台 {base}：{e.reason}", file=sys.stderr)
        sys.exit(3)


def api_ok(method: str, path: str, body: dict | None = None, prefix: str = REPO_PREFIX) -> dict:
    """api_request + ensure_ok，返回完整 payload（取 data 再过 data_of）。"""
    status, payload = api_request(method, path, body, prefix)
    return ensure_ok(status, payload)
