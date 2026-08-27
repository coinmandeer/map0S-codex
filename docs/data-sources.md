# Data sources

Every layer, place source and info panel in MapOS comes from a public source. This is the list:
what it gives you, what it costs, and what its licence asks of you in return.

Nothing here is required. A fresh clone runs with no keys at all and still gets a basemap, POIs,
weather, six tile overlays, seven data layers, geocaching-style quests and Wikivoyage guides.
Keys only ever add things.

## Where to register

All of these are free and take a few minutes. Put the key in `.env` (see `.env.example`); the
layer appears as soon as the server restarts, and stays hidden until then — a layer gated behind
a key the deployment doesn't hold is not offered at all, which is kinder than a toggle that can
only produce an error.

| Layer / feature          | Sign up at                                        | Env var                  | Notes                                                         |
| ------------------------ | ------------------------------------------------- | ------------------------ | ------------------------------------------------------------- |
| EV charging stations     | https://openchargemap.org/site/develop/api        | `OPENCHARGEMAP_API_KEY`  | Instant key, generous limits                                  |
| Street imagery           | https://www.mapillary.com/dashboard/developers    | `MAPILLARY_ACCESS_TOKEN` | Create an app, copy the client token                          |
| Active fires             | https://firms.modaps.eosdis.nasa.gov/api/map_key/ | `NASA_FIRMS_MAP_KEY`     | Emailed MAP_KEY; 5000 transactions per 10 min                 |
| Air quality stations     | https://explore.openaq.org/register               | `OPENAQ_API_KEY`         | v3 requires the key in an `X-API-Key` header                  |
| Bird sightings           | https://ebird.org/api/keygen                      | `EBIRD_API_TOKEN`        | Needs a (free) eBird account first                            |
| Events + timeline        | https://developer.ticketmaster.com/               | `TICKETMASTER_API_KEY`   | 5000 calls/day; European coverage is uneven                   |
| Geocaching quests        | https://www.opencaching.de/okapi/signup.html      | `OKAPI_KEY_DE` and peers | One key per national instance (DE, PL, NL, UK, US)            |
| Notability ranking       | https://opentripmap.io/product                    | `OPENTRIPMAP_API_KEY`    | Only improves ordering in Objevuj; ranking works without it   |
| Basemap, routing, POI    | https://developer.mapy.com                        | `MAPY_API_KEY`           | Optional alternative provider; 250k credits/month free        |
| Place photos and ratings | https://location.foursquare.com/developer/        | `FSQ_API_KEY`            | Enriches a single place on demand, not bulk search            |
| Weather tile overlays    | https://openweathermap.org/api                    | `OWM_API_KEY`            | Only the tile layers; forecasts come from Open-Meteo, keyless |
| Place summaries (CML)    | https://platform.openai.com / https://ollama.com  | `OPENAI_API_KEY`         | Paid, or `OLLAMA_API_KEY` for the free tier                   |

`MAPOS_CONTACT` is not a key but set it anyway on anything public: Nominatim, Overpass and the
Wikimedia APIs require a `User-Agent` that identifies the deployment, and without one your
traffic shares a rate-limit bucket with every other MapOS clone.

## Keyless sources

These need no registration and are always on.

