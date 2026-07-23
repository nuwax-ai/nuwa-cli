#!/usr/bin/env bash
# Publish nuwa-cli to the Nuwax S3 (MinIO) bucket.
#
# Uploads the npm tarball + install scripts under a versioned prefix, rewrites
# the channel pointer, and overwrites the bootstrap installers so the one-line
# install commands always pull the current release.
#
# Credentials: read ONLY from the environment (NUWAX_S3_ACCESS_KEY_ID /
# NUWAX_S3_SECRET_ACCESS_KEY, or a pre-configured AWS profile). NEVER committed
# to the repo — .env is gitignored.
#
# Usage:
#   bash scripts/publish-s3.sh                       # version from package.json
#   bash scripts/publish-s3.sh --version 0.1.0-beta.3
#   bash scripts/publish-s3.sh --channel beta
#   bash scripts/publish-s3.sh --dry-run
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
PKG_JSON="$ROOT_DIR/package.json"

VERSION=""
CHANNEL=""
DRY_RUN=0

usage() {
  cat <<'EOF'
Usage: bash scripts/publish-s3.sh [options]

Options:
  --version VERSION   Version to publish (default: read from package.json)
  --channel NAME      Override channel detection (stable|beta)
  --dry-run           Print planned uploads without sending anything
  -h, --help          Show help

Environment (credentials — NEVER commit; export them or use an AWS profile):
  NUWAX_S3_ENDPOINT          default https://s3.nuwax.com:9443
  NUWAX_S3_REGION            default us-east-1
  NUWAX_S3_BUCKET            default nuwax-packages
  NUWAX_S3_PREFIX            default agent-engines/nuwa-cli
  NUWAX_S3_ACCESS_KEY_ID     mapped to AWS_ACCESS_KEY_ID if AWS_* not already set
  NUWAX_S3_SECRET_ACCESS_KEY
  NUWAX_S3_NO_VERIFY_SSL     set to 1 for self-signed MinIO endpoints
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) VERSION="${2:-}"; shift 2 ;;
    --channel) CHANNEL="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
done

command -v aws  >/dev/null 2>&1 || { echo "aws cli required (brew install awscli)" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "node required" >&2; exit 1; }

# Map NUWAX_S3_* credentials to AWS_* if AWS_* not already set. We never read
# or print the values. If neither env var is set, aws-cli falls back to the
# ~/.aws profile (e.g. [default]) — that's the recommended local setup.
if [[ -z "${AWS_ACCESS_KEY_ID:-}" && -n "${NUWAX_S3_ACCESS_KEY_ID:-}" ]]; then
  export AWS_ACCESS_KEY_ID="$NUWAX_S3_ACCESS_KEY_ID"
fi
if [[ -z "${AWS_SECRET_ACCESS_KEY:-}" && -n "${NUWAX_S3_SECRET_ACCESS_KEY:-}" ]]; then
  export AWS_SECRET_ACCESS_KEY="$NUWAX_S3_SECRET_ACCESS_KEY"
fi

