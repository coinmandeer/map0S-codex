#!/usr/bin/env bash
set -euo pipefail
# Deploy MapOS V3 to VPS (ports 4032/4033)
# Usage: ./scripts/deploy-vps.sh [release-tag]

TAG="${1:-$(date +%Y%m%d)-mapos-v3}"
HOST="${DEPLOY_HOST:-}"
REMOTE_DIR="${DEPLOY_REMOTE_DIR:-/opt/mapos}"
PUBLIC_HOST="${DEPLOY_PUBLIC_HOST:-mapos.example.com}"

if [[ -z "${HOST}" ]]; then
  echo "DEPLOY_HOST is not set (expected e.g. user@your-server)." >&2
  echo "Optional: DEPLOY_REMOTE_DIR (default ${REMOTE_DIR}), DEPLOY_PUBLIC_HOST." >&2
  exit 1
fi

echo "==> Packaging release ${TAG}"
tar -czf "/tmp/mapos-v3-${TAG}.tar.gz" \
  --exclude=node_modules \
  --exclude=.git \
  --exclude=apps/web/dist \
  --exclude=apps/api/dist \
  --exclude=packages/layer-sdk/dist \
  -C "$(dirname "$0")/.." .

echo "==> Uploading to VPS (read-only check first — run with DEPLOY=1 to apply)"
echo "    scp /tmp/mapos-v3-${TAG}.tar.gz ${HOST}:/tmp/"
echo "    ssh ${HOST} 'mkdir -p ${REMOTE_DIR}/releases/${TAG} && tar -xzf /tmp/mapos-v3-${TAG}.tar.gz -C ${REMOTE_DIR}/releases/${TAG}'"
echo "    ssh ${HOST} 'cd ${REMOTE_DIR}/releases/${TAG} && cp infra/.env.production.example infra/.env.production'"
echo "    ssh ${HOST} 'cd ${REMOTE_DIR}/releases/${TAG} && docker compose -f infra/compose.production.yml --env-file infra/.env.production up -d --build'"
echo ""
echo "Caddy snippet (do NOT apply automatically):"
echo "  ${PUBLIC_HOST} { reverse_proxy 127.0.0.1:4032 }"
echo "  handle /api/* { reverse_proxy 127.0.0.1:4033 }"

if [[ "${DEPLOY:-0}" == "1" ]]; then
  scp "/tmp/mapos-v3-${TAG}.tar.gz" "${HOST}:/tmp/"
  ssh "${HOST}" bash -s <<EOF
set -euo pipefail
REMOTE_DIR="${REMOTE_DIR}"
TAG="${TAG}"
mkdir -p "\${REMOTE_DIR}/releases/\${TAG}"
tar -xzf "/tmp/mapos-v3-\${TAG}.tar.gz" -C "\${REMOTE_DIR}/releases/\${TAG}"
if [[ -f "\${REMOTE_DIR}/current/infra/.env.production" ]]; then
  cp "\${REMOTE_DIR}/current/infra/.env.production" "\${REMOTE_DIR}/releases/\${TAG}/infra/.env.production"
elif [[ ! -f "\${REMOTE_DIR}/releases/\${TAG}/infra/.env.production" ]]; then
  cp "\${REMOTE_DIR}/releases/\${TAG}/infra/.env.production.example" "\${REMOTE_DIR}/releases/\${TAG}/infra/.env.production"
fi
ln -sfn "releases/\${TAG}" "\${REMOTE_DIR}/current"
cd "\${REMOTE_DIR}/current"
IMAGE_TAG="\${TAG}" docker compose -f infra/compose.production.yml --env-file infra/.env.production up -d --build
docker compose -f infra/compose.production.yml --env-file infra/.env.production exec -T api npm run seed -w @mapos/api || true
EOF
  echo "Deployed ${TAG} on ports 4032/4033 — https://${PUBLIC_HOST}"
fi
