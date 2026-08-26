# Environment variables

All third-party keys live on `apps/api` and are never shipped to the browser. The frontend
only ever learns _whether_ a provider is configured (via `GET /config`), never the key itself.

Copy `.env.example` → `.env` for local dev, or `infra/.env.production.example` →
`infra/.env.production` for the VPS deploy.

## Core

| Variable        | Required                  | Default              | Used by                         |
| --------------- | ------------------------- | -------------------- | ------------------------------- |
| `DATABASE_URL`  | yes (except `dev:memory`) | —                    | Drizzle / PostGIS connection    |
| `PORT`          | no                        | `4033`               | Fastify listen port             |
| `RADAR_DIR`     | no                        | `./.radar`           | RainViewer tile archive on disk |
| `OVERPASS_URLS` | no                        | three public mirrors | OSM POI fetching                |

## Map data providers

| Variable       | Required | Default | Used by                                                                                                                                                                             |
| -------------- | -------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MAPY_API_KEY` | no       | —       | `mapyService` — tiles, geocode, suggest, routing, elevation. Without it the Mapy.com provider toggle is disabled in Settings and everything falls back to OSM/CARTO/OSRM/Nominatim. |

Mapy.com Basic plan gives 250k credits/month for free. Credits are consumed per request
type (tiles are the cheapest, routing the most expensive), so `mapyPoiService` caches
aggressively and rate-limits its keyword fan-out.

## Weather

| Variable        | Required | Default | Used by                                                                                                                         |
| --------------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `OWM_API_KEY`   | no       | —       | OpenWeatherMap tile overlays (precipitation, temp, wind, clouds, pressure). Without it only the RainViewer radar archive works. |
| `WINDY_API_KEY` | no       | —       | Reserved slot for Windy's Map Forecast tiles. Unset = wind particles are driven by Open-Meteo, which needs no key.              |

## CML (the AI layer)

| Variable          | Required                  | Default                 | Used by                                                                           |
| ----------------- | ------------------------- | ----------------------- | --------------------------------------------------------------------------------- |
| `CML_PROVIDER`    | no                        | `ollama`                | `ollama` \| `openai` \| `none`. `none` forces the deterministic non-AI fallbacks. |
| `OLLAMA_BASE_URL` | no                        | `https://ollama.com/v1` | Ollama Cloud's OpenAI-compatible endpoint                                         |
| `OLLAMA_API_KEY`  | when provider is `ollama` | —                       | Ollama Cloud key                                                                  |
| `OLLAMA_MODEL`    | no                        | `deepseek-v3.1:671b`    | Model id passed through to Ollama                                                 |
| `OPENAI_API_KEY`  | when provider is `openai` | —                       | OpenAI key                                                                        |
| `OPENAI_MODEL`    | no                        | `gpt-4o-mini`           | OpenAI model id                                                                   |

Every CML endpoint degrades gracefully: with no provider configured (or on an upstream
error) it returns a deterministic, non-AI answer built from local data rather than failing.

## Optional enrichment

| Variable      | Required | Default | Used by                                                    |
| ------------- | -------- | ------- | ---------------------------------------------------------- |
| `FSQ_API_KEY` | no       | —       | Foursquare place enrichment: address, rating, photos, tips |

## Frontend build args

| Variable            | Required | Default | Used by                                                                                          |
| ------------------- | -------- | ------- | ------------------------------------------------------------------------------------------------ |
| `VITE_API_BASE_URL` | no       | `/api`  | Baked into the web bundle at build time; the single source of truth is `apps/web/src/lib/api.ts` |
