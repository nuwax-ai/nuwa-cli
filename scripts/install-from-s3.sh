#!/usr/bin/env bash
# nuwa-cli S3 installer (macOS / Linux).
# Pulls from the public Nuwax bucket — no credentials, no aws-cli needed
# (just curl + node + npm). The bucket is public-read; we never touch secrets.
#
# Product split (align with `nuwa-cli install` / `nuwa-cli update`):
#   - Not installed → download tarball → npm i -g → PATH →
#       `nuwa-cli install --yes --bootstrap` (silent login/start)
#   - Installed, different version → `nuwa-cli update <VERSION> --yes`
#       (update kernel: stop/locks/incremental + logged-in restart)
#   - Same version → skip (no restart, no bootstrap)
#
# One-liner:
#   curl -fsSL https://s3.nuwax.com:9443/nuwax-packages/agent-engines/nuwa-cli/install-from-s3.sh | bash
#
# Pin a channel:        NUWACLI_CHANNEL=stable (default) / beta
# Pin a version:        NUWACLI_VERSION=0.1.0-beta.3
# Override npm registry: NUWACLI_REGISTRY=https://registry.npmjs.org
# Self-signed endpoint: NUWAX_S3_INSECURE=1
# Skip bootstrap start: NUWACLI_NO_START=1
set -euo pipefail

ENDPOINT="${NUWAX_S3_ENDPOINT:-https://s3.nuwax.com:9443}"
BUCKET="${NUWAX_S3_BUCKET:-nuwax-packages}"
PREFIX="${NUWAX_S3_PREFIX:-agent-engines/nuwa-cli}"
CHANNEL="${NUWACLI_CHANNEL:-stable}"
PINNED_VERSION="${NUWACLI_VERSION:-}"
INSECURE="${NUWAX_S3_INSECURE:-0}"
NO_START="${NUWACLI_NO_START:-0}"

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

# Resolve an absolute path to the nuwa-cli bin for the current session
# (PATH may not yet include npm global bin on a fresh install).
resolve_nuwa_cli() {
  if command -v nuwa-cli >/dev/null 2>&1; then
    command -v nuwa-cli
    return 0
  fi
  local prefix bin
  prefix="$(npm config get prefix 2>/dev/null || true)"
  [ -n "$prefix" ] || return 1
  for bin in "$prefix/bin/nuwa-cli" "$prefix/nuwa-cli"; do
    if [ -x "$bin" ]; then
      printf '%s\n' "$bin"
      return 0
    fi
  done
  return 1
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

# --- Node check ---
step 1 4 "检查 Node.js 并解析发布版本 ..."
command -v node >/dev/null 2>&1 || fail "未检测到 Node.js。请先安装 Node.js 22+: https://nodejs.org/"
NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)"
[ "$NODE_MAJOR" -ge 22 ] || fail "Node.js 版本过低 ($(node -v),需要 22+): https://nodejs.org/"
ok "Node.js $(node -v)"
command -v npm >/dev/null 2>&1 || fail "未检测到 npm。"

# --- Detect whether nuwa-cli is already globally installed (not just visible on PATH) ---
WAS_INSTALLED=0
NUWA_BIN_PRE="$(resolve_nuwa_cli || true)"
[ -n "$NUWA_BIN_PRE" ] && WAS_INSTALLED=1

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

# --- Same version: skip entirely (no restart, no bootstrap) ---
if [ "$WAS_INSTALLED" = "1" ]; then
  INSTALLED_VERSION="$("$NUWA_BIN_PRE" --version 2>/dev/null | head -1 | tr -d '[:space:]' || true)"
  if [ "$INSTALLED_VERSION" = "$VERSION" ]; then
    ok "nuwa-cli $VERSION 已安装，跳过。"
    info "日常升级请用: nuwa-cli update"
    exit 0
  fi
fi

