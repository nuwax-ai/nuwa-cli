#!/usr/bin/env bash
# nuwa-cli S3 uninstaller (macOS / Linux).
#
# Stops services, removes the system service (launchd/systemd) if installed,
# npm-uninstalls the global package, and optionally purges ~/.nuwa-cli.
#
# One-liner:
#   curl -fsSL https://s3.nuwax.com:9443/nuwax-packages/agent-engines/nuwa-cli/uninstall-from-s3.sh | bash
#
# Also purge user data (credentials/sessions/logs/workspaces):
#   curl -fsSL https://s3.nuwax.com:9443/nuwax-packages/agent-engines/nuwa-cli/uninstall-from-s3.sh | NUWACLI_PURGE=1 bash
set -uo pipefail

GREEN=$'\033[32m'; YELLOW=$'\033[1;33m'; RED=$'\033[31m'; CYAN=$'\033[36m'; NC=$'\033[0m'
ok()   { printf "%s[OK]%s %s\n" "$GREEN" "$NC" "$1"; }
warn() { printf "%s[!]%s  %s\n" "$YELLOW" "$NC" "$1" >&2; }
info() { printf "%s->%s %s\n" "$CYAN" "$NC" "$1"; }
fail() { printf "%s[X]%s  %s\n" "$RED" "$NC" "$1" >&2; exit 1; }

PKG="@nuwax-ai/nuwa-cli"
LABEL="com.nuwax.nuwa-cli"
HOME_DIR="$HOME/.nuwa-cli"
PURGE="${NUWACLI_PURGE:-0}"

# --- 1) 系统服务卸载 + 停服务（CLI 可用时走它，task/plist/unit 名最准）---
if command -v nuwa-cli >/dev/null 2>&1; then
  info "移除系统服务（若有）并停止运行中的服务..."
  nuwa-cli service uninstall >/dev/null 2>&1 || true
  nuwa-cli stop >/dev/null 2>&1 || true
fi

# --- 2) 按名清理残留子进程（占端口/锁文件；CLI 不可用或残留时兜底）---
info "清理残留进程..."
for name in nuwax-lanproxy nuwax-file-server mcp-proxy; do
  pkill -f "$name" >/dev/null 2>&1 || true
done
pkill -f "dist/cli.js serve" >/dev/null 2>&1 || true
sleep 1

# --- 3) 系统服务文件兜底清理（CLI 未装/未清干净时）---
if command -v launchctl >/dev/null 2>&1; then
  PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
  launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
  [ -f "$PLIST" ] && rm -f "$PLIST"
elif command -v systemctl >/dev/null 2>&1; then
  systemctl --user disable --now "$LABEL.service" >/dev/null 2>&1 || true
  UNIT="$HOME/.config/systemd/user/$LABEL.service"
  [ -f "$UNIT" ] && rm -f "$UNIT"
fi

# --- 4) npm 卸载全局包 ---
info "npm uninstall -g $PKG ..."
npm uninstall -g "$PKG" || warn "npm uninstall 报错，继续校验..."

# --- 5) 校验 ---
if command -v nuwa-cli >/dev/null 2>&1; then
  fail "卸载校验失败：nuwa-cli 仍在 PATH 上。npm 卸载可能未生效，请手动：npm uninstall -g $PKG"
fi
ok "nuwa-cli 已卸载"

# --- 6) 用户数据（默认保留）---
if [ "$PURGE" = "1" ]; then
  info "NUWACLI_PURGE=1：删除用户数据 $HOME_DIR"
  rm -rf "$HOME_DIR" 2>/dev/null || warn "部分文件未能删除（可能被占用），请稍后重试：rm -rf \"$HOME_DIR\""
  ok "已清理 $HOME_DIR"
else
  warn "用户数据保留在 $HOME_DIR（凭证/会话/日志/工作空间）。彻底清除：NUWACLI_PURGE=1 重跑，或 rm -rf \"$HOME_DIR\""
fi

printf '\n%s卸载完成。%s\n' "$GREEN" "$NC"
