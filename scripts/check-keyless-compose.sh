#!/usr/bin/env bash
set -Eeuo pipefail

MAPOS_COMPOSE_TMP="$(mktemp)"
trap 'rm -f -- "${MAPOS_COMPOSE_TMP}"' EXIT

POSTGRES_PASSWORD=keyless-compose-fixture \
MAPOS_RATE_LIMIT_SECRET=0123456789abcdef0123456789abcdef \
OWM_API_KEY= \
FSQ_API_KEY= \
OPENAI_API_KEY= \
MAPY_API_KEY= \
WINDY_API_KEY= \
OLLAMA_API_KEY= \
docker compose -f infra/compose.production.yml config --format json > "${MAPOS_COMPOSE_TMP}"

node --input-type=module - "${MAPOS_COMPOSE_TMP}" <<'NODE'
import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync(process.argv[2], "utf8"));
const environment = config.services?.api?.environment ?? {};
for (const key of [
  "OWM_API_KEY",
  "FSQ_API_KEY",
  "OPENAI_API_KEY",
  "MAPY_API_KEY",
  "WINDY_API_KEY",
  "OLLAMA_API_KEY"
]) {
  if (environment[key] !== "" && environment[key] !== null) {
    throw new Error(`keyless compose: ${key} became non-empty`);
  }
}
NODE

echo "Keyless production Compose configuration passed."
