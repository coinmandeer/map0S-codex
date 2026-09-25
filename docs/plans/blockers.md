# Operator blockers

Working copy of §22 of the redesign plan, tracked so implementation can see at a glance which
external accounts are still missing. Everything not listed here is keyless or solvable in code.

Status values: **open** (nobody has started), **waiting** (requested, no credentials yet),
**done** (credential is in `.env` and verified).

## AI

| #   | Item                                                   | Status   | Notes                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 33  | Ollama Cloud key                                       | **done** | Supplied 2 Sep 2026, verified against `GET /v1/models` (19 models reachable, tool calling, `web_search`, `web_fetch`). Written to the repo-root `.env` together with `MAPOS_AI_GATEWAY_ENABLED=1`, `CML_PROVIDER=ollama`, `OLLAMA_MODEL_FAST=glm-5.3-flash`, `OLLAMA_MODEL_STRONG=deepseek-v4-pro:0813`. **Rotate it** at ollama.com › Settings › Keys once deployed — it travelled over chat. |
| 34  | Daily token budget per account and a monthly spend cap | open     | Plan assumes 200k tokens/account/day (§30.9).                                                                                                                                                                                                                                                                                                                                                  |

## Game sources

| #   | Item                                                              | Status | Notes                                                                                            |
| --- | ----------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------ |
| 1   | OKAPI consumer keys per node → `OKAPI_KEY_{DE,PL,NL,US,RO,UK}`    | open   | `opencaching.de/okapi/signup.html` covers .it/.fr too. Geocaches degrade to hidden without them. |
| 2   | OSM OAuth2 application, scopes `read_prefs write_notes write_api` | open   | Needed for OSM login, Note replies and writing "fill in data" quests.                            |
| 3   | Wikimedia OAuth consumer                                          | open   | Photo upload to Commons from quests.                                                             |
| 4   | Panoramax account (or a decision to self-host)                    | open   | Upload path only; reading is keyless.                                                            |
| 5   | iNaturalist OAuth app                                             | open   | Only if we write observations back.                                                              |
| 6   | POAP API key                                                      | open   | Optional.                                                                                        |
| 7   | Verify whether opencaching.cz is still alive                      | open   | Likely to be dropped.                                                                            |

## Routes and watches

| #   | Item                                                                | Status | Notes                                                                                                                      |
| --- | ------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------- |
| 8   | Polar AccessLink client → `POLAR_CLIENT_ID` / `POLAR_CLIENT_SECRET` | open   | admin.polaraccesslink.com                                                                                                  |
| 9   | Strava tier decision                                                | open   | Standard Tier needs a paid developer subscription and caps at 10 users. Recommendation: ship a "export GPX" guide instead. |
| 10  | Garmin / Suunto / Coros / Apple                                     | n/a    | No individual API; documentation only.                                                                                     |

## Layers and basemaps

| #   | Item                                                                                            | Status | Notes                                                          |
| --- | ----------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------- |
| 11  | Golemio API key                                                                                 | open   | Live transit, parking, cameras. api.golemio.cz/api-keys        |
| 12  | aisstream.io key, OpenSky account                                                               | open   | Ships; aircraft work keyless via adsb.lol at lower limits.     |
| 13  | Tankerkönig, Wheelmap, Meteoalarm EDR token                                                     | open   | Meteoalarm Atom feed works without a token.                    |
| 14  | Foursquare Places Portal token                                                                  | open   | Check whether the OS Places PMTiles need one at all.           |
| 15  | Google Maps Platform key with billing                                                           | open   | Tiles and 3D Tiles. Needs a budget decision and a daily quota. |
| 16  | mapakriminality.cz API access                                                                   | open   | CC BY-NC-SA, request required.                                 |
| 17  | Verify machine access: ČTÚ coverage, ČHMÚ ISKO index JSON, CzechInvest brownfields, Kudy z nudy | open   |                                                                |
| 18  | Copernicus Data Space account, HDX account                                                      | open   | Sentinel STAC/COG, Kontur download.                            |
| 19  | GoOut partner request                                                                           | open   | Ticketmaster key already exists.                               |

## Infrastructure

| #   | Item                                                                                      | Status   | Notes                                                                                                   |
| --- | ----------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------- |
| 20  | Object storage (S3 / Cloudflare R2) + CDN, Redis                                          | open     | Media, PMTiles, cache, pub/sub.                                                                         |
| 21  | ~~Search API for AI~~                                                                     | **done** | Resolved by Ollama Cloud `web_search` / `web_fetch` (§30.2). Brave/SearXNG remain an optional fallback. |
| 22  | VAPID keys for web push; domain + HTTPS for ActivityPub/SIWE                              | open     | VAPID pair can be generated locally.                                                                    |
| 23  | GitHub bot token for automatic PRs into `layer-catalog`                                   | open     |                                                                                                         |
| 24  | Overture/FSQ import decision: where the DuckDB/tippecanoe job runs and how much territory | open     | Local vs. CI, CZ+neighbours vs. all of EU.                                                              |

## Wallet and game (§24, §28)

| #   | Item                                                             | Status | Notes                                                                                                                                                 |
| --- | ---------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 25  | Reown (WalletConnect) Cloud project ID → `VITE_REOWN_PROJECT_ID` | open   | Free. Without it AppKit cannot reach mobile wallets; browser extensions still work.                                                                   |
| 26  | Base and Ethereum mainnet RPC → `BASE_RPC_URL`, `ETH_RPC_URL`    | open   | Free tier at Alchemy/Infura/QuickNode, or the rate-limited public `https://mainnet.base.org`.                                                         |
| 27  | Goldsky subgraph rate limit for `aavegotchi-core-base`           | open   | Public URL exists; own Goldsky project for higher limits.                                                                                             |
| 28  | Aavegotchi renderer API access                                   | open   | Check whether `aavegotchi.com/api/renderer/batch` needs a key or whitelisting; contact Pixelcraft if bulk GLB rendering is blocked.                   |
| 29  | Licences for the 29 GLB models in `questlayer-models.zip`        | open   | Confirm provenance (Cube World Kit?), fill in `ASSET_LICENSES.md`, and pull CC0 Kenney/Quaternius sets to replace anything unconfirmed.               |
| 30  | Staked-asset decision for phase F-B                              | open   | GHST on Base vs. ETH vs. a stablecoin, and whether F-C (own contract, audit, legal review of "staking rewards" under CZ/EU rules) is in scope at all. |
| 31  | Push notifications for events                                    | open   | VAPID (item 22) plus a decision on a Capacitor wrapper for background geolocation, which needs App Store / Play accounts.                             |
| 32  | Test wallet holding an Aavegotchi on Base                        | open   | Needed for e2e outside the fixture. Also confirm `coinmandeer.eth` has an `avatar` record, otherwise the headshot fallback applies.                   |
