#!/usr/bin/env bash
set -Eeuo pipefail

# Safe, low-bandwidth MapOS deployment to the existing VPS installation.
#
# Dry run (default; creates and validates only a local temporary archive):
#   DEPLOY_HOST=user@your-server ./scripts/deploy-vps.sh [release-tag]
#
# Apply after reviewing the dry run:
#   DRY_RUN=0 DEPLOY_HOST=user@your-server ./scripts/deploy-vps.sh [release-tag]

MAPOS_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAPOS_PROJECT_DIR="$(cd "${MAPOS_SCRIPT_DIR}/.." && pwd)"
MAPOS_TAG="${1:-$(date -u +%Y%m%dT%H%M%SZ)-mapos-v3}"
MAPOS_HOST="${DEPLOY_HOST:-}"
MAPOS_REMOTE_DIR="${DEPLOY_REMOTE_DIR:-/opt/ps3000/apps/mapos-v3}"
MAPOS_PUBLIC_HOST="${DEPLOY_PUBLIC_HOST:-mapos.promptstudio3000.com}"
MAPOS_DRY_RUN="${DRY_RUN:-1}"
MAPOS_USE_SUDO="${DEPLOY_SUDO:-0}"
MAPOS_REMOTE_SHELL=(bash)
MAPOS_TEMP_DIR=""
MAPOS_ARCHIVE=""

fail() {
  echo "deploy: $*" >&2
  exit 1
}

check_embedded_syntax() {
  local MAPOS_MARKER="$1"
  awk -v marker="${MAPOS_MARKER}" '
    index($0, "<<") && index($0, marker) { inside = 1; found = 1; next }
    inside && $0 == marker { closed = 1; exit }
    inside { print }
    END { if (!found || !closed) exit 2 }
  ' "${BASH_SOURCE[0]}" | bash -n || fail "Embedded ${MAPOS_MARKER} syntax check failed."
}

cleanup_local() {
  if [[ -n "${MAPOS_ARCHIVE:-}" ]]; then
    rm -f -- "${MAPOS_ARCHIVE}"
  fi
  if [[ -n "${MAPOS_TEMP_DIR:-}" ]]; then
    rmdir -- "${MAPOS_TEMP_DIR}" 2>/dev/null || true
  fi
}
trap cleanup_local EXIT

