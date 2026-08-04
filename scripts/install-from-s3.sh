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
# Override npm registry: NUWACLI_REGISTRY=https://registry.npmjs.org
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
step() { printf "%s[%s/%s]%s %s\n" "$CYAN" "$1" "$2" "$NC" "$3"; }
fail() { printf "%s[X]%s  %s\n" "$RED" "$NC" "$1" >&2; exit 1; }

progress_bar() {
  local percent="$1" label="$2" width=30 filled empty bar
  if [ ! -t 1 ] && [ "${LAST_PROGRESS_PERCENT:-}" = "$percent" ]; then return; fi
  LAST_PROGRESS_PERCENT="$percent"
  filled=$((percent * width / 100))
  empty=$((width - filled))
  printf -v bar '%*s' "$filled" ''
  bar="${bar// /#}"
  printf -v empty '%*s' "$empty" ''
  if [ -t 1 ]; then
    printf '\r[%s%s] %3d%% %s' "$bar" "$empty" "$percent" "$label"
  else
    printf '[%s%s] %3d%% %s\n' "$bar" "$empty" "$percent" "$label"
  fi
}

run_npm_with_progress() {
  local start_percent="$1"; shift
  local log_file started pid elapsed percent status
  log_file="$TMP/npm-install.log"
  started=$SECONDS
  npm "$@" >"$log_file" 2>&1 &
  pid=$!

  while kill -0 "$pid" 2>/dev/null; do
    elapsed=$((SECONDS - started))
    percent=$((start_percent + (95 - start_percent) * elapsed / (elapsed + 20)))
    progress_bar "$percent" "正在下载并安装依赖（估算）"
    sleep 0.5
  done

  if wait "$pid"; then status=0; else status=$?; fi
  progress_bar 100 "依赖安装完成"
  printf '\n'
  if [ "$status" -ne 0 ]; then
    cat "$log_file" >&2
  fi
  return "$status"
}

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

# --- 升级检测（安装前 nuwa-cli 是否已存在），用于升级后自动重启 serve ---
WAS_INSTALLED=0
command -v nuwa-cli >/dev/null 2>&1 && WAS_INSTALLED=1

# --- Node check ---
step 1 4 "检查 Node.js 并解析发布版本 ..."
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

# --- Skip if already at target version ---
SKIP_INSTALL=0
if [ "$WAS_INSTALLED" = "1" ] && command -v nuwa-cli >/dev/null 2>&1; then
  INSTALLED_VERSION="$(nuwa-cli --version 2>/dev/null | head -1 || true)"
  if [ "$INSTALLED_VERSION" = "$VERSION" ]; then
    ok "nuwa-cli $VERSION 已安装，跳过。"
    SKIP_INSTALL=1
  fi
fi

# --- Download tarball ---
if [ "$SKIP_INSTALL" = "0" ]; then
# @nuwax-ai/nuwa-cli → nuwax-ai-nuwa-cli (npm pack tarball naming)
PKG_NAME="@nuwax-ai/nuwa-cli"
PKG_BASE="${PKG_NAME#@}"; PKG_BASE="${PKG_BASE//\//-}"
TARBALL="$PKG_BASE-$VERSION.tgz"
step 2 4 "下载 $TARBALL ..."
fetch "$base/versions/$VERSION/artifacts/$TARBALL" "$TMP/$TARBALL" || fail "tarball 下载失败: $base/versions/$VERSION/artifacts/$TARBALL"
ok "下载完成"

# Stop running lanproxy so its binary isn't locked (npm EPERM on Windows).
if [ "$(uname -s 2>/dev/null)" != "Darwin" ] && command -v taskkill >/dev/null 2>&1; then
  taskkill //F //IM nuwax-lanproxy.exe >/dev/null 2>&1 || true
fi

# --- npm install -g <tarball> (deps resolved via npm registry) ---
REGISTRY="${NUWACLI_REGISTRY:-https://registry.npmmirror.com}"
INSTALL_ARGS=(install -g "$TMP/$TARBALL" --progress=true)
[ -n "$REGISTRY" ] && INSTALL_ARGS+=(--registry "$REGISTRY")
step 3 4 "安装 nuwa-cli 与引擎依赖${REGISTRY:+ via $REGISTRY} ..."
info "首次安装会下载较大的平台依赖，npm 将在下方持续显示活动。"
INSTALL_STARTED=$SECONDS
if ! run_npm_with_progress 55 "${INSTALL_ARGS[@]}"; then
  fail "npm 安装失败。可切换官方源重试: NUWACLI_REGISTRY=https://registry.npmjs.org"
fi
ok "依赖安装完成，耗时 $((SECONDS - INSTALL_STARTED)) 秒"

# --- PATH check / fix (npm global bin) ---
step 4 4 "配置 PATH 并验证 nuwa-cli ..."
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
  VER="$(nuwa-cli --version 2>/dev/null | head -1 | tr -d '[:space:]' || true)"
  # 实际尝试了安装（非跳过）时，要求结果版本 == 目标。npm 偶发失败却退出 0，
  # 否则会留下旧版本并打印假的「安装成功」。
  if [ "$SKIP_INSTALL" = "0" ]; then
    if [ -z "$VER" ]; then
      fail "安装校验失败：nuwa-cli 存在但 nuwa-cli --version 无输出，npm 安装未完成。请重跑安装脚本，或手动：npm i -g @nuwax-ai/nuwa-cli@$CHANNEL"
    elif [ "$VER" != "$VERSION" ]; then
      fail "安装校验失败：期望 nuwa-cli $VERSION，实际 $VER（仍为旧版本）。npm 安装未完成。请重跑安装脚本，或手动：npm i -g @nuwax-ai/nuwa-cli@$CHANNEL"
    fi
  fi
  ok "nuwa-cli 已就绪: ${VER:-installed}"
  printf '\n%s安装成功!运行 nuwa-cli -h 查看帮助。%s\n\n' "$GREEN" "$NC"
else
  warn "nuwa-cli 已安装,但当前 shell 未识别。请重开终端后运行: nuwa-cli -h"
fi

# --- 升级后静默后台重启 serve（已登录时；未登录跳过）---
if [ "$WAS_INSTALLED" = "1" ] && command -v nuwa-cli >/dev/null 2>&1; then
  CRED="$HOME/.nuwa-cli/credentials.json"
  LOGGED_IN=0
  if [ -f "$CRED" ] && node -e "const c=require('$CRED');process.exit(c.configKey?0:1)" 2>/dev/null; then
    LOGGED_IN=1
  fi
  if [ "$LOGGED_IN" = "1" ]; then
    info "已登录，正在后台重启 nuwa-cli serve（升级后）..."
    # 与 `nuwa-cli restart` 同逻辑：清理 serve/console/tunnel 子服务后强制重启 Gateway
    # daemon。不要在 restart 未结束时再套 start --force retry（会杀掉刚起的 lanproxy）。
    # 脚本重试前请先 `nuwa-cli status` 确认 Gateway+lanproxy 是否已就绪。
    if nuwa-cli restart 2>&1; then
      ok "已后台重启 nuwa-cli serve"
    else
      warn "serve 自动重启失败（可手动: nuwa-cli restart）"
    fi
  else
    info "未登录 Nuwax，跳过 serve 自动重启。"
  fi
fi
fi # end if [ "$SKIP_INSTALL" = "0" ]
