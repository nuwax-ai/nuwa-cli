#!/usr/bin/env bash
# install-skill.sh — 从 Nuwax S3 (MinIO) 一键安装 skill 到本机技能目录。
#
# 用法:
#   bash install-skill.sh [skillName] [--version 0.1.0] [--target <dir>] [--force] [--no-bundle]
#   skillName 缺省 nuwa-cli-usage（套件总入口，自动随装其关联 skill）
#   套件关联: 装 nuwa-cli-usage 时自动随装 nuwax-platform-access（--no-bundle 关闭）
#   --target  缺省 $NUWAX_SKILLS_DIR，再缺省 $HOME/.nuwa-cli/skills
#             （装到某 agent 的 store: --target ~/.nuwa-cli/workspaces/<user>/.agent-store/<agentId>/skills）
#
# 公开读桶，无需任何凭证、无需 aws-cli。流程：latest.json 定版 → 下载 zip+sha256 → 校验 → 解压落盘。
# 重装/升级直接重跑；--force 跳过「同版本已装」跳过逻辑。

set -euo pipefail

# 套件入口 → 随装列表（总入口 skill 安装时连带安装，保持「一套能力一次装齐」）
declare -a BUNDLE_WITH_DEFAULT=(nuwax-platform-access)

SKILL_NAME="nuwa-cli-usage"
VERSION=""
TARGET="${NUWAX_SKILLS_DIR:-$HOME/.nuwa-cli/skills}"
FORCE=0
NO_BUNDLE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --target) TARGET="$2"; shift 2 ;;
    --force) FORCE=1; shift ;;
    --no-bundle) NO_BUNDLE=1; shift ;;
    -h|--help) echo "用法: $0 [skillName] [--version v] [--target dir] [--force] [--no-bundle]"; exit 0 ;;
    *) SKILL_NAME="$1"; shift ;;
  esac
done

ENDPOINT="${NUWAX_S3_ENDPOINT:-https://s3.nuwax.com:9443}"
BUCKET="${NUWAX_S3_BUCKET:-nuwax-packages}"
PREFIX="${NUWAX_S3_SKILL_PREFIX:-agent-engines/nuwa-cli/skills}"
INSECURE="${NUWAX_S3_INSECURE:-0}"

CURL=(curl -fsSL)
if [[ "$INSECURE" == "1" ]]; then CURL+=(--insecure); fi
fetch() { "${CURL[@]}" "$@"; }
fetch_try_insecure_on_tls_fail() {
  "${CURL[@]}" "$@" 2>/dev/null || { echo "[WARN] TLS 失败，降级 -k 重试" >&2; "${CURL[@]}" --insecure "$@"; }
}

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

install_one() {  # install_one <skillName> [version]
  local NAME="$1" VER="${2:-}"
  local PUBLIC="$ENDPOINT/$BUCKET/$PREFIX/$NAME"

  # 1) 定版本
  if [[ -z "$VER" ]]; then
    VER=$(fetch "$PUBLIC/latest.json" 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])') \
      || { echo "[ERROR] 无法解析 $PUBLIC/latest.json（检查网络或域名）" >&2; return 3; }
  fi
  local ARTIFACT="$NAME-$VER.zip"
  local ART_URL="$PUBLIC/versions/$VER/artifacts/$ARTIFACT"
  echo "[INFO] 安装 $NAME@$VER ← $ART_URL"

  # 2) 同版本已装检查
  if [[ "$FORCE" -ne 1 && -f "$TARGET/$NAME/.installed" ]]; then
    local INSTALLED
    INSTALLED=$(cat "$TARGET/$NAME/.installed" 2>/dev/null || true)
    if [[ "$INSTALLED" == "$VER" ]]; then
      echo "[OK] 同版本 $NAME@$VER 已安装于 ${TARGET}/${NAME}（--force 重装）"
      return 0
    fi
  fi

  # 3) 下载 + 校验
  fetch_try_insecure_on_tls_fail "$ART_URL" -o "$STAGE/$ARTIFACT"
  local EXPECTED ACTUAL
  EXPECTED=$(fetch_try_insecure_on_tls_fail "$ART_URL.sha256" | awk '{print $1}')
  ACTUAL=$(shasum -a 256 "$STAGE/$ARTIFACT" | awk '{print $1}')
  [[ "$EXPECTED" == "$ACTUAL" ]] || { echo "[ERROR] sha256 不一致: 期望 $EXPECTED 实得 $ACTUAL" >&2; return 4; }
  echo "[OK] sha256 校验通过 ($ACTUAL)"

  # 4) 落盘（原子：先解到临时再 mv 覆盖；兼容带/不带顶层目录两种 zip 布局）
  mkdir -p "$TARGET"
  local WORK="$STAGE/work-$NAME"
  mkdir -p "$WORK"
  ( cd "$WORK" && unzip -qo "$STAGE/$ARTIFACT" )
  if [[ ! -d "$WORK/$NAME" && -f "$WORK/SKILL.md" ]]; then
    mkdir -p "$WORK/$NAME"
    while IFS= read -r f; do mv "$f" "$WORK/$NAME/"; done < <(find "$WORK" -mindepth 1 -maxdepth 1 ! -name "$NAME")
  fi
  if [[ -d "$TARGET/$NAME" ]]; then
    rm -rf "$TARGET/$NAME.bak"
    mv "$TARGET/$NAME" "$TARGET/$NAME.bak"
  fi
  mv "$WORK/$NAME" "$TARGET/$NAME"
  echo "$VER" > "$TARGET/$NAME/.installed"
  [[ -d "$TARGET/$NAME.bak" ]] && rm -rf "$TARGET/$NAME.bak"

  echo "[OK] 已安装 $NAME@$VER → $TARGET/$NAME"
  # 注意：不能写 `[[ -f ]] && echo` 收尾——测试为假时函数返回 1，set -e 会中止脚本且跳过 bundle 随装
  if [[ -f "$TARGET/$NAME/SKILL.md" ]]; then echo "[INFO] 入口: $TARGET/$NAME/SKILL.md"; fi
}

install_one "$SKILL_NAME" "$VERSION"

# 套件随装：总入口 skill 带关联 skill 一起装齐
if [[ "$NO_BUNDLE" -ne 1 && "$SKILL_NAME" == "nuwa-cli-usage" ]]; then
  for dep in "${BUNDLE_WITH_DEFAULT[@]}"; do
    echo "[INFO] 套件随装: $dep"
    install_one "$dep"
  done
fi