VERSION="${VERSION:-$(node -p "require('$PKG_JSON').version")}"
PKG_NAME=$(node -p "require('$PKG_JSON').name")
# @nuwax-ai/nuwa-cli → nuwax-ai-nuwa-cli (matches npm pack's tarball naming)
PKG_BASE="$(node -p "require('$PKG_JSON').name.replace(/^@/,'').replace(/\//g,'-')")"
TARBALL="$PKG_BASE-$VERSION.tgz"

if [[ -z "$CHANNEL" ]]; then
  if [[ "$VERSION" =~ - ]]; then CHANNEL="beta"; else CHANNEL="stable"; fi
fi
[[ "$CHANNEL" == "stable" || "$CHANNEL" == "beta" ]] || { echo "unsupported channel: $CHANNEL" >&2; exit 1; }

ENDPOINT="${NUWAX_S3_ENDPOINT:-https://s3.nuwax.com:9443}"
REGION="${NUWAX_S3_REGION:-us-east-1}"
BUCKET="${NUWAX_S3_BUCKET:-nuwax-packages}"
PREFIX="${NUWAX_S3_PREFIX:-agent-engines/nuwa-cli}"

AWS_ARGS=(--endpoint-url "$ENDPOINT" --region "$REGION")
[[ "${NUWAX_S3_NO_VERIFY_SSL:-0}" == "1" ]] && AWS_ARGS+=(--no-verify-ssl)

echo "Publishing $PKG_NAME $VERSION (channel=$CHANNEL)"
echo "  endpoint: $ENDPOINT"
echo "  bucket:   $BUCKET"
echo "  prefix:   $PREFIX"
[[ "$DRY_RUN" -eq 1 ]] && echo "  [DRY RUN]"

run_aws() {
  if [[ "$DRY_RUN" -eq 1 ]]; then echo "+ aws $*"; else aws "$@"; fi
}

# --- build + pack ---
echo "→ npm run build"
[[ "$DRY_RUN" -eq 0 ]] && (cd "$ROOT_DIR" && npm run build)

STAGE_DIR=$(mktemp -d)
trap 'rm -rf "$STAGE_DIR"' EXIT
echo "→ npm pack → $TARBALL"
if [[ "$DRY_RUN" -eq 0 ]]; then
  (cd "$ROOT_DIR" && npm pack --pack-destination "$STAGE_DIR" >/dev/null)
  [[ -f "$STAGE_DIR/$TARBALL" ]] || { echo "pack failed: $TARBALL not found" >&2; exit 1; }
fi

S3_BASE="s3://$BUCKET/$PREFIX"
VERSION_BASE="$S3_BASE/versions/$VERSION"

# --- artifacts ---
echo "→ artifacts/$TARBALL"
run_aws s3 cp "$STAGE_DIR/$TARBALL" "$VERSION_BASE/artifacts/$TARBALL" "${AWS_ARGS[@]}" \
  --cache-control "public, max-age=31536000, immutable" \
  --content-type "application/octet-stream" >/dev/null

# --- install scripts: versioned copy + overwrite bootstrap at prefix root ---
for s in install-from-s3.sh install-from-s3.ps1; do
  src="$SCRIPT_DIR/$s"
  [[ -f "$src" ]] || { echo "  skip $s (not found locally)" >&2; continue; }
  echo "→ scripts/$s"
  run_aws s3 cp "$src" "$VERSION_BASE/scripts/$s" "${AWS_ARGS[@]}" \
    --cache-control "public, max-age=31536000, immutable" \
    --content-type "text/x-shellscript" >/dev/null
  echo "→ bootstrap $s"
  run_aws s3 cp "$src" "$S3_BASE/$s" "${AWS_ARGS[@]}" \
    --cache-control "public, max-age=60, must-revalidate" \
    --content-type "text/x-shellscript" >/dev/null
done

# --- channel pointer ---
echo "→ channels/$CHANNEL.json"
GIT_SHA=$(cd "$ROOT_DIR" && git rev-parse HEAD 2>/dev/null || echo unknown)
RELEASE_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
CHANNEL_BODY=$(CHANNEL="$CHANNEL" VERSION="$VERSION" GITSHA="$GIT_SHA" DATE="$RELEASE_DATE" PREFIX="$PREFIX" node <<'NODE'
process.stdout.write(JSON.stringify({
  schema: "nuwax.cli.channel.v1",
  channel: process.env.CHANNEL,
  version: process.env.VERSION,
  gitSha: process.env.GITSHA,
  releasedAt: process.env.DATE,
  artifactBase: `${process.env.PREFIX}/versions/${process.env.VERSION}/artifacts/`,
}, null, 2) + "\n");
NODE
)
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "+ aws s3 cp - $S3_BASE/channels/$CHANNEL.json"
else
  printf '%s' "$CHANNEL_BODY" | aws s3 cp - "$S3_BASE/channels/$CHANNEL.json" \
    "${AWS_ARGS[@]}" \
    --cache-control "public, max-age=60, must-revalidate" \
    --content-type "application/json"
fi

# stable also bumps latest.json; beta does not.
if [[ "$CHANNEL" == "stable" ]]; then
  echo "→ latest.json"
  LATEST_BODY=$(VERSION="$VERSION" GITSHA="$GIT_SHA" DATE="$RELEASE_DATE" node <<'NODE'
process.stdout.write(JSON.stringify({ schema:"nuwax.cli.latest.v1", version:process.env.VERSION, gitSha:process.env.GITSHA, releasedAt:process.env.DATE }, null, 2)+"\n");
NODE
)
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "+ aws s3 cp - $S3_BASE/latest.json"
  else
    printf '%s' "$LATEST_BODY" | aws s3 cp - "$S3_BASE/latest.json" \
      "${AWS_ARGS[@]}" \
      --cache-control "public, max-age=60, must-revalidate" \
      --content-type "application/json"
  fi
fi

echo
echo "Publish complete: $VERSION on $CHANNEL"
echo "Discovery (public reads, no credentials):"
echo "  channel:    $ENDPOINT/$BUCKET/$PREFIX/channels/$CHANNEL.json"
echo "  bootstrap:  $ENDPOINT/$BUCKET/$PREFIX/install-from-s3.sh"
echo "              $ENDPOINT/$BUCKET/$PREFIX/install-from-s3.ps1"
