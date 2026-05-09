#!/usr/bin/env bash
# Run ON the EC2 host (already SSH'd as ubuntu): refresh ZerodhaKite Hub images only.
# Does not touch other stacks (astrology / ai_tools) unless they share this compose project.
#
# Usage:
#   chmod +x scripts/ec2-hub-refresh.sh   # once
#   ZERODHAKITE_ROOT=/path/to/repo ./scripts/ec2-hub-refresh.sh
#
# Defaults: ZERODHAKITE_ROOT=$HOME/apps/zerodhakite, DOCKERHUB_NAMESPACE=baparaj, IMAGE_TAG=latest
set -euo pipefail
ROOT="${ZERODHAKITE_ROOT:-${HOME}/apps/zerodhakite}"
export DOCKERHUB_NAMESPACE="${DOCKERHUB_NAMESPACE:-baparaj}"
export IMAGE_TAG="${IMAGE_TAG:-latest}"

if [[ ! -f "${ROOT}/docker-compose.hub.yml" ]]; then
  echo "error: docker-compose.hub.yml not found under ${ROOT}" >&2
  echo "Set ZERODHAKITE_ROOT to your ZerodhaKiteGit clone directory." >&2
  exit 1
fi

cd "$ROOT"
echo "==> $(pwd)"
echo "==> git pull origin main (best-effort)"
git pull origin main || true

echo "==> docker compose pull (namespace=${DOCKERHUB_NAMESPACE} tag=${IMAGE_TAG})"
docker compose -f docker-compose.hub.yml pull

echo "==> docker compose up -d --force-recreate (zerodhakite only)"
docker compose -f docker-compose.hub.yml up -d --force-recreate

echo "==> status"
docker compose -f docker-compose.hub.yml ps
