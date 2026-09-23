#!/usr/bin/env bash
set -Eeuo pipefail

MAPOS_SMOKE_ORIGIN="${1:-https://mapos.promptstudio3000.com}"
if [[ ! "${MAPOS_SMOKE_ORIGIN}" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]]; then
  echo "smoke: expected an exact HTTPS origin without a path" >&2
  exit 2
fi

MAPOS_SMOKE_TMP="$(mktemp -d)"
trap 'rm -rf -- "${MAPOS_SMOKE_TMP}"' EXIT

curl -fsS --max-time 15 -D "${MAPOS_SMOKE_TMP}/web.headers" -o /dev/null \
  "${MAPOS_SMOKE_ORIGIN}/"
grep -Eiq '^content-security-policy:' "${MAPOS_SMOKE_TMP}/web.headers"
grep -Eiq "^content-security-policy:.*script-src[[:space:]]+'self'[[:space:]]*;" \
  "${MAPOS_SMOKE_TMP}/web.headers"
if grep -Eiq "^content-security-policy:.*script-src[^;]*'unsafe-inline'" \
  "${MAPOS_SMOKE_TMP}/web.headers"; then
  echo "smoke: production script-src permits inline scripts" >&2
  exit 1
fi
grep -Eiq "^content-security-policy:.*object-src[[:space:]]+'none'[[:space:]]*;" \
  "${MAPOS_SMOKE_TMP}/web.headers"
grep -Eiq '^content-security-policy:.*report-uri[[:space:]]+/api/security/csp-report' \
  "${MAPOS_SMOKE_TMP}/web.headers"
grep -Eiq '^x-content-type-options:[[:space:]]*nosniff' "${MAPOS_SMOKE_TMP}/web.headers"

curl -fsS --max-time 15 --max-filesize 4096 \
  "${MAPOS_SMOKE_ORIGIN}/api/health" > "${MAPOS_SMOKE_TMP}/health.json"
grep -q '"status":"ok"' "${MAPOS_SMOKE_TMP}/health.json"
curl -fsS --max-time 15 --max-filesize 4096 \
  "${MAPOS_SMOKE_ORIGIN}/release.json" > "${MAPOS_SMOKE_TMP}/release.json"
node "$(dirname "${BASH_SOURCE[0]}")/check-release-identity.mjs" "${2:-}" \
  "$(cat "${MAPOS_SMOKE_TMP}/health.json")" "$(cat "${MAPOS_SMOKE_TMP}/release.json")"

curl -sS --max-time 15 -X OPTIONS -o /dev/null -D "${MAPOS_SMOKE_TMP}/cors.headers" \
  -H 'Origin: https://attacker.invalid' \
  -H 'Access-Control-Request-Method: POST' \
  "${MAPOS_SMOKE_ORIGIN}/api/auth/guest"
if grep -Eiq '^access-control-allow-(origin|credentials):' "${MAPOS_SMOKE_TMP}/cors.headers"; then
  echo "smoke: hostile origin received credentialed CORS headers" >&2
  exit 1
fi

MAPOS_DELETE_STATUS="$(curl -sS --max-time 15 -o "${MAPOS_SMOKE_TMP}/delete.json" -w '%{http_code}' \
  -X DELETE -H "Origin: ${MAPOS_SMOKE_ORIGIN}" -H 'Content-Type: application/json' \
  --data '{"confirmation":"DELETE MY ACCOUNT"}' \
  "${MAPOS_SMOKE_ORIGIN}/api/v2/me")"
[[ "${MAPOS_DELETE_STATUS}" == "401" ]]

MAPOS_OPERATIONS_STATUS="$(curl -sS --max-time 15 -o /dev/null -w '%{http_code}' \
  "${MAPOS_SMOKE_ORIGIN}/api/internal/status")"
[[ "${MAPOS_OPERATIONS_STATUS}" == "401" || "${MAPOS_OPERATIONS_STATUS}" == "404" ]]

printf 'public_web=pass\npublic_health=pass\nsecurity_headers=pass\ncsp_reporting=pass\nhostile_cors=blocked\nunauthenticated_delete=blocked\noperations_endpoint=protected\n'
