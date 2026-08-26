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
  log_file="$(mktemp)"
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
  rm -f "$log_file"
  return "$status"
}

# --- Node/npm check ---
step 1 3 "检查 Node.js 与 npm ..."
command -v node >/dev/null 2>&1 || fail "未检测到 Node.js。请先安装 Node.js 22+: https://nodejs.org/"
NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)"
[ "$NODE_MAJOR" -ge 22 ] || fail "Node.js 版本过低 (当前 $(node -v),需要 22+): https://nodejs.org/"
ok "Node.js $(node -v)"

command -v npm >/dev/null 2>&1 || fail "未检测到 npm。请用 Node.js 官方安装器: https://nodejs.org/"

# --- Resolve target version & skip if already current ---
# 与 `nuwa-cli update` / S3 安装器同口径：CLI 版本已等于目标则不重跑 npm install
#（exact pin 下同版本 ⇒ 核心依赖也不会变）。
REGISTRY="${NUWACLI_REGISTRY:-}"
VIEW_ARGS=(view "${PACKAGE}@${TAG}" version)
[ -n "$REGISTRY" ] && VIEW_ARGS+=(--registry "$REGISTRY")
TARGET_VERSION="$(npm "${VIEW_ARGS[@]}" 2>/dev/null | head -1 | tr -d '[:space:]' || true)"
[ -n "$TARGET_VERSION" ] || fail "无法解析 ${PACKAGE}@${TAG} 的远端版本。检查网络或 NUWACLI_REGISTRY。"
ok "目标版本: ${PACKAGE}@${TAG} → ${TARGET_VERSION}"

SKIP_INSTALL=0
if command -v nuwa-cli >/dev/null 2>&1; then
  INSTALLED_VERSION="$(nuwa-cli --version 2>/dev/null | head -1 | tr -d '[:space:]' || true)"
  if [ -n "$INSTALLED_VERSION" ] && [ "$INSTALLED_VERSION" = "$TARGET_VERSION" ]; then
    ok "nuwa-cli $TARGET_VERSION 已安装，跳过 npm install。"
    SKIP_INSTALL=1
  fi
fi

# --- Install (skipped when already at target) ---
if [ "$SKIP_INSTALL" = "0" ]; then
# Align with `nuwa-cli update` / install.ps1: stop runtime before overlaying
# the global package (best-effort; ignore failures on first install).
if command -v nuwa-cli >/dev/null 2>&1; then
  info "升级前停止运行中的 nuwa-cli 服务（best-effort）..."
  nuwa-cli stop --all >/dev/null 2>&1 || true
fi
INSTALL_ARGS=(install -g "${PACKAGE}@${TAG}" --progress=true)
[ -n "$REGISTRY" ] && INSTALL_ARGS+=(--registry "$REGISTRY")
step 2 3 "安装 ${PACKAGE}@${TAG}${REGISTRY:+ via $REGISTRY} ..."
info "正在下载并解压引擎依赖，首次安装可能需要几分钟。"
INSTALL_STARTED=$SECONDS
if ! run_npm_with_progress 35 "${INSTALL_ARGS[@]}"; then
  fail "npm 安装失败。$( [ "$(id -u)" -ne 0 ] && echo "权限不足可加 sudo,或 npm config set prefix ~/.npm-global; " )国内网络可设镜像重试: NUWACLI_REGISTRY=https://registry.npmmirror.com"
fi
ok "依赖安装完成，耗时 $((SECONDS - INSTALL_STARTED)) 秒"
fi

# --- Resolve npm global bin directory ---
step 3 3 "配置 PATH 并验证 nuwa-cli ..."
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
  VER="$(nuwa-cli --version 2>/dev/null | head -1 | tr -d '[:space:]' || true)"
  # 实际安装过时，要求结果版本 == 目标（防 npm 假成功留下旧版）。
  if [ "$SKIP_INSTALL" = "0" ]; then
    if [ -z "$VER" ]; then
      fail "安装校验失败：nuwa-cli 存在但 --version 无输出。请重跑安装脚本，或手动：npm i -g ${PACKAGE}@${TAG}"
    elif [ "$VER" != "$TARGET_VERSION" ]; then
      fail "安装校验失败：期望 nuwa-cli $TARGET_VERSION，实际 $VER。请重跑安装脚本，或手动：npm i -g ${PACKAGE}@${TAG}"
    fi
  fi
  ok "nuwa-cli 已就绪: ${VER:-installed}"
  printf '\n%s安装成功!运行 nuwa-cli -h 查看帮助。%s\n\n' "$GREEN" "$NC"
else
  warn "nuwa-cli 已安装,但当前 shell 未识别。请重开终端后运行: nuwa-cli -h"
fi
