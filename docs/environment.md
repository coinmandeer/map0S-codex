# Environment variables

All third-party keys live on `apps/api` and are never shipped to the browser. The frontend
only ever learns _whether_ a provider is configured (via `GET /config`), never the key itself.

Copy `.env.example` → `.env` for local dev, or `infra/.env.production.example` →
`infra/.env.production` for the VPS deploy.

## Core

| Variable        | Required                  | Default              | Used by                                             |
| --------------- | ------------------------- | -------------------- | --------------------------------------------------- |
| `DATABASE_URL`  | yes (except `dev:memory`) | —                    | Drizzle / PostGIS connection                        |
| `PORT`          | no                        | `4033`               | Fastify listen port                                 |
| `RADAR_DIR`     | no                        | `./.radar`           | RainViewer tile archive on disk                     |
| `OVERPASS_URLS` | no                        | three public mirrors | OSM POI fetching                                    |
| `MAPOS_CONTACT` | recommended               | —                    | `User-Agent` sent to Nominatim, Overpass, Wikimedia |

`MAPOS_CONTACT` is worth setting on anything beyond a laptop. Nominatim and the Overpass mirrors
require a `User-Agent` that identifies the deployment and offers a way to make contact; without
one your traffic is indistinguishable from every other MapOS clone and gets rate-limited as a
group.

## Commerce

The provider-neutral catalog, entitlement checks and ledger domain do not require a payment
provider. Checkout is disabled by default and no real provider adapter exists in this release.

| Variable                           | Required                  | Default | Used by                                                     |
| ---------------------------------- | ------------------------- | ------- | ----------------------------------------------------------- |
| `MAPOS_COMMERCE_ENABLED`           | no                        | off     | First checkout gate; `1` is required for any adapter.       |
| `MAPOS_COMMERCE_PROVIDER`          | no                        | `none`  | `none` or `synthetic`; unknown/real values fail startup.    |
| `MAPOS_SYNTHETIC_COMMERCE_ENABLED` | local fixture only        | off     | Second explicit gate for the offline synthetic adapter.     |
| `MAPOS_SYNTHETIC_COMMERCE_SECRET`  | when synthetic is enabled | —       | 32+ character HMAC secret for deterministic local webhooks. |

The synthetic adapter is rejected when `NODE_ENV=production`, even if all flags are present. It
never opens a payment page, moves money or contacts a network. See [`commerce.md`](./commerce.md)
for the provider/use-case gates that remain closed.

## Testing geolocation on a phone

Geolocation only works in a secure context. Opening the dev server on a phone via
`http://192.168.x.x:5173` leaves `navigator.geolocation` present but permanently failing — the
app will tell you so, but the feature cannot work over plain HTTP on a LAN address. Use one of:

- `localhost` on the device itself (works, since localhost counts as secure),
- an HTTPS tunnel to the dev server (`cloudflared tunnel`, `ngrok http 5173`),
- or Vite with a local certificate (`vite --host` plus `@vitejs/plugin-basic-ssl`).

## Map data providers

| Variable            | Required | Default | Used by                                                                                                                                                                             |
| ------------------- | -------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MAPY_API_KEY`      | no       | —       | `mapyService` — tiles, geocode, suggest, routing, elevation. Without it the Mapy.com provider toggle is disabled in Settings and everything falls back to OSM/CARTO/OSRM/Nominatim. |
| `GOLEMIO_API_KEY`   | no       | —       | Prague open-data layers (`golemio-*`). Sent as `X-Access-Token`; without it the layers are listed under "Needs setup".                                                              |
| `EUROPEANA_API_KEY` | no       | —       | The `europeana` cultural-records layer (Search API `wskey`).                                                                                                                        |

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

| Variable              | Required | Default | Used by                                                                                                      |
| --------------------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------ |
| `VITE_API_BASE_URL`   | no       | `/api`  | Baked into the web bundle at build time; the single source of truth is `apps/web/src/lib/api.ts`             |
| `VITE_MAP_RUNTIME_V2` | no       | enabled | Set to `0`/`false` to roll MapOS back to direct layer handles while retaining the same registry data and UI. |
