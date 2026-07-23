#!/usr/bin/env bash
# nuwa-cli one-line installer for macOS / Linux.
# Usage:  curl -fsSL https://raw.githubusercontent.com/nuwax-ai/nuwa-cli/main/scripts/install.sh | bash
# Runs `npm install -g` and ensures the npm global bin dir is on PATH
# (appended to the relevant shell rc file) so `nuwa-cli` is immediately
# callable in new terminals (no manual env editing).

set -euo pipefail

PACKAGE="@nuwax-ai/nuwa-cli"
TAG="${NUWACLI_TAG:-beta}"

if [ -t 1 ]; then
  GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; CYAN=$'\033[36m'; NC=$'\033[0m'
else
  GREEN=""; YELLOW=""; RED=""; CYAN=""; NC=""
fi

ok()   { printf "%s[OK]%s %s\n" "$GREEN" "$NC" "$1"; }
warn() { printf "%s[!]%s  %s\n" "$YELLOW" "$NC" "$1" >&2; }
info() { printf "%s->%s %s\n" "$CYAN" "$NC" "$1"; }
fail() { printf "%s[X]%s  %s\n" "$RED" "$NC" "$1" >&2; exit 1; }

# --- Node/npm check ---
command -v node >/dev/null 2>&1 || fail "未检测到 Node.js。请先安装 Node.js 22+: https://nodejs.org/"
NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)"
[ "$NODE_MAJOR" -ge 22 ] || fail "Node.js 版本过低 (当前 $(node -v),需要 22+): https://nodejs.org/"
ok "Node.js $(node -v)"

command -v npm >/dev/null 2>&1 || fail "未检测到 npm。请用 Node.js 官方安装器: https://nodejs.org/"

# --- Install ---
REGISTRY="${NUWACLI_REGISTRY:-}"
INSTALL_ARGS=(install -g "${PACKAGE}@${TAG}")
[ -n "$REGISTRY" ] && INSTALL_ARGS+=(--registry "$REGISTRY")
info "安装 ${PACKAGE}@${TAG}${REGISTRY:+ via $REGISTRY} ..."
if ! npm "${INSTALL_ARGS[@]}"; then
  fail "npm 安装失败。$( [ "$(id -u)" -ne 0 ] && echo "权限不足可加 sudo,或 npm config set prefix ~/.npm-global; " )国内网络可设镜像重试: NUWACLI_REGISTRY=https://registry.npmmirror.com"
fi
ok "安装完成"

# --- Resolve npm global bin directory ---
PREFIX="$(npm config get prefix 2>/dev/null || true)"
[ -n "$PREFIX" ] || fail "无法获取 npm 全局目录 (npm config get prefix)。"
# npm prefix is usually the install root; the shims live in $PREFIX/bin.
# (nvm/volta expose bin directly under the version prefix too, covered below.)
if   [ -d "$PREFIX/bin" ]; then NPM_BIN="$PREFIX/bin"
elif [ -d "$PREFIX" ];         then NPM_BIN="$PREFIX"
else                            NPM_BIN="$PREFIX/bin"; fi
ok "npm 全局 bin: $NPM_BIN"

# --- PATH check ---
path_has() {
  case ":$PATH:" in
    *":$1:"*) return 0 ;;
    *)        return 1 ;;
  esac
}

if path_has "$NPM_BIN"; then
  ok "PATH 已包含 $NPM_BIN"
else
  warn "$NPM_BIN 不在当前 PATH 中"

  # Pick the most appropriate shell rc file.
  if [ -n "${ZSH_VERSION:-}" ]; then
    RC="${ZDOTDIR:-$HOME}/.zshrc"
  elif [ -n "${BASH_VERSION:-}" ]; then
    RC="$HOME/.bashrc"
    # macOS login shells read .bash_profile in preference to .bashrc.
    if [ "$(uname)" = "Darwin" ] && [ -f "$HOME/.bash_profile" ]; then
      RC="$HOME/.bash_profile"
    fi
  else
    case "$(basename "${SHELL:-/bin/sh}")" in
      zsh)  RC="${ZDOTDIR:-$HOME}/.zshrc" ;;
      bash) RC="$HOME/.bashrc" ;;
      *)    RC="$HOME/.profile" ;;
    esac
  fi

  touch "$RC" 2>/dev/null || RC="$HOME/.profile"

  if grep -qF "$NPM_BIN" "$RC" 2>/dev/null; then
    ok "$RC 已含 $NPM_BIN(重开终端或执行 source $RC 即可)"
  else
    # idempotent: marker lets future runs detect we already wrote this.
    {
      printf '\n# nuwa-cli installer: add npm global bin to PATH\n'
      printf 'export PATH="%s:$PATH"\n' "$NPM_BIN"
    } >> "$RC"
    ok "已写入 PATH 到 $RC"
  fi

  # Make it work in this session too (best-effort).
  export PATH="$NPM_BIN:$PATH"
  warn "请重开终端(或执行: source \"$RC\")使 PATH 生效。"
fi

# --- Verify ---
if command -v nuwa-cli >/dev/null 2>&1; then
  ok "nuwa-cli 已就绪: $(nuwa-cli --version 2>/dev/null || echo installed)"
  printf '\n%s安装成功!运行 nuwa-cli -h 查看帮助。%s\n\n' "$GREEN" "$NC"
else
  warn "nuwa-cli 已安装,但当前 shell 未识别。请重开终端后运行: nuwa-cli -h"
fi
