#!/usr/bin/env bash
set -Eeuo pipefail

MAPOS_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAPOS_PROJECT_DIR="$(cd "${MAPOS_SCRIPT_DIR}/.." && pwd)"
MAPOS_COMPOSE_FILE="${MAPOS_COMPOSE_FILE:-${MAPOS_PROJECT_DIR}/infra/compose.production.yml}"
MAPOS_ENV_FILE="${MAPOS_ENV_FILE:-${MAPOS_PROJECT_DIR}/infra/.env.production}"
MAPOS_BACKUP_DIR="${1:-}"

fail() {
  echo "backup: $*" >&2
  exit 1
}

[[ -n "${MAPOS_BACKUP_DIR}" ]] || fail "Pass an explicit release-specific backup directory."
[[ "${MAPOS_BACKUP_DIR}" == /* && "${MAPOS_BACKUP_DIR}" != "/" && "${MAPOS_BACKUP_DIR}" != *".."* ]] ||
  fail "Backup directory must be a safe absolute path."
[[ -f "${MAPOS_COMPOSE_FILE}" ]] || fail "Missing compose file."
[[ -s "${MAPOS_ENV_FILE}" ]] || fail "Missing production environment file."
[[ ! -e "${MAPOS_BACKUP_DIR}" ]] || fail "Backup target already exists."

umask 077
mkdir -p "$(dirname "${MAPOS_BACKUP_DIR}")"
mkdir "${MAPOS_BACKUP_DIR}"

mapos_compose() {
  docker compose -f "${MAPOS_COMPOSE_FILE}" --env-file "${MAPOS_ENV_FILE}" "$@"
}

mapos_compose exec -T postgres pg_dump -U mapos -d mapos -Fc </dev/null \
  > "${MAPOS_BACKUP_DIR}/mapos.dump"
[[ -s "${MAPOS_BACKUP_DIR}/mapos.dump" ]] || fail "Database backup is empty."
mapos_compose exec -T postgres pg_restore --list < "${MAPOS_BACKUP_DIR}/mapos.dump" >/dev/null
sha256sum "${MAPOS_BACKUP_DIR}/mapos.dump" > "${MAPOS_BACKUP_DIR}/SHA256SUMS"
sha256sum -c "${MAPOS_BACKUP_DIR}/SHA256SUMS" >/dev/null
printf 'created_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "${MAPOS_BACKUP_DIR}/BACKUP.txt"
echo "backup: verified ${MAPOS_BACKUP_DIR}"
