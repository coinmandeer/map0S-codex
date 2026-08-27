# Data sources

Every layer in MapOS comes from a public source. This is the list: what it gives you, what it
costs, and what its licence asks of you in return.

Nothing here is required. A fresh clone runs with no keys at all and still gets a basemap,
POIs, weather, six tile overlays and seven data layers. Keys only ever add layers.

## Where to register

All of these are free and take a few minutes. Put the key in `.env` (see `.env.example`); the
layer appears as soon as the server restarts, and stays hidden until then.

| Layer                    | Sign up at                                        | Env var                  | Notes                                                         |
| ------------------------ | ------------------------------------------------- | ------------------------ | ------------------------------------------------------------- |
| EV charging stations     | https://openchargemap.org/site/develop/api        | `OPENCHARGEMAP_API_KEY`  | Instant key, generous limits                                  |
| Street imagery           | https://www.mapillary.com/dashboard/developers    | `MAPILLARY_ACCESS_TOKEN` | Create an app, copy the client token                          |
| Active fires             | https://firms.modaps.eosdis.nasa.gov/api/map_key/ | `NASA_FIRMS_MAP_KEY`     | Emailed MAP_KEY; 5000 transactions per 10 min                 |
| Air quality stations     | https://explore.openaq.org/register               | `OPENAQ_API_KEY`         | v3 requires the key in an `X-API-Key` header                  |
| Bird sightings           | https://ebird.org/api/keygen                      | `EBIRD_API_TOKEN`        | Needs a (free) eBird account first                            |
| Events                   | https://developer.ticketmaster.com/               | `TICKETMASTER_API_KEY`   | 5000 calls/day; European coverage is uneven                   |
| Basemap, routing, POI    | https://developer.mapy.com                        | `MAPY_API_KEY`           | Optional alternative provider; 250k credits/month free        |
| Place photos and ratings | https://location.foursquare.com/developer/        | `FSQ_API_KEY`            | Enriches a single place on demand, not bulk search            |
| Weather tile overlays    | https://openweathermap.org/api                    | `OWM_API_KEY`            | Only the tile layers; forecasts come from Open-Meteo, keyless |

`MAPOS_CONTACT` is not a key but set it anyway on anything public: Nominatim, Overpass and the
Wikimedia APIs require a `User-Agent` that identifies the deployment, and without one your
traffic shares a rate-limit bucket with every other MapOS clone.

## Keyless sources

These need no registration and are always on.

| Source               | Used for                              | Licence            |
| -------------------- | ------------------------------------- | ------------------ |
| OpenStreetMap        | POIs via Overpass, basemap data       | ODbL 1.0           |
| CARTO basemaps       | Default light/dark vector tiles       | Free tier, no key  |
| CyclOSM              | Cycling overlay                       | ODbL / CC-BY-SA    |
| Waymarked Trails     | Hiking, cycling, MTB, piste routes    | CC-BY-SA 3.0       |
| OpenRailwayMap       | Railway overlay                       | CC-BY-SA 2.0       |
| OpenSeaMap           | Nautical marks                        | ODbL 1.0           |
| OpenTopoMap          | Contours and hillshade                | CC-BY-SA 3.0       |
| OpenSnowMap          | Pistes and cross-country trails       | CC-BY-SA 2.0       |
| USGS                 | Earthquakes                           | Public domain      |
| iNaturalist          | Species observations with photos      | CC-BY-NC (varies)  |
| GBIF                 | Biodiversity occurrence records       | CC-BY 4.0          |
| Sensor.Community     | Citizen air-quality sensors           | ODbL 1.0           |
| Wikimedia Commons    | Geolocated photos                     | CC / public domain |
| Refuge Restrooms     | Accessible and gender-neutral toilets | Open data          |
| GBFS operator feeds  | Bike and scooter sharing stations     | Per operator       |
| RainViewer           | Weather radar                         | Free tier          |
| Open-Meteo           | Wind grid and forecasts               | CC-BY 4.0          |
| Wikipedia / Wikidata | Articles, QIDs, place metadata        | CC-BY-SA / CC0     |

## What the licences ask for

Attribution is not optional for most of these. Each layer plugin declares its `attribution`,
and the map's attribution control shows the credits for whatever is currently switched on —
so adding a layer without filling that field in is a licensing bug, not a cosmetic one.

ODbL in particular (OpenStreetMap and everything derived from it) requires that derived
databases stay open. Displaying the data is fine; redistributing a modified extract means
publishing it under ODbL too.

iNaturalist observations are per-observer licensed and many are non-commercial. Treat the
layer as "look, don't rebuild a product on top of it".

## Considered and rejected

Worth recording, so nobody spends an afternoon rediscovering these.

- **Geocaching.com** — no public API; the partner programme is closed to hobby projects.
  Opencaching's OKAPI is the open alternative and is what the game layer uses.
- **TripAdvisor** — the Content API is expensive at any real volume, and its terms require
  their branding and rating imagery to be shown alongside the data.
- **Google Places** — usable only on a Google map, which rules it out for a MapLibre app.
- **Yelp** — thin European coverage; not worth the integration.
- **Munzee** — partner-only API.
- **Ingress / Pokémon GO** — no legal API. Portal and stop locations are scraped data.
- **BikeMaps.org** — a REST API exists (`/incidents.json`, `in_bbox` filtering) but the public
  instance times out or returns 502. Revisit if the service becomes reliable.
- **Overture Maps** — excellent data, but distributed as Parquet for bulk download rather than
  a queryable API. It needs a local import step, which is why the POI source reports itself as
  unavailable rather than pretending to work.
