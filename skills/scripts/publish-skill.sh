#!/usr/bin/env bash
# publish-skill.sh — 把 skills/<name> 打包发布到 Nuwax S3 (MinIO)，供 install-skill.sh 一键安装。
#
# 布局（对齐 docs/distribution-s3.md 的 versions/ 不可变 + latest 指针约定）：
#   s3://$BUCKET/$SKILL_PREFIX/<name>/
#     ├── latest.json                                 # {name, version, sha256, artifact, releasedAt}（max-age=60）
#     └── versions/<version>/
#         ├── manifest.json                           # 同 latest 体 + files 列表
#         └── artifacts/<name>-<version>.zip(+.sha256)  # immutable
#
# 用法:
#   bash publish-skill.sh <skillDir> [--version 0.1.0] [--dry-run]
#   # skillDir 缺省取本脚本 ../../skills/ 下唯一子目录
#
# 凭证: 与 publish-s3.sh 完全一致 —— NUWAX_S3_* 环境变量或 ~/.aws profile；安装侧零凭证（桶公开读）。

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
SKILLS_ROOT="$REPO_ROOT/skills"

# --- 参数 ---
SKILL_DIR=""
VERSION=""
DRY_RUN=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) echo "用法: $0 <skillDir> [--version 0.1.0] [--dry-run]"; exit 0 ;;
    *) SKILL_DIR="$1"; shift ;;
  esac
done

if [[ -z "$SKILL_DIR" ]]; then
  CANDS=()
  while IFS= read -r d; do CANDS+=("$d"); done < <(find "$SKILLS_ROOT" -mindepth 1 -maxdepth 2 -name SKILL.md -exec dirname {} \; | sort)
  [[ ${#CANDS[@]} -eq 1 ]] || { echo "[ERROR] skills/ 下找到 ${#CANDS[@]} 个 skill，请显式传 skillDir: ${CANDS[*]:-}" >&2; exit 1; }
  SKILL_DIR="${CANDS[0]}"
fi
[[ -f "$SKILL_DIR/SKILL.md" ]] || { echo "[ERROR] $SKILL_DIR 缺 SKILL.md" >&2; exit 1; }

SKILL_NAME="$(basename "$SKILL_DIR")"
VERSION="${VERSION:-0.1.0}"

# --- S3 配置（与 publish-s3.sh 同契约） ---
ENDPOINT="${NUWAX_S3_ENDPOINT:-https://s3.nuwax.com:9443}"
REGION="${NUWAX_S3_REGION:-us-east-1}"
BUCKET="${NUWAX_S3_BUCKET:-nuwax-packages}"
PREFIX="${NUWAX_S3_SKILL_PREFIX:-agent-engines/nuwa-cli/skills}"
NO_VERIFY="${NUWAX_S3_NO_VERIFY_SSL:-0}"

AWS_ARGS=(--endpoint-url "$ENDPOINT" --region "$REGION")
[[ "$NO_VERIFY" == "1" ]] && AWS_ARGS+=(--no-verify-ssl)

S3_BASE="s3://$BUCKET/$PREFIX/$SKILL_NAME"
VERSION_BASE="$S3_BASE/versions/$VERSION"
ARTIFACT="$SKILL_NAME-$VERSION.zip"

# --- 打包 ---
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/$SKILL_NAME"
tar -cf - -C "$SKILL_DIR" . | tar -xf - -C "$STAGE/$SKILL_NAME"
rm -rf "$STAGE/$SKILL_NAME/__pycache__" "$(find "$STAGE" -name .DS_Store 2>/dev/null)" 2>/dev/null || true

( cd "$STAGE" && zip -qr "$ARTIFACT" "$SKILL_NAME" )
SHA256=$(shasum -a 256 "$STAGE/$ARTIFACT" | awk '{print $1}')
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

MANIFEST=$(python3 - "$SKILL_NAME" "$VERSION" "$SHA256" "$NOW" "$ARTIFACT" "$STAGE/$SKILL_NAME" <<'PY'
import json, os, sys
name, version, sha, now, artifact, src = sys.argv[1:7]
files = []
for root, _, fns in os.walk(src):
    for fn in sorted(fns):
        p = os.path.join(root, fn)
        rel = os.path.relpath(p, src).replace(os.sep, "/")
        files.append({"path": rel, "size": os.path.getsize(p)})
print(json.dumps({"schema": 1, "name": name, "version": version, "sha256": sha,
                  "releasedAt": now, "artifact": artifact, "files": files},
                 ensure_ascii=False, indent=2))
PY
)
echo "$MANIFEST" > "$STAGE/manifest.json"
echo "$SHA256  $ARTIFACT" > "$STAGE/$ARTIFACT.sha256"
LATEST_BODY=$(MANIFEST=$MANIFEST python3 -c 'import json,os; d=json.loads(os.environ["MANIFEST"]); d.pop("files",None); print(json.dumps(d, ensure_ascii=False))')

echo "[PLAN] $SKILL_DIR → $VERSION_BASE/artifacts/$ARTIFACT (sha256=$SHA256)"
[[ -n "${NUWAX_S3_ACCESS_KEY_ID:-}${AWS_PROFILE:-}" ]] || echo "[INFO] 未检测到显式凭证，将使用 ~/.aws [default] profile"

run_aws() { if [[ "$DRY_RUN" == "1" ]]; then echo "+ aws $*"; else aws "$@"; fi; }

# --- 上传（版本目录 immutable；latest 指针 max-age=60） ---
run_aws s3 cp "$STAGE/$ARTIFACT" "$VERSION_BASE/artifacts/$ARTIFACT" "${AWS_ARGS[@]}" \
  --cache-control "public, max-age=31536000, immutable" --content-type "application/zip"
run_aws s3 cp "$STAGE/$ARTIFACT.sha256" "$VERSION_BASE/artifacts/$ARTIFACT.sha256" "${AWS_ARGS[@]}" \
  --cache-control "public, max-age=31536000, immutable" --content-type "text/plain"
run_aws s3 cp "$STAGE/manifest.json" "$VERSION_BASE/manifest.json" "${AWS_ARGS[@]}" \
  --cache-control "public, max-age=31536000, immutable" --content-type "application/json"
printf '%s' "$LATEST_BODY" | run_aws s3 cp - "$S3_BASE/latest.json" "${AWS_ARGS[@]}" \
  --cache-control "public, max-age=60, must-revalidate" --content-type "application/json"

if [[ "$DRY_RUN" == "1" ]]; then
  echo "[DRY-RUN] 未真传。本地产物保留在 $STAGE"
else
  echo "[OK] 发布完成。安装："
  PUBLIC="$ENDPOINT/$BUCKET/$PREFIX/$SKILL_NAME"
  echo "  curl -fsSL $PUBLIC/latest.json"
  echo "  bash $(dirname "$0")/install-skill.sh $SKILL_NAME"
fi
