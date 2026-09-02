#!/usr/bin/env bash
# upload_workspace_file.sh — 上传本地文件到本机 file-server 的项目工作区（云侧文件树立即可见）。
#
# 用法: upload_workspace_file.sh <file> <cId> [userId]
#   cId    项目/会话工作区 ID（~/.nuwa-cli/workspaces/<userId>/<cId>/）
#   userId 缺省 $NUWAX_USER_ID，再缺省从 ~/.nuwa-cli/workspaces 下唯一起始目录推断
# 环境: FILE_SERVER_PORT（缺省 60015）
#
# 依赖: curl。上传成功后顺带调 get-file-list 验证可见性。

set -euo pipefail

FILE="${1:?用法: $0 <file> <cId> [userId]}"
CID="${2:?缺少 cId}"
USER_ID="${3:-${NUWAX_USER_ID:-}}"
PORT="${FILE_SERVER_PORT:-60015}"
BASE="http://127.0.0.1:${PORT}"

[[ -f "$FILE" ]] || { echo "[ERROR] 文件不存在: $FILE" >&2; exit 1; }

if [[ -z "$USER_ID" ]]; then
  ROOT="$HOME/.nuwa-cli/workspaces"
  USERS=$(ls "$ROOT" 2>/dev/null || true)
  COUNT=$(echo "$USERS" | grep -c . || true)
  if [[ "$COUNT" -eq 1 ]]; then
    USER_ID="$USERS"
  else
    echo "[ERROR] 无法推断 userId（找到 $COUNT 个用户目录），请显式传第 3 参或设 NUWAX_USER_ID" >&2
    exit 1
  fi
fi

echo "[INFO] 上传 $FILE → userId=$USER_ID cId=$CID"
RESP=$(curl -s -X POST "$BASE/api/computer/upload-file" \
  -F "userId=$USER_ID" \
  -F "cId=$CID" \
  -F "filePath=$(basename "$FILE")" \
  -F "file=@$FILE")

echo "$RESP"
echo "$RESP" | grep -q '"success":true' || { echo "[ERROR] 上传失败" >&2; exit 3; }

echo "[INFO] 验证文件树可见性…"
curl -s "$BASE/api/computer/get-file-list?userId=$USER_ID&cId=$CID" \
  | grep -q "$(basename "$FILE")" \
  && echo "[OK] 文件已在项目 $CID 工作区可见" \
  || { echo "[WARN] 列表中未见文件，请人工核对" >&2; exit 4; }