# --- Upgrade path: already installed, different version → update kernel ---
# Do NOT tarball-overlay here: stop/locks/incremental + logged-in restart live
# inside `nuwa-cli update`. Pin the S3-resolved semver so npm matches the channel.
if [ "$WAS_INSTALLED" = "1" ]; then
  NUWA_BIN="$NUWA_BIN_PRE"
  step 2 2 "已安装 → 走 nuwa-cli update $VERSION --yes ..."
  info "升级请用 update 内核（停服 / Windows 释锁 / 增量）；勿裸 npm i -g。"
  set +e
  UPDATE_OUT="$("$NUWA_BIN" update "$VERSION" --yes 2>&1)"
  UPDATE_RC=$?
  set -e
  printf '%s\n' "$UPDATE_OUT"
  if [ "$UPDATE_RC" -ne 0 ]; then
    fail "nuwa-cli update 失败（exit $UPDATE_RC）。可手动重试: nuwa-cli update $VERSION --yes"
  fi
  ok "升级完成（已登录时 update 会 restart Gateway）"
  # Logged-in restart is owned by update — do not call install --bootstrap
  # (would double-touch the stack). Unlogged: optional silent bootstrap only
  # prints how to finish login (no start under --yes without credentials).
  CRED="$HOME/.nuwa-cli/credentials.json"
  LOGGED_IN=0
  if [ -f "$CRED" ] && node -e "const c=require('$CRED');process.exit(c.configKey?0:1)" 2>/dev/null; then
    LOGGED_IN=1
  fi
  if [ "$LOGGED_IN" = "0" ] && [ "$NO_START" != "1" ]; then
    info "未登录：静默提示收尾（不自动 start）..."
    "$NUWA_BIN" install --yes --bootstrap || true
  fi
  exit 0
fi

# --- New install: download tarball → npm i -g → PATH → install --bootstrap ---
PKG_NAME="@nuwax-ai/nuwa-cli"
PKG_BASE="${PKG_NAME#@}"; PKG_BASE="${PKG_BASE//\//-}"
TARBALL="$PKG_BASE-$VERSION.tgz"
step 2 4 "下载 $TARBALL ..."
fetch "$base/versions/$VERSION/artifacts/$TARBALL" "$TMP/$TARBALL" || fail "tarball 下载失败: $base/versions/$VERSION/artifacts/$TARBALL"
ok "下载完成"

# Windows Git Bash：兜底杀可能锁住 npm 覆盖的 vendor 二进制（新装通常无进程）。
if [ "$(uname -s 2>/dev/null)" != "Darwin" ] && command -v taskkill >/dev/null 2>&1; then
  stuck=""
  for _attempt in 1 2 3; do
    taskkill //F //IM nuwax-codex.exe >/dev/null 2>&1 || true
    taskkill //F //IM nuwax-lanproxy.exe >/dev/null 2>&1 || true
    sleep 1
    stuck=""
    for image in nuwax-codex.exe nuwax-lanproxy.exe; do
      if tasklist //FI "IMAGENAME eq ${image}" //NH 2>/dev/null | grep -qi "$image"; then
        stuck="${stuck}${stuck:+ }${image}"
      fi
    done
    [ -z "$stuck" ] && break
  done
  if [ -n "$stuck" ]; then
    fail "无法安装：仍在运行 $stuck。请先: taskkill //F //IM nuwax-lanproxy.exe 与 nuwax-codex.exe；然后重试。"
  fi
fi

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

NUWA_BIN="$(resolve_nuwa_cli)" || fail "nuwa-cli 已安装,但当前 shell 未识别。请重开终端后运行: nuwa-cli -h"
VER="$("$NUWA_BIN" --version 2>/dev/null | head -1 | tr -d '[:space:]' || true)"
if [ -z "$VER" ]; then
  fail "安装校验失败：nuwa-cli 存在但 --version 无输出。请重跑安装脚本，或手动：npm i -g @nuwax-ai/nuwa-cli@$CHANNEL"
elif [ "$VER" != "$VERSION" ]; then
  fail "安装校验失败：期望 nuwa-cli $VERSION，实际 $VER。请重跑安装脚本。"
fi
ok "nuwa-cli 已就绪: $VER"
printf '\n%s安装成功!%s\n\n' "$GREEN" "$NC"

# Silent product tail: same bootstrap as npx install --yes
if [ "$NO_START" = "1" ]; then
  info "NUWACLI_NO_START=1：跳过 login/start。下一步: nuwa-cli login && nuwa-cli start"
  exit 0
fi
info "继续静默收尾: install --yes --bootstrap ..."
set +e
"$NUWA_BIN" install --yes --bootstrap
BOOT_RC=$?
set -e
if [ "$BOOT_RC" -ne 0 ]; then
  warn "bootstrap 未完成（exit $BOOT_RC）。若未登录，请手动: nuwa-cli login && nuwa-cli start"
fi
