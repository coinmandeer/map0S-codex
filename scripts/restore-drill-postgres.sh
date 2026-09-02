#!/usr/bin/env bash
set -Eeuo pipefail

MAPOS_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAPOS_PROJECT_DIR="$(cd "${MAPOS_SCRIPT_DIR}/.." && pwd)"
MAPOS_COMPOSE_FILE="${MAPOS_COMPOSE_FILE:-${MAPOS_PROJECT_DIR}/infra/compose.production.yml}"
MAPOS_ENV_FILE="${MAPOS_ENV_FILE:-${MAPOS_PROJECT_DIR}/infra/.env.production}"
MAPOS_BACKUP_FILE="${1:-}"
MAPOS_DRILL_DB="mapos_restore_drill_$$"

fail() {
  echo "restore drill: $*" >&2
  exit 1
}

[[ -f "${MAPOS_BACKUP_FILE}" && -s "${MAPOS_BACKUP_FILE}" ]] || fail "Pass a non-empty pg_dump archive."
[[ -f "${MAPOS_COMPOSE_FILE}" ]] || fail "Missing compose file."
[[ -s "${MAPOS_ENV_FILE}" ]] || fail "Missing production environment file."
[[ "${MAPOS_DRILL_DB}" =~ ^mapos_restore_drill_[0-9]+$ ]] || fail "Unsafe drill database name."

mapos_compose() {
  docker compose -f "${MAPOS_COMPOSE_FILE}" --env-file "${MAPOS_ENV_FILE}" "$@"
}

cleanup() {
  mapos_compose exec -T postgres dropdb -U mapos --if-exists "${MAPOS_DRILL_DB}" </dev/null >/dev/null 2>&1 || true
}
trap cleanup EXIT

mapos_compose exec -T postgres pg_restore --list < "${MAPOS_BACKUP_FILE}" >/dev/null
cleanup
mapos_compose exec -T postgres createdb -U mapos "${MAPOS_DRILL_DB}" </dev/null
mapos_compose exec -T postgres pg_restore -U mapos -d "${MAPOS_DRILL_DB}" --exit-on-error --no-owner --no-acl </dev/null \
  < "${MAPOS_BACKUP_FILE}"

MAPOS_TABLE_COUNT="$(mapos_compose exec -T postgres psql -U mapos -d "${MAPOS_DRILL_DB}" -Atqc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'" </dev/null)"
[[ "${MAPOS_TABLE_COUNT}" =~ ^[0-9]+$ && "${MAPOS_TABLE_COUNT}" -ge 10 ]] ||
  fail "Restored table count is invalid."
mapos_compose exec -T postgres psql -U mapos -d "${MAPOS_DRILL_DB}" -Atqc \
  "SELECT 1 FROM mapos_schema_migrations LIMIT 1" </dev/null | grep -qx '1'
mapos_compose exec -T postgres psql -U mapos -d "${MAPOS_DRILL_DB}" -Atqc \
  "SELECT (to_regclass('public.users') IS NOT NULL AND to_regclass('public.sessions') IS NOT NULL)::int" </dev/null | grep -qx '1'

echo "restore drill: verified ${MAPOS_TABLE_COUNT} public tables in disposable ${MAPOS_DRILL_DB}"