| Source               | Used for                                | Licence            |
| -------------------- | --------------------------------------- | ------------------ |
| OpenStreetMap        | POIs via Overpass, basemap data         | ODbL 1.0           |
| Nominatim            | Geocoding and reverse geocoding         | ODbL 1.0           |
| OSRM                 | Route planning (public demo server)     | ODbL 1.0           |
| CARTO basemaps       | Default light/dark vector tiles         | Free tier, no key  |
| CyclOSM              | Cycling overlay                         | ODbL / CC-BY-SA    |
| Waymarked Trails     | Hiking, cycling, MTB, piste routes      | CC-BY-SA 3.0       |
| OpenRailwayMap       | Railway overlay                         | CC-BY-SA 2.0       |
| OpenSeaMap           | Nautical marks                          | ODbL 1.0           |
| OpenTopoMap          | Contours and hillshade                  | CC-BY-SA 3.0       |
| OpenSnowMap          | Pistes and cross-country trails         | CC-BY-SA 2.0       |
| USGS                 | Earthquakes                             | Public domain      |
| iNaturalist          | Species observations with photos        | CC-BY-NC (varies)  |
| GBIF                 | Biodiversity occurrence records         | CC-BY 4.0          |
| Sensor.Community     | Citizen air-quality sensors             | ODbL 1.0           |
| Wikimedia Commons    | Geolocated photos                       | CC / public domain |
| Refuge Restrooms     | Accessible and gender-neutral toilets   | Open data          |
| GBFS operator feeds  | Bike and scooter sharing stations       | Per operator       |
| RainViewer           | Weather radar                           | Free tier          |
| Open-Meteo           | Wind grid, forecasts, info panel        | CC-BY 4.0          |
| Wikipedia / Wikidata | Articles, QIDs, place metadata, ranking | CC-BY-SA / CC0     |
| Wikivoyage           | Objevuj guide content                   | CC-BY-SA 4.0       |
| Wiki Loves Monuments | Quests: monuments still missing a photo | CC-BY-SA / CC0     |
| OSM Notes            | Quests: open map problems to verify     | ODbL 1.0           |
| Turf Game            | Quests: existing takeover zones         | Public API         |

## What the licences ask for

Attribution is not optional for most of these. Each layer plugin and place source declares its
`attribution`, and the map's attribution control shows the credits for whatever is currently
switched on (`apps/web/src/layers/attribution.ts`) — so adding a source without filling that
field in is a licensing bug, not a cosmetic one. The full list, on or off, is in
Settings → O aplikaci.

Mapy.com has the one hard display condition beyond a credit string: whenever its tiles are
shown, the Mapy logo control must be visible. `MapCore` binds that control's lifetime to the
provider rather than to the map style so it cannot drift out of sync.

ODbL in particular (OpenStreetMap and everything derived from it) requires that derived
databases stay open. Displaying the data is fine; redistributing a modified extract means
publishing it under ODbL too.

iNaturalist observations are per-observer licensed and many are non-commercial. Treat the layer
as "look, don't rebuild a product on top of it".

## Considered and rejected

Worth recording, so nobody spends an afternoon rediscovering these. The common thread: a fork
inherits the code but not the contract, so anything requiring a signed agreement or bespoke
branding is a bad default even when the data is good.

- **Geocaching.com** — no public API; the partner programme is a waiting list that explicitly
  rejects hobby projects, and imposes branding and feature limits. Opencaching's OKAPI is the
  open alternative and is what the game layer uses.
- **TripAdvisor (Terra)** — 1,000 calls/month free, then paid; signed master terms plus mandatory
  branding (their logo, their exact rating graphics and hex colours) that every fork would ship
  without having agreed to it.
- **Google Places** — usable only on a Google map, which rules it out for a MapLibre app.
- **Yelp Fusion** — thin European coverage; not worth the integration.
- **Munzee** — partner-only API.
- **Ingress / Pokémon GO** — no legal API. Portal and stop locations are scraped data.
- **Strava** — requires a subscription and caps athlete count as of 2026.
- **Komoot / Trailforks / theCrag** — B2B agreements or case-by-case approval only.
- **BikeMaps.org** — a REST API exists (`/incidents.json`, `in_bbox` filtering) but the public
  instance times out or returns 502. Revisit if the service becomes reliable.
- **Overture Maps** — excellent data, but distributed as Parquet for bulk download rather than a
  queryable API. It needs a local import step, which is why the POI source reports itself as
  unavailable rather than pretending to work.

## Checklist for a new source

1. Does the licence permit use in an Apache-2.0 project that anyone can fork and self-host?
2. Does it require branding, a signed agreement, or per-deployment approval? If yes, it belongs
   behind a capability flag at most — never as a default.
3. What attribution string must be displayed? Put it in the plugin's `attribution` field, with
   `url` and `license`, so the map control and the About list pick it up on their own.
4. Does the free tier survive a map that refetches on viewport change? If not, mark the layer
   `viewportCost: "expensive"` so it only loads on explicit request.
5. Add a row to the tables above, and a sign-up line to `.env.example` if it needs a key.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the code side of each extension point: layers,
POI sources, info panels, quest sources and guide sources.
