#!/usr/bin/env bash
# nuwa-cli S3 installer (macOS / Linux).
# Pulls from the public Nuwax bucket — no credentials, no aws-cli needed
# (just curl + node + npm). The bucket is public-read; we never touch secrets.
#
# One-liner:
#   curl -fsSL https://s3.nuwax.com:9443/nuwax-packages/agent-engines/nuwa-cli/install-from-s3.sh | bash
#
# Pin a channel:        NUWACLI_CHANNEL=beta   (default)
# Pin a version:        NUWACLI_VERSION=0.1.0-beta.3
# Use an npm mirror:    NUWACLI_REGISTRY=https://registry.npmmirror.com
# Self-signed endpoint: NUWAX_S3_INSECURE=1
set -euo pipefail

ENDPOINT="${NUWAX_S3_ENDPOINT:-https://s3.nuwax.com:9443}"
BUCKET="${NUWAX_S3_BUCKET:-nuwax-packages}"
PREFIX="${NUWAX_S3_PREFIX:-agent-engines/nuwa-cli}"
CHANNEL="${NUWACLI_CHANNEL:-beta}"
PINNED_VERSION="${NUWACLI_VERSION:-}"
INSECURE="${NUWAX_S3_INSECURE:-0}"

if [ -t 1 ]; then
  GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; CYAN=$'\033[36m'; NC=$'\033[0m'
else
  GREEN=""; YELLOW=""; RED=""; CYAN=""; NC=""
fi
ok()   { printf "%s[OK]%s %s\n" "$GREEN" "$NC" "$1"; }
warn() { printf "%s[!]%s  %s\n" "$YELLOW" "$NC" "$1" >&2; }
info() { printf "%s->%s %s\n" "$CYAN" "$NC" "$1"; }
fail() { printf "%s[X]%s  %s\n" "$RED" "$NC" "$1" >&2; exit 1; }

base="$ENDPOINT/$BUCKET/$PREFIX"

# Public GET with an automatic -k fallback for self-signed MinIO endpoints.
fetch() {
  local url="$1" dest="$2"
  local opts=(-fsSL)
  [[ "$INSECURE" == "1" ]] && opts+=(-k)
  if ! curl "${opts[@]}" -o "$dest" "$url"; then
    warn "下载失败(可能是自签证书),尝试忽略证书 (-k) 重试 ..."
    curl -fsSLk -o "$dest" "$url"
  fi
}

# --- Node check ---
command -v node >/dev/null 2>&1 || fail "未检测到 Node.js。请先安装 Node.js 22+: https://nodejs.org/"
NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)"
[ "$NODE_MAJOR" -ge 22 ] || fail "Node.js 版本过低 ($(node -v),需要 22+): https://nodejs.org/"
ok "Node.js $(node -v)"
command -v npm >/dev/null 2>&1 || fail "未检测到 npm。"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# --- Resolve version (channel pointer or pinned) ---
if [[ -n "$PINNED_VERSION" ]]; then
  VERSION="$PINNED_VERSION"
  ok "指定版本: $VERSION"
else
  info "解析 channel '$CHANNEL' ..."
  fetch "$base/channels/$CHANNEL.json" "$TMP/channel.json" || fail "无法读取 channel pointer: $base/channels/$CHANNEL.json"
  VERSION="$(node -p "require('$TMP/channel.json').version" 2>/dev/null || true)"
  [[ -n "$VERSION" ]] || fail "channel pointer 无 version 字段。已发布过 $CHANNEL 吗?"
  ok "channel '$CHANNEL' → $VERSION"
fi

# --- Download tarball ---
# @nuwax-ai/nuwa-cli → nuwax-ai-nuwa-cli (npm pack tarball naming)
PKG_NAME="@nuwax-ai/nuwa-cli"
PKG_BASE="${PKG_NAME#@}"; PKG_BASE="${PKG_BASE//\//-}"
TARBALL="$PKG_BASE-$VERSION.tgz"
info "下载 $TARBALL ..."
fetch "$base/versions/$VERSION/artifacts/$TARBALL" "$TMP/$TARBALL" || fail "tarball 下载失败: $base/versions/$VERSION/artifacts/$TARBALL"
ok "下载完成"

# --- npm install -g <tarball> (deps resolved via npm registry) ---
REGISTRY="${NUWACLI_REGISTRY:-}"
INSTALL_ARGS=(install -g "$TMP/$TARBALL")
[ -n "$REGISTRY" ] && INSTALL_ARGS+=(--registry "$REGISTRY")
info "npm install -g ...${REGISTRY:+ via $REGISTRY}"
if ! npm "${INSTALL_ARGS[@]}"; then
  fail "npm 安装失败。国内网络可设镜像重试: NUWACLI_REGISTRY=https://registry.npmmirror.com"
fi
ok "安装完成"

# --- PATH check / fix (npm global bin) ---
NPM_PREFIX="$(npm config get prefix 2>/dev/null || true)"
if   [ -d "$NPM_PREFIX/bin" ]; then NPM_BIN="$NPM_PREFIX/bin"
elif [ -d "$NPM_PREFIX" ];         then NPM_BIN="$NPM_PREFIX"
else                                NPM_BIN="$NPM_PREFIX/bin"; fi
ok "npm 全局 bin: $NPM_BIN"

path_has() { case ":$PATH:" in *":$1:"*) return 0 ;; *) return 1 ;; esac; }

if path_has "$NPM_BIN"; then
  ok "PATH 已包含 $NPM_BIN"
else
  warn "$NPM_BIN 不在当前 PATH 中"
  if [ -n "${ZSH_VERSION:-}" ]; then
    RC="${ZDOTDIR:-$HOME}/.zshrc"
  elif [ -n "${BASH_VERSION:-}" ]; then
    RC="$HOME/.bashrc"
    [ "$(uname)" = "Darwin" ] && [ -f "$HOME/.bash_profile" ] && RC="$HOME/.bash_profile"
  else
    case "$(basename "${SHELL:-/bin/sh}")" in
      zsh)  RC="${ZDOTDIR:-$HOME}/.zshrc" ;;
      bash) RC="$HOME/.bashrc" ;;
      *)    RC="$HOME/.profile" ;;
    esac
  fi
  touch "$RC" 2>/dev/null || RC="$HOME/.profile"
  if grep -qF "$NPM_BIN" "$RC" 2>/dev/null; then
    ok "$RC 已含 $NPM_BIN(重开终端或 source 即可)"
  else
    { printf '\n# nuwa-cli installer: add npm global bin to PATH\nexport PATH="%s:$PATH"\n' "$NPM_BIN"; } >> "$RC"
    ok "已写入 PATH 到 $RC"
  fi
  export PATH="$NPM_BIN:$PATH"
  warn "请重开终端(或 source \"$RC\")使 PATH 生效。"
fi

# --- Verify ---
if command -v nuwa-cli >/dev/null 2>&1; then
  ok "nuwa-cli 已就绪: $(nuwa-cli --version 2>/dev/null || echo installed)"
  printf '\n%s安装成功!运行 nuwa-cli -h 查看帮助。%s\n\n' "$GREEN" "$NC"
else
  warn "nuwa-cli 已安装,但当前 shell 未识别。请重开终端后运行: nuwa-cli -h"
fi
