#!/usr/bin/env bash
# install-skill.sh — 从 Nuwax S3 (MinIO) 一键安装 skill 到本机技能目录。
#
# 用法:
#   bash install-skill.sh [skillName] [--version 0.1.0] [--target <dir>] [--force]
#   skillName 缺省 nuwax-platform-access
#   --target  缺省 $NUWAX_SKILLS_DIR，再缺省 $HOME/.nuwa-cli/skills
#             （装到某 agent 的 store: --target ~/.nuwa-cli/workspaces/<user>/.agent-store/<agentId>/skills）
#
# 公开读桶，无需任何凭证、无需 aws-cli。流程：latest.json 定版 → 下载 zip+sha256 → 校验 → 解压落盘。
# 重装/升级直接重跑；--force 跳过「同版本已装」跳过逻辑。

set -euo pipefail

SKILL_NAME="nuwax-platform-access"
VERSION=""
TARGET="${NUWAX_SKILLS_DIR:-$HOME/.nuwa-cli/skills}"
FORCE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --target) TARGET="$2"; shift 2 ;;
    --force) FORCE=1; shift ;;
    -h|--help) echo "用法: $0 [skillName] [--version v] [--target dir] [--force]"; exit 0 ;;
    *) SKILL_NAME="$1"; shift ;;
  esac
done

ENDPOINT="${NUWAX_S3_ENDPOINT:-https://s3.nuwax.com:9443}"
BUCKET="${NUWAX_S3_BUCKET:-nuwax-packages}"
PREFIX="${NUWAX_S3_SKILL_PREFIX:-agent-engines/nuwa-cli/skills}"
INSECURE="${NUWAX_S3_INSECURE:-0}"
PUBLIC="$ENDPOINT/$BUCKET/$PREFIX/$SKILL_NAME"

CURL=(curl -fsSL)
if [[ "$INSECURE" == "1" ]]; then CURL+=(--insecure); fi
fetch() { "${CURL[@]}" "$@"; }
fetch_try_insecure_on_tls_fail() {
  "${CURL[@]}" "$@" 2>/dev/null || { echo "[WARN] TLS 失败，降级 -k 重试" >&2; "${CURL[@]}" --insecure "$@"; }
}

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# 1) 定版本
if [[ -z "$VERSION" ]]; then
  VERSION=$(fetch "$PUBLIC/latest.json" 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])') \
    || { echo "[ERROR] 无法解析 $PUBLIC/latest.json（检查网络或域名）" >&2; exit 3; }
fi
ARTIFACT="$SKILL_NAME-$VERSION.zip"
ART_URL="$PUBLIC/versions/$VERSION/artifacts/$ARTIFACT"
echo "[INFO] 安装 $SKILL_NAME@$VERSION ← $ART_URL"

# 2) 同版本已装检查
if [[ "$FORCE" -ne 1 && -f "$TARGET/$SKILL_NAME/.installed" ]]; then
  INSTALLED=$(cat "$TARGET/$SKILL_NAME/.installed" 2>/dev/null || true)
  if [[ "$INSTALLED" == "$VERSION" ]]; then
    echo "[OK] 同版本 $VERSION 已安装于 ${TARGET}/${SKILL_NAME}（--force 重装）"
    exit 0
  fi
fi

# 3) 下载 + 校验
fetch_try_insecure_on_tls_fail "$ART_URL" -o "$STAGE/$ARTIFACT"
EXPECTED=$(fetch_try_insecure_on_tls_fail "$ART_URL.sha256" | awk '{print $1}')
ACTUAL=$(shasum -a 256 "$STAGE/$ARTIFACT" | awk '{print $1}')
[[ "$EXPECTED" == "$ACTUAL" ]] || { echo "[ERROR] sha256 不一致: 期望 $EXPECTED 实得 $ACTUAL" >&2; exit 4; }
echo "[OK] sha256 校验通过 ($ACTUAL)"

# 4) 落盘（原子：先解到临时再 mv 覆盖；兼容带/不带顶层目录两种 zip 布局）
mkdir -p "$TARGET"
( cd "$STAGE" && unzip -qo "$ARTIFACT" )
if [[ ! -d "$STAGE/$SKILL_NAME" && -f "$STAGE/SKILL.md" ]]; then
  mkdir -p "$STAGE/$SKILL_NAME"
  while IFS= read -r f; do mv "$f" "$STAGE/$SKILL_NAME/"; done < <(find "$STAGE" -mindepth 1 -maxdepth 1 ! -name "$ARTIFACT" ! -name "$SKILL_NAME")
fi
if [[ -d "$TARGET/$SKILL_NAME" ]]; then
  rm -rf "$TARGET/$SKILL_NAME.bak"
  mv "$TARGET/$SKILL_NAME" "$TARGET/$SKILL_NAME.bak"
fi
mv "$STAGE/$SKILL_NAME" "$TARGET/$SKILL_NAME"
echo "$VERSION" > "$TARGET/$SKILL_NAME/.installed"
[[ -d "$TARGET/$SKILL_NAME.bak" ]] && rm -rf "$TARGET/$SKILL_NAME.bak"

echo "[OK] 已安装 $SKILL_NAME@$VERSION → $TARGET/$SKILL_NAME"
[[ -f "$TARGET/$SKILL_NAME/SKILL.md" ]] && echo "[INFO] 入口: $TARGET/$SKILL_NAME/SKILL.md"