[[ "${MAPOS_DRY_RUN}" != "0" || -n "${DEPLOY_REMOTE_DIR:-}" ]] || fail "DEPLOY_REMOTE_DIR must explicitly identify the active installation."
[[ -n "${MAPOS_HOST}" ]] || fail "DEPLOY_HOST is required (for example user@your-server)."
[[ "${MAPOS_HOST}" != *[[:space:]]* ]] || fail "DEPLOY_HOST must not contain whitespace."
[[ "${MAPOS_DRY_RUN}" == "0" || "${MAPOS_DRY_RUN}" == "1" ]] || fail "DRY_RUN must be 0 or 1."
[[ "${MAPOS_USE_SUDO}" == "0" || "${MAPOS_USE_SUDO}" == "1" ]] || fail "DEPLOY_SUDO must be 0 or 1."
if [[ "${MAPOS_USE_SUDO}" == "1" ]]; then MAPOS_REMOTE_SHELL=(sudo -n bash); fi
[[ "${MAPOS_TAG}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || fail "Invalid release tag: ${MAPOS_TAG}"
[[ "${MAPOS_REMOTE_DIR}" == /* && "${MAPOS_REMOTE_DIR}" != *".."* && "${MAPOS_REMOTE_DIR}" != *[[:space:]]* ]] ||
  fail "DEPLOY_REMOTE_DIR must be a safe absolute path."
[[ "${MAPOS_PUBLIC_HOST}" =~ ^[A-Za-z0-9.-]+$ ]] || fail "Invalid DEPLOY_PUBLIC_HOST."

command -v bash >/dev/null 2>&1 || fail "bash is required."
command -v tar >/dev/null 2>&1 || fail "tar is required."
command -v ssh >/dev/null 2>&1 || fail "ssh is required."
command -v scp >/dev/null 2>&1 || fail "scp is required."
bash -n "${BASH_SOURCE[0]}" || fail "Deployment script syntax check failed."
check_embedded_syntax MAPOS_PREFLIGHT
check_embedded_syntax MAPOS_REMOTE
check_embedded_syntax MAPOS_ACTIVATION_CHECK

MAPOS_TEMP_ROOT="${TMPDIR:-/tmp}"
MAPOS_TEMP_DIR="$(mktemp -d "${MAPOS_TEMP_ROOT%/}/mapos-deploy.XXXXXX")"
MAPOS_ARCHIVE="${MAPOS_TEMP_DIR}/mapos-v3-${MAPOS_TAG}.tar.gz"

echo "==> Packaging minimal release ${MAPOS_TAG}"
# Only files required by the production Docker build are included. The excludes prevent local
# build caches, downloaded game models and any accidentally created environment file from entering
# either the upload or Docker build context.
COPYFILE_DISABLE=1 tar --no-xattrs -czf "${MAPOS_ARCHIVE}" \
  --exclude=node_modules \
  --exclude=dist \
  --exclude=.env \
  --exclude='.env.*' \
  --exclude='._*' \
  --exclude=.DS_Store \
  --exclude=apps/web/public/models \
  -C "${MAPOS_PROJECT_DIR}" \
  package.json \
  package-lock.json \
  tsconfig.base.json \
  Dockerfile \
  .dockerignore \
  apps/api \
  apps/web \
  packages/layer-sdk \
  packages/adapter-sdk \
  packages/map-runtime \
  scripts/copy-ai-assets.mjs \
  scripts/check-release-identity.mjs \
  infra/compose.production.yml \
  infra/nginx.conf \
  infra/security-headers.inc

if tar -tzf "${MAPOS_ARCHIVE}" | grep -Eq '(^|/)(node_modules|dist)(/|$)|(^|/)\.env($|\.)|^apps/web/public/models(/|$)'; then
  fail "Release archive contains a forbidden local, generated or secret path."
fi

MAPOS_ARCHIVE_BYTES="$(wc -c < "${MAPOS_ARCHIVE}" | tr -d '[:space:]')"
echo "    payload: ${MAPOS_ARCHIVE_BYTES} compressed bytes"
echo "    target:  ${MAPOS_HOST}:${MAPOS_REMOTE_DIR}/releases/${MAPOS_TAG}"
echo "    public:  https://${MAPOS_PUBLIC_HOST}"

if [[ "${MAPOS_DRY_RUN}" == "1" ]]; then
  echo "==> DRY_RUN=1: no network connection or remote change was made."
  echo "    Apply with DRY_RUN=0 after reviewing the target and local test results."
  exit 0
fi

echo "==> Running read-only VPS preflight"
ssh -o ServerAliveInterval=15 -o ServerAliveCountMax=4 "${MAPOS_HOST}" "${MAPOS_REMOTE_SHELL[@]}" -s -- "${MAPOS_REMOTE_DIR}" "${MAPOS_TAG}" <<'MAPOS_PREFLIGHT'
set -Eeuo pipefail

MAPOS_REMOTE_DIR="$1"
MAPOS_TAG="$2"
MAPOS_CURRENT_DIR="${MAPOS_REMOTE_DIR}/current"
MAPOS_RELEASE_DIR="${MAPOS_REMOTE_DIR}/releases/${MAPOS_TAG}"
MAPOS_CURRENT_COMPOSE="${MAPOS_CURRENT_DIR}/infra/compose.production.yml"
MAPOS_CURRENT_ENV="${MAPOS_CURRENT_DIR}/infra/.env.production"

preflight_fail() {
  echo "deploy preflight: $*" >&2
  exit 1
}

for MAPOS_COMMAND in docker curl sha256sum install tar mv; do
  command -v "${MAPOS_COMMAND}" >/dev/null 2>&1 || preflight_fail "${MAPOS_COMMAND} is required on the VPS."
done

[[ -d "${MAPOS_REMOTE_DIR}" ]] || preflight_fail "Missing deployment directory ${MAPOS_REMOTE_DIR}."
[[ -w "${MAPOS_REMOTE_DIR}" ]] || preflight_fail "Deployment directory is not writable."
[[ -L "${MAPOS_CURRENT_DIR}" ]] || preflight_fail "${MAPOS_CURRENT_DIR} must be the active release symlink."
[[ -f "${MAPOS_CURRENT_COMPOSE}" ]] || preflight_fail "Missing current production compose file."
[[ -s "${MAPOS_CURRENT_ENV}" ]] || preflight_fail "Missing current production environment file."
[[ ! -e "${MAPOS_RELEASE_DIR}" ]] || preflight_fail "Release ${MAPOS_TAG} already exists; choose a unique tag."
mapos_current_compose() {
  docker compose -f "${MAPOS_CURRENT_COMPOSE}" --env-file "${MAPOS_CURRENT_ENV}" "$@"
}

mapos_current_compose config -q
for MAPOS_SERVICE in postgres api web; do
  MAPOS_CONTAINER_ID="$(mapos_current_compose ps -q "${MAPOS_SERVICE}")"
  [[ -n "${MAPOS_CONTAINER_ID}" ]] || preflight_fail "Current ${MAPOS_SERVICE} container is missing."
  [[ "$(docker inspect -f '{{.State.Status}}' "${MAPOS_CONTAINER_ID}")" == "running" ]] ||
    preflight_fail "Current ${MAPOS_SERVICE} container is not running."
done

MAPOS_UP_HELP="$(docker compose up --help)"
grep -q -- '--wait' <<<"${MAPOS_UP_HELP}" || preflight_fail "Docker Compose does not support up --wait."
grep -q -- '--wait-timeout' <<<"${MAPOS_UP_HELP}" || preflight_fail "Docker Compose does not support --wait-timeout."
MAPOS_MV_HELP="$(mv --help 2>&1)"
grep -q -- '--no-target-directory' <<<"${MAPOS_MV_HELP}" || preflight_fail "mv -T is required for atomic cutover."

MAPOS_AVAILABLE_KB="$(df -Pk "${MAPOS_REMOTE_DIR}" | awk 'END { print $4 }')"
[[ "${MAPOS_AVAILABLE_KB}" =~ ^[0-9]+$ && "${MAPOS_AVAILABLE_KB}" -ge 1048576 ]] ||
  preflight_fail "At least 1 GiB of free VPS disk space is required for the staged build and backup."

echo "preflight: current services running, compose valid, disk sufficient"
MAPOS_PREFLIGHT

MAPOS_REMOTE_ARCHIVE="/tmp/mapos-v3-${MAPOS_TAG}.tar.gz"
echo "==> Uploading ${MAPOS_ARCHIVE_BYTES} compressed bytes"
scp -o ServerAliveInterval=15 -o ServerAliveCountMax=4 -q "${MAPOS_ARCHIVE}" "${MAPOS_HOST}:${MAPOS_REMOTE_ARCHIVE}"

echo "==> Staging, backing up and deploying ${MAPOS_TAG}"
ssh -o ServerAliveInterval=15 -o ServerAliveCountMax=4 "${MAPOS_HOST}" "${MAPOS_REMOTE_SHELL[@]}" -s -- "${MAPOS_REMOTE_DIR}" "${MAPOS_TAG}" "${MAPOS_REMOTE_ARCHIVE}" "${MAPOS_PUBLIC_HOST}" <<'MAPOS_REMOTE'
set -Eeuo pipefail

MAPOS_REMOTE_DIR="$1"
MAPOS_TAG="$2"
MAPOS_REMOTE_ARCHIVE="$3"
MAPOS_PUBLIC_HOST="$4"
MAPOS_RELEASE_DIR="${MAPOS_REMOTE_DIR}/releases/${MAPOS_TAG}"
MAPOS_RELEASE_COMPOSE="${MAPOS_RELEASE_DIR}/infra/compose.production.yml"
MAPOS_RELEASE_ENV="${MAPOS_RELEASE_DIR}/infra/.env.production"
MAPOS_CURRENT_DIR="${MAPOS_REMOTE_DIR}/current"
MAPOS_CURRENT_COMPOSE="${MAPOS_CURRENT_DIR}/infra/compose.production.yml"
MAPOS_CURRENT_ENV="${MAPOS_CURRENT_DIR}/infra/.env.production"
MAPOS_BACKUP_DIR="${MAPOS_REMOTE_DIR}/backups/${MAPOS_TAG}"
MAPOS_PREVIOUS_TARGET="$(readlink "${MAPOS_CURRENT_DIR}")"
MAPOS_VERIFY_SINCE=""

mapos_current_compose() {
  docker compose -f "${MAPOS_CURRENT_COMPOSE}" --env-file "${MAPOS_CURRENT_ENV}" "$@"
}

mapos_release_compose() {
  docker compose -f "${MAPOS_RELEASE_COMPOSE}" --env-file "${MAPOS_RELEASE_ENV}" "$@"
}

mapos_atomic_current() {
  local MAPOS_LINK_TARGET="$1"
  local MAPOS_TEMP_LINK="${MAPOS_REMOTE_DIR}/.current-${MAPOS_TAG}-$$"
  rm -f -- "${MAPOS_TEMP_LINK}"
  ln -s "${MAPOS_LINK_TARGET}" "${MAPOS_TEMP_LINK}"
  mv -Tf -- "${MAPOS_TEMP_LINK}" "${MAPOS_CURRENT_DIR}"
}

mapos_rollback() {
  local MAPOS_ROLLBACK_STATUS=0
  echo "deploy: rollout verification failed; restoring ${MAPOS_PREVIOUS_TARGET}" >&2
  set +e
  mapos_release_compose logs --since "${MAPOS_VERIFY_SINCE:-5m}" --tail 120 --no-color api web >&2
  mapos_atomic_current "${MAPOS_PREVIOUS_TARGET}" || MAPOS_ROLLBACK_STATUS=1
  # A no-op unless this release changed the database settings; then the previous ones return.
  mapos_current_compose up -d --no-build --wait --wait-timeout 180 postgres || MAPOS_ROLLBACK_STATUS=1
  docker image tag "${MAPOS_OLD_API_IMAGE}" "${MAPOS_API_IMAGE}" || MAPOS_ROLLBACK_STATUS=1
  docker image tag "${MAPOS_OLD_WEB_IMAGE}" "${MAPOS_WEB_IMAGE}" || MAPOS_ROLLBACK_STATUS=1
  mapos_current_compose up -d --no-build --force-recreate --wait --wait-timeout 180 api web ||
    MAPOS_ROLLBACK_STATUS=1
  curl -fsS --max-time 10 "http://127.0.0.1:${MAPOS_API_PORT}/health" >/dev/null || MAPOS_ROLLBACK_STATUS=1
  curl -fsS --max-time 10 -o /dev/null "http://127.0.0.1:${MAPOS_WEB_PORT}/" || MAPOS_ROLLBACK_STATUS=1
  set -e
  if [[ "${MAPOS_ROLLBACK_STATUS}" -eq 0 ]]; then
    echo "deploy: previous release restored and healthy" >&2
  else
    echo "deploy: automatic rollback was incomplete; manual intervention is required" >&2
  fi
}

[[ ! -e "${MAPOS_RELEASE_DIR}" ]] || { echo "deploy: release already exists" >&2; exit 1; }
[[ ! -e "${MAPOS_BACKUP_DIR}" ]] || { echo "deploy: backup directory already exists" >&2; exit 1; }
[[ -f "${MAPOS_REMOTE_ARCHIVE}" ]] || { echo "deploy: uploaded archive is missing" >&2; exit 1; }

mkdir -p "${MAPOS_REMOTE_DIR}/releases" "${MAPOS_REMOTE_DIR}/backups"
mkdir "${MAPOS_RELEASE_DIR}"
tar -xzf "${MAPOS_REMOTE_ARCHIVE}" -C "${MAPOS_RELEASE_DIR}"
rm -f -- "${MAPOS_REMOTE_ARCHIVE}"

# The release inherits production secrets; the local example file is never used. Historical host
# GLBs are intentionally excluded from the small mobile-data payload and remain available only to
# v18 rollback. V19 mounts an empty release-local model directory and uses its procedural fallback.
# The immutable tag is always replaced so the migration ledger records the actual rollout rather
# than inheriting an older release value.
install -m 600 "${MAPOS_CURRENT_ENV}" "${MAPOS_RELEASE_ENV}"
sed -i '/^MAPOS_RELEASE=/d' "${MAPOS_RELEASE_ENV}"
printf '\nMAPOS_RELEASE=%s\n' "${MAPOS_TAG}" >> "${MAPOS_RELEASE_ENV}"
# Security-critical per-deployment values are generated on the VPS and never cross the mobile
# upload. Existing explicit operator values win; simulation and live inventory remain off.
if ! grep -Eq '^MAPOS_RATE_LIMIT_SECRET=.{32,}$' "${MAPOS_RELEASE_ENV}"; then
  sed -i '/^MAPOS_RATE_LIMIT_SECRET=/d' "${MAPOS_RELEASE_ENV}"
  MAPOS_RATE_LIMIT_SECRET="$(tr -d '-' < /proc/sys/kernel/random/uuid)"
  printf 'MAPOS_RATE_LIMIT_SECRET=%s\n' "${MAPOS_RATE_LIMIT_SECRET}" >> "${MAPOS_RELEASE_ENV}"
fi
if ! grep -Eq '^MAPOS_OPERATIONS_TOKEN=.{32,}$' "${MAPOS_RELEASE_ENV}"; then
  sed -i '/^MAPOS_OPERATIONS_TOKEN=/d' "${MAPOS_RELEASE_ENV}"
  MAPOS_OPERATIONS_TOKEN="$(tr -d '-' < /proc/sys/kernel/random/uuid)"
  printf 'MAPOS_OPERATIONS_TOKEN=%s\n' "${MAPOS_OPERATIONS_TOKEN}" >> "${MAPOS_RELEASE_ENV}"
fi
# SIWE signs this exact URI/domain. A syntactically valid value inherited from another host is
# still unsafe, so the deployment target always replaces it rather than merely filling a blank.
sed -i '/^MAPOS_PUBLIC_ORIGIN=/d' "${MAPOS_RELEASE_ENV}"
printf 'MAPOS_PUBLIC_ORIGIN=https://%s\n' "${MAPOS_PUBLIC_HOST}" >> "${MAPOS_RELEASE_ENV}"
if ! grep -qx 'MAPOS_SIWE_ENABLED=1' "${MAPOS_RELEASE_ENV}"; then
  sed -i '/^MAPOS_SIWE_ENABLED=/d' "${MAPOS_RELEASE_ENV}"
  printf 'MAPOS_SIWE_ENABLED=1\n' >> "${MAPOS_RELEASE_ENV}"
fi
if ! grep -Eq '^MAPOS_SIWE_CHAIN_IDS=[0-9,]+$' "${MAPOS_RELEASE_ENV}"; then
  sed -i '/^MAPOS_SIWE_CHAIN_IDS=/d' "${MAPOS_RELEASE_ENV}"
  printf 'MAPOS_SIWE_CHAIN_IDS=1,8453\n' >> "${MAPOS_RELEASE_ENV}"
fi
# V19 has no approved live inventory indexer or production payment adapter. Do not inherit a
# development-only simulation/provider gate from an older environment file.
sed -i \
  -e '/^MAPOS_IDENTITY_SIMULATION_ENABLED=/d' \
  -e '/^MAPOS_ALLOW_PRODUCTION_SIMULATION=/d' \
  -e '/^MAPOS_COMMERCE_ENABLED=/d' \
  -e '/^MAPOS_COMMERCE_PROVIDER=/d' \
  -e '/^MAPOS_SYNTHETIC_COMMERCE_ENABLED=/d' \
  -e '/^MAPOS_SYNTHETIC_COMMERCE_SECRET=/d' \
  "${MAPOS_RELEASE_ENV}"
printf '%s\n' \
  'MAPOS_IDENTITY_SIMULATION_ENABLED=' \
  'MAPOS_ALLOW_PRODUCTION_SIMULATION=' \
  'MAPOS_COMMERCE_ENABLED=' \
  'MAPOS_COMMERCE_PROVIDER=none' \
  'MAPOS_SYNTHETIC_COMMERCE_ENABLED=' \
  >> "${MAPOS_RELEASE_ENV}"
mkdir -m 755 "${MAPOS_RELEASE_DIR}/models"
sed -i '/^MODELS_HOST_DIR=/d' "${MAPOS_RELEASE_ENV}"
printf '\nMODELS_HOST_DIR=%s/models\n' "${MAPOS_RELEASE_DIR}" >> "${MAPOS_RELEASE_ENV}"
mapos_release_compose config -q

# Resolve the deployment-specific Compose project and host ports from the inherited environment.
# This keeps preview installations such as mapos2 isolated from the primary mapos-v3 images and
# loopback ports during staging, verification and rollback.
MAPOS_COMPOSE_PROJECT="$(sed -n 's/^MAPOS_COMPOSE_PROJECT=//p' "${MAPOS_RELEASE_ENV}" | tail -n 1)"
MAPOS_API_PORT="$(sed -n 's/^MAPOS_API_PORT=//p' "${MAPOS_RELEASE_ENV}" | tail -n 1)"
MAPOS_WEB_PORT="$(sed -n 's/^MAPOS_WEB_PORT=//p' "${MAPOS_RELEASE_ENV}" | tail -n 1)"
MAPOS_COMPOSE_PROJECT="${MAPOS_COMPOSE_PROJECT:-mapos-v3}"
MAPOS_API_PORT="${MAPOS_API_PORT:-4033}"
MAPOS_WEB_PORT="${MAPOS_WEB_PORT:-4032}"
[[ "${MAPOS_COMPOSE_PROJECT}" =~ ^[A-Za-z0-9][A-Za-z0-9_-]*$ ]] || { echo "deploy: invalid compose project" >&2; exit 1; }
[[ "${MAPOS_API_PORT}" =~ ^[0-9]+$ && "${MAPOS_WEB_PORT}" =~ ^[0-9]+$ ]] || { echo "deploy: invalid host ports" >&2; exit 1; }
MAPOS_API_IMAGE="${MAPOS_COMPOSE_PROJECT}-api:latest"
MAPOS_WEB_IMAGE="${MAPOS_COMPOSE_PROJECT}-web:latest"

# Save the exact images currently running. A staged build replaces the implicit :latest tags,
# while the old containers remain live until the atomic cutover.
MAPOS_OLD_API_CONTAINER="$(mapos_current_compose ps -q api)"
MAPOS_OLD_WEB_CONTAINER="$(mapos_current_compose ps -q web)"
MAPOS_OLD_API_IMAGE="$(docker inspect -f '{{.Image}}' "${MAPOS_OLD_API_CONTAINER}")"
MAPOS_OLD_WEB_IMAGE="$(docker inspect -f '{{.Image}}' "${MAPOS_OLD_WEB_CONTAINER}")"
docker image tag "${MAPOS_OLD_API_IMAGE}" "${MAPOS_COMPOSE_PROJECT}-api:rollback-${MAPOS_TAG}"
docker image tag "${MAPOS_OLD_WEB_IMAGE}" "${MAPOS_COMPOSE_PROJECT}-web:rollback-${MAPOS_TAG}"

set +e
(
  set -Eeuo pipefail
  echo "deploy: building staged API and web images while the current release stays live"
  # Two TypeScript builds in parallel exhaust this shared 8 GiB host during other releases.
  # Keep the same staged/rollback flow, but bound peak build memory.
  mapos_release_compose build api
  mapos_release_compose build web
  docker image inspect "${MAPOS_API_IMAGE}" >/dev/null
  docker image inspect "${MAPOS_WEB_IMAGE}" >/dev/null
  # Materialise the European overview pyramid from imported local data before cutover.
  # Persistent volume is shared across releases; this neither downloads providers nor migrates DB.
  mapos_release_compose run --rm --no-deps api node apps/api/dist/geo/warmBoundaryTiles.js </dev/null

  # The API runs its forward migrations before becoming healthy. Take and verify a consistent
  # logical backup immediately before it can start, and preserve the production env alongside it.
  mkdir -m 700 "${MAPOS_BACKUP_DIR}"
  install -m 600 "${MAPOS_CURRENT_ENV}" "${MAPOS_BACKUP_DIR}/infra.env.production"
  # `bash -s` receives this whole rollout over stdin. Docker Compose otherwise forwards and
  # consumes the unread remainder while pg_dump is running, making the SSH session end cleanly
  # before cutover. pg_dump needs no input, so detach it explicitly.
  mapos_current_compose exec -T postgres pg_dump -U mapos -d mapos -Fc </dev/null \
    > "${MAPOS_BACKUP_DIR}/mapos.dump"
  [[ -s "${MAPOS_BACKUP_DIR}/mapos.dump" ]] || { echo "deploy: database backup is empty" >&2; exit 1; }
  mapos_current_compose exec -T postgres pg_restore --list < "${MAPOS_BACKUP_DIR}/mapos.dump" >/dev/null
  sha256sum "${MAPOS_BACKUP_DIR}/mapos.dump" "${MAPOS_BACKUP_DIR}/infra.env.production" \
    > "${MAPOS_BACKUP_DIR}/SHA256SUMS"
  sha256sum -c "${MAPOS_BACKUP_DIR}/SHA256SUMS" >/dev/null

  # A readable archive is not yet a proven backup. Restore it into a uniquely named temporary
  # database, verify the migration ledger and core tables, then remove only that exact database.
  MAPOS_RESTORE_DRILL_DB="mapos_restore_drill_$$"
  MAPOS_CANDIDATE_HEALTH_CONTAINER=""
  mapos_restore_drill_cleanup() {
    if [[ -n "${MAPOS_CANDIDATE_HEALTH_CONTAINER}" ]]; then
      docker rm -f "${MAPOS_CANDIDATE_HEALTH_CONTAINER}" >/dev/null 2>&1 || true
      MAPOS_CANDIDATE_HEALTH_CONTAINER=""
    fi
    mapos_current_compose exec -T postgres dropdb -U mapos --if-exists "${MAPOS_RESTORE_DRILL_DB}" </dev/null >/dev/null 2>&1 || true
  }
  trap mapos_restore_drill_cleanup EXIT
  mapos_restore_drill_cleanup
  mapos_current_compose exec -T postgres createdb -U mapos "${MAPOS_RESTORE_DRILL_DB}" </dev/null
  mapos_current_compose exec -T postgres pg_restore -U mapos -d "${MAPOS_RESTORE_DRILL_DB}" --exit-on-error --no-owner --no-acl </dev/null \
    < "${MAPOS_BACKUP_DIR}/mapos.dump"
  MAPOS_RESTORED_TABLES="$(mapos_current_compose exec -T postgres psql -U mapos -d "${MAPOS_RESTORE_DRILL_DB}" -Atqc \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'" </dev/null)"
  [[ "${MAPOS_RESTORED_TABLES}" =~ ^[0-9]+$ && "${MAPOS_RESTORED_TABLES}" -ge 10 ]]
  mapos_current_compose exec -T postgres psql -U mapos -d "${MAPOS_RESTORE_DRILL_DB}" -Atqc \
    "SELECT 1 FROM mapos_schema_migrations LIMIT 1" </dev/null | grep -qx '1'
  mapos_current_compose exec -T postgres psql -U mapos -d "${MAPOS_RESTORE_DRILL_DB}" -Atqc \
    "SELECT (to_regclass('public.users') IS NOT NULL AND to_regclass('public.sessions') IS NOT NULL)::int" </dev/null | grep -qx '1'
  # Version 0001 adopts the exact v18 bootstrap checksum. Its three historical reconciliation
  # statements are no-ops only when the restored v18 schema already has the removed FK and TEXT
  # quest IDs; assert that precondition before the candidate runs anything.
  mapos_current_compose exec -T postgres psql -U mapos -d "${MAPOS_RESTORE_DRILL_DB}" -Atqc \
    "SELECT (NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quest_completions_quest_id_game_quests_id_fk')
      AND (SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'quest_completions' AND column_name = 'quest_id') = 'text'
      AND (SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'reward_events' AND column_name = 'quest_id') = 'text')::int" </dev/null | grep -qx '1'

  # Prove the candidate against the restored *previous* production state before touching the live
  # database. Running twice is the idempotency gate. The old API image then performs a transactional
  # read/write probe against the expanded schema, which is the executable rollback-compatibility
  # check promised by the upgrade guide. Neither probe starts an HTTP server or an upstream worker.
  MAPOS_DB_PASSWORD="$(sed -n 's/^POSTGRES_PASSWORD=//p' "${MAPOS_RELEASE_ENV}" | tail -n 1)"
  [[ -n "${MAPOS_DB_PASSWORD}" ]]
  MAPOS_CANDIDATE_DRILL_URL="postgres://mapos:${MAPOS_DB_PASSWORD}@postgres:5432/${MAPOS_RESTORE_DRILL_DB}"
  MAPOS_OLD_DRILL_URL="postgres://mapos:${MAPOS_DB_PASSWORD}@127.0.0.1:5432/${MAPOS_RESTORE_DRILL_DB}"
  MAPOS_DB_PROBE='const { randomUUID } = await import("node:crypto"); const database = await import("./apps/api/dist/db/index.js"); await database.initDb(); const id = randomUUID(); await database.sql.begin(async (transaction) => { await transaction.unsafe("INSERT INTO users (id, email, password_hash, display_name, is_guest, xp_total) VALUES ($1, $2, $3, $4, 1, 0)", [id, `restore-drill-${id}@privacy.invalid`, "!restore-drill", "Restore drill"]); const rows = await transaction.unsafe("SELECT display_name FROM users WHERE id = $1", [id]); if (rows.length !== 1 || rows[0].display_name !== "Restore drill") throw new Error("restore drill read/write mismatch"); await transaction.unsafe("DELETE FROM users WHERE id = $1", [id]); }); await database.sql.end();'

  mapos_release_compose run --rm --no-deps \
    -e DATABASE_URL="${MAPOS_CANDIDATE_DRILL_URL}" \
    -e MAPOS_RELEASE="${MAPOS_TAG}-restore-drill" \
    api node --input-type=module -e \
    'const database = await import("./apps/api/dist/db/index.js"); await database.initDb(); await database.initDb(); await database.sql.end();' \
    </dev/null
  mapos_release_compose run --rm --no-deps \
    -e DATABASE_URL="${MAPOS_CANDIDATE_DRILL_URL}" \
    -e MAPOS_RELEASE="${MAPOS_TAG}-restore-drill-probe" \
    api node --input-type=module -e "${MAPOS_DB_PROBE}" \
    </dev/null

  # Exercise the exact production data-rights repository against restored PostgreSQL state. The
  # drill owns isolated fixture UUIDs and verifies portable data deletion plus the legally retained
  # commerce pseudonymisation branch; it never touches the live database.
  mapos_release_compose run --rm --no-deps \
    -e DATABASE_URL="${MAPOS_CANDIDATE_DRILL_URL}" \
    -e MAPOS_RELEASE="${MAPOS_TAG}-data-rights-drill" \
    api node --input-type=module -e \
    'const drill = await import("./apps/api/dist/services/dataRightsPostgresDrill.js"); const database = await import("./apps/api/dist/db/index.js"); try { await drill.runDataRightsPostgresDrill(); } finally { await database.sql.end(); }' \
    </dev/null

  # A compiled module probe is not an HTTP health check. Start the candidate image privately on
  # the existing Docker network, verify its real /health handler, and remove it before cutover.
  MAPOS_CANDIDATE_HEALTH_CONTAINER="mapos-candidate-health-$$"
  mapos_release_compose run -d --no-deps \
    --name "${MAPOS_CANDIDATE_HEALTH_CONTAINER}" \
    -e DATABASE_URL="${MAPOS_CANDIDATE_DRILL_URL}" \
    -e MAPOS_RELEASE="${MAPOS_TAG}-candidate-health" \
    api </dev/null >/dev/null
  MAPOS_CANDIDATE_HEALTH_OK=0
  for MAPOS_CANDIDATE_ATTEMPT in {1..30}; do
    if docker exec "${MAPOS_CANDIDATE_HEALTH_CONTAINER}" node -e \
      'fetch("http://127.0.0.1:4033/health").then(async response => { const body = await response.text(); if (!response.ok || !body.includes("\"status\":\"ok\"")) process.exit(1); }).catch(() => process.exit(1))' \
      >/dev/null 2>&1; then
      MAPOS_CANDIDATE_HEALTH_OK=1
      break
    fi
    [[ "$(docker inspect -f '{{.State.Running}}' "${MAPOS_CANDIDATE_HEALTH_CONTAINER}" 2>/dev/null || true)" == "true" ]] || break
    sleep 2
  done
  [[ "${MAPOS_CANDIDATE_HEALTH_OK}" == "1" ]]
  docker exec "${MAPOS_CANDIDATE_HEALTH_CONTAINER}" node --input-type=module -e \
    'const drill = await import("./apps/api/dist/releaseHttpDrill.js"); await drill.runReleaseHttpDrill(); const aiDrill = await import("./apps/api/dist/services/ai/overviewPostgresDrill.js"); await aiDrill.runOverviewPostgresDrill();'
  docker rm -f "${MAPOS_CANDIDATE_HEALTH_CONTAINER}" >/dev/null
  MAPOS_CANDIDATE_HEALTH_CONTAINER=""

  MAPOS_CANDIDATE_HEALTH_CONTAINER="mapos-candidate-web-health-$$"
  mapos_release_compose run -d --no-deps \
    --name "${MAPOS_CANDIDATE_HEALTH_CONTAINER}" \
    web </dev/null >/dev/null
  MAPOS_CANDIDATE_WEB_HEALTH_OK=0
  for MAPOS_CANDIDATE_ATTEMPT in {1..30}; do
    if docker exec "${MAPOS_CANDIDATE_HEALTH_CONTAINER}" wget -qO- \
      http://127.0.0.1:4032 >/dev/null 2>&1; then
      MAPOS_CANDIDATE_WEB_HEALTH_OK=1
      break
    fi
    [[ "$(docker inspect -f '{{.State.Running}}' "${MAPOS_CANDIDATE_HEALTH_CONTAINER}" 2>/dev/null || true)" == "true" ]] || break
    sleep 2
  done
  [[ "${MAPOS_CANDIDATE_WEB_HEALTH_OK}" == "1" ]]
  docker rm -f "${MAPOS_CANDIDATE_HEALTH_CONTAINER}" >/dev/null
  MAPOS_CANDIDATE_HEALTH_CONTAINER=""

  mapos_current_compose exec -T postgres psql -U mapos -d "${MAPOS_RESTORE_DRILL_DB}" -Atqc \
    "SELECT (
      (SELECT count(*) FROM mapos_schema_migrations WHERE version IN ('0007','0008','0009')) = 3
      AND to_regclass('public.layer_import_previews') IS NOT NULL
      AND (SELECT count(*) FROM pg_index AS idx
        JOIN pg_class AS cls ON cls.oid = idx.indexrelid
        WHERE cls.relname IN ('layer_import_previews_owner_created_idx','layer_import_previews_expiry_idx')
          AND idx.indisvalid) = 2
    )::int" </dev/null | grep -qx '1'
  mapos_current_compose exec -T postgres psql -U mapos -d "${MAPOS_RESTORE_DRILL_DB}" -qAtc \
    "SET enable_seqscan=off; EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT id FROM canonical_places WHERE ST_Intersects(geog, ST_MakeEnvelope(-180,-85,180,85,4326)::geography) LIMIT 100" </dev/null \
    > "${MAPOS_BACKUP_DIR}/POSTGIS_EXPLAIN.json"
  grep -q 'canonical_places_geog_gist' "${MAPOS_BACKUP_DIR}/POSTGIS_EXPLAIN.json"

  MAPOS_POSTGRES_CONTAINER="$(mapos_current_compose ps -q postgres)"
  [[ -n "${MAPOS_POSTGRES_CONTAINER}" ]]
  docker run --rm \
    --network "container:${MAPOS_POSTGRES_CONTAINER}" \
    --env-file "${MAPOS_CURRENT_ENV}" \
    -e DATABASE_URL="${MAPOS_OLD_DRILL_URL}" \
    "${MAPOS_OLD_API_IMAGE}" \
    node --input-type=module -e "${MAPOS_DB_PROBE}" \
    </dev/null
  mapos_restore_drill_cleanup
  trap - EXIT
  printf 'release=%s\nrestored_tables=%s\nlegacy_baseline_precondition=pass\ncandidate_migrations=all-registered-idempotent\ndurable_preview_store=pass\ncandidate_api_http_health=pass\ncandidate_web_http_health=pass\nlayer_import_http_postgres=pass\ndata_rights_postgres=pass\nprevious_image_read_write=pass\nverified_at=%s\n' \
    "${MAPOS_TAG}" "${MAPOS_RESTORED_TABLES}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    > "${MAPOS_BACKUP_DIR}/RESTORE_DRILL.txt"
)
MAPOS_PREPARE_STATUS=$?
set -e

if [[ "${MAPOS_PREPARE_STATUS}" -ne 0 ]]; then
  echo "deploy: staged build or backup failed; restoring the previous image tags" >&2
  set +e
  docker image tag "${MAPOS_OLD_API_IMAGE}" "${MAPOS_API_IMAGE}"
  MAPOS_RESTORE_API_STATUS=$?
  docker image tag "${MAPOS_OLD_WEB_IMAGE}" "${MAPOS_WEB_IMAGE}"
  MAPOS_RESTORE_WEB_STATUS=$?
  set -e
  if [[ "${MAPOS_RESTORE_API_STATUS}" -ne 0 || "${MAPOS_RESTORE_WEB_STATUS}" -ne 0 ]]; then
    echo "deploy: previous containers remain live, but restoring one or more image tags failed" >&2
  fi
  exit "${MAPOS_PREPARE_STATUS}"
fi

echo "deploy: backup verified; switching current atomically"
mapos_atomic_current "releases/${MAPOS_TAG}"
MAPOS_VERIFY_SINCE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

set +e
(
  set -Eeuo pipefail
  # PostgreSQL is recreated only when this release changes its settings (command, shared
  # memory); otherwise Compose leaves the running container alone. Inside the rollback boundary,
  # so a database that does not come back healthy restores the previous release.
  mapos_release_compose up -d --no-build --wait --wait-timeout 180 postgres
  mapos_release_compose up -d --no-build --force-recreate --wait --wait-timeout 180 api web

  MAPOS_API_HEALTH="$(curl -fsS --max-time 10 "http://127.0.0.1:${MAPOS_API_PORT}/health")"
  grep -q '"status":"ok"' <<<"${MAPOS_API_HEALTH}"
  curl -fsS --max-time 10 -o /dev/null "http://127.0.0.1:${MAPOS_WEB_PORT}/"
  MAPOS_WEB_RELEASE="$(curl -fsS --max-time 10 --max-filesize 4096 "http://127.0.0.1:${MAPOS_WEB_PORT}/release.json")"
  mapos_release_compose exec -T api node --input-type=module - "${MAPOS_TAG}" "${MAPOS_API_HEALTH}" "${MAPOS_WEB_RELEASE}" \
    < "${MAPOS_RELEASE_DIR}/scripts/check-release-identity.mjs"

  # Validate the routed public origin inside the rollback boundary too: loopback health alone
  # cannot detect a reverse proxy still pointing to the previous installation.
  MAPOS_PUBLIC_HEALTH="$(curl -fsS --max-time 15 --max-filesize 4096 "https://${MAPOS_PUBLIC_HOST}/api/health")"
  MAPOS_PUBLIC_RELEASE="$(curl -fsS --max-time 15 --max-filesize 4096 "https://${MAPOS_PUBLIC_HOST}/release.json")"
  mapos_release_compose exec -T api node --input-type=module - "${MAPOS_TAG}" "${MAPOS_PUBLIC_HEALTH}" "${MAPOS_PUBLIC_RELEASE}" \
    < "${MAPOS_RELEASE_DIR}/scripts/check-release-identity.mjs"

  MAPOS_BLOCKED_MODEL_STATUS="$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' \
    "http://127.0.0.1:${MAPOS_WEB_PORT}/models/cube-guy-character.glb")"
  [[ "${MAPOS_BLOCKED_MODEL_STATUS}" == "404" ]]

  for MAPOS_SERVICE in postgres api web; do
    MAPOS_CONTAINER_ID="$(mapos_release_compose ps -q "${MAPOS_SERVICE}")"
    [[ -n "${MAPOS_CONTAINER_ID}" ]]
    [[ "$(docker inspect -f '{{.State.Status}}' "${MAPOS_CONTAINER_ID}")" == "running" ]]
    [[ "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "${MAPOS_CONTAINER_ID}")" == "healthy" ]]
    if [[ "${MAPOS_SERVICE}" != "postgres" ]]; then
      [[ "$(docker inspect -f '{{.RestartCount}}' "${MAPOS_CONTAINER_ID}")" == "0" ]]
    fi
  done

  MAPOS_RECENT_LOGS="$(mapos_release_compose logs --since "${MAPOS_VERIFY_SINCE}" --no-color api web 2>&1)"
  if grep -Eiq '(uncaught|unhandled rejection|fatal|migration[^[:cntrl:]]*(failed|error)|database[^[:cntrl:]]*(failed|error))' <<<"${MAPOS_RECENT_LOGS}"; then
    echo "deploy: critical startup pattern found in recent logs" >&2
    exit 1
  fi

  # A small loopback soak records a real-container baseline without spending mobile bandwidth or
  # calling third parties. It is evidence, not an invented SLO: thresholds are set only after a
  # representative stabilisation window.
  MAPOS_HTTP_TIMINGS="${MAPOS_BACKUP_DIR}/HTTP_SOAK.raw"
  : > "${MAPOS_HTTP_TIMINGS}"
  for MAPOS_SOAK_ITERATION in {1..30}; do
    curl -fsS --max-time 10 -o /dev/null -w '%{time_total}\n' "http://127.0.0.1:${MAPOS_API_PORT}/health" >> "${MAPOS_HTTP_TIMINGS}"
    curl -fsS --max-time 10 -o /dev/null -w '%{time_total}\n' "http://127.0.0.1:${MAPOS_API_PORT}/layers" >> "${MAPOS_HTTP_TIMINGS}"
  done
  sort -n "${MAPOS_HTTP_TIMINGS}" > "${MAPOS_HTTP_TIMINGS}.sorted"
  MAPOS_HTTP_COUNT="$(wc -l < "${MAPOS_HTTP_TIMINGS}.sorted" | tr -d '[:space:]')"
  [[ "${MAPOS_HTTP_COUNT}" == "60" ]]
  MAPOS_HTTP_P50="$(awk -v target=30 'NR == target { print; exit }' "${MAPOS_HTTP_TIMINGS}.sorted")"
  MAPOS_HTTP_P95="$(awk -v target=57 'NR == target { print; exit }' "${MAPOS_HTTP_TIMINGS}.sorted")"
  printf 'sample_count=%s\np50_seconds=%s\np95_seconds=%s\nmeasured_at=%s\n' \
    "${MAPOS_HTTP_COUNT}" "${MAPOS_HTTP_P50}" "${MAPOS_HTTP_P95}" \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "${MAPOS_BACKUP_DIR}/HTTP_SOAK.txt"
  rm -f -- "${MAPOS_HTTP_TIMINGS}" "${MAPOS_HTTP_TIMINGS}.sorted"
)
MAPOS_ROLLOUT_STATUS=$?
set -e

if [[ "${MAPOS_ROLLOUT_STATUS}" -ne 0 ]]; then
  mapos_rollback
  exit "${MAPOS_ROLLOUT_STATUS}"
fi

# Housekeeping after a healthy rollout; none of it can fail the deploy.
set +e
# Bulk imports and restores leave tables without planner statistics (pg_restore carries none),
# and the planner then guessed 139 rows for a 242 000-row join. Analyse only tables that were
# never analysed or changed by more than a tenth since.
mapos_release_compose exec -T postgres psql -U mapos -d mapos -v ON_ERROR_STOP=1 -qc \
  "DO \$\$ DECLARE t record; BEGIN
     FOR t IN SELECT schemaname, relname FROM pg_stat_user_tables
       WHERE COALESCE(last_analyze, last_autoanalyze) IS NULL
          OR n_mod_since_analyze > 0.1 * GREATEST(n_live_tup, 1000)
     LOOP EXECUTE format('ANALYZE %I.%I', t.schemaname, t.relname); END LOOP;
   END \$\$" </dev/null ||
  echo "deploy: ANALYZE did not complete (non-fatal)" >&2

# A full disk broke releases on this shared host before. Keep the three newest releases and
# backups (never the live or the previous release), six rollback image tags per service, and
# drop dangling images and week-old build cache.
mapos_prune_dir() {
  local MAPOS_PRUNE_ROOT="$1" MAPOS_PRUNE_ENTRY MAPOS_PRUNE_INDEX=0
  while IFS= read -r MAPOS_PRUNE_ENTRY; do
    MAPOS_PRUNE_INDEX=$((MAPOS_PRUNE_INDEX + 1))
    [[ "${MAPOS_PRUNE_INDEX}" -le 3 ]] && continue
    [[ "${MAPOS_PRUNE_ENTRY}" == "${MAPOS_TAG}" ]] && continue
    [[ "releases/${MAPOS_PRUNE_ENTRY}" == "${MAPOS_PREVIOUS_TARGET}" ]] && continue
    [[ "${MAPOS_REMOTE_DIR}/releases/${MAPOS_PRUNE_ENTRY}" == "${MAPOS_PREVIOUS_TARGET}" ]] && continue
    [[ "${MAPOS_PRUNE_ENTRY}" =~ ^[A-Za-z0-9._-]+$ ]] || continue
    rm -rf -- "${MAPOS_PRUNE_ROOT:?}/${MAPOS_PRUNE_ENTRY}"
  done < <(ls -1t "${MAPOS_PRUNE_ROOT}")
}
mapos_prune_dir "${MAPOS_REMOTE_DIR}/releases"
mapos_prune_dir "${MAPOS_REMOTE_DIR}/backups"
for MAPOS_PRUNE_SERVICE in api web; do
  docker image ls --format '{{.Tag}}' "${MAPOS_COMPOSE_PROJECT}-${MAPOS_PRUNE_SERVICE}" |
    grep '^rollback-' | sort -r | tail -n +7 |
    while IFS= read -r MAPOS_PRUNE_TAG; do
      docker image rm "${MAPOS_COMPOSE_PROJECT}-${MAPOS_PRUNE_SERVICE}:${MAPOS_PRUNE_TAG}" >/dev/null
    done
done
docker image prune -f >/dev/null
docker builder prune -f --filter until=168h >/dev/null
df -h "${MAPOS_REMOTE_DIR}" | tail -n 1
set -e

mapos_release_compose ps
echo "deploy: release ${MAPOS_TAG} is healthy; backup ${MAPOS_BACKUP_DIR} verified"
MAPOS_REMOTE

# A second SSH process is intentional: it cannot share or accidentally consume the rollout
# script's stdin, and prevents a staged-only release from ever being reported as deployed.
ssh -o ServerAliveInterval=15 -o ServerAliveCountMax=4 "${MAPOS_HOST}" "${MAPOS_REMOTE_SHELL[@]}" -s -- "${MAPOS_REMOTE_DIR}" "${MAPOS_TAG}" <<'MAPOS_ACTIVATION_CHECK'
set -Eeuo pipefail
MAPOS_REMOTE_DIR="$1"
MAPOS_TAG="$2"
[[ "$(readlink "${MAPOS_REMOTE_DIR}/current")" == "releases/${MAPOS_TAG}" ]]
MAPOS_ACTIVATION_CHECK

echo "==> Deployed ${MAPOS_TAG} — https://${MAPOS_PUBLIC_HOST}"
echo "    Public smoke checks remain intentionally separate to avoid unnecessary mobile data."
