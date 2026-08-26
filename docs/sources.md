# Data sources

Every source MapOS talks to, what it needs, and what it obliges us to display. Adding a source
means taking on its licence — see the checklist at the bottom before integrating a new one.

## Keyless (work in a fresh clone)

| Source                   | Used for                     | Licence / terms                    | Attribution required                 |
| ------------------------ | ---------------------------- | ---------------------------------- | ------------------------------------ |
| OpenStreetMap (Overpass) | POI search                   | ODbL 1.0                           | Yes — "© OpenStreetMap contributors" |
| Nominatim                | Geocoding, reverse geocode   | ODbL 1.0, usage policy applies     | Yes                                  |
| CARTO basemaps           | Vector basemap style         | Free tier, attribution required    | Yes — "© CARTO"                      |
| Open-Meteo               | Weather grids                | CC BY 4.0, free for non-commercial | Yes                                  |
| RainViewer               | Rain radar tiles             | Free tier                          | Yes                                  |
| Wikipedia / Wikidata     | Place articles, QIDs, photos | CC BY-SA 4.0 / CC0                 | Yes for Wikipedia text               |
| OSRM                     | Route planning               | Public demo server, best effort    | Yes                                  |

Nominatim and the Overpass mirrors both enforce a usage policy that requires an identifying
`User-Agent`. Set `MAPOS_CONTACT` in `.env` before running anything at volume, otherwise your
traffic is indistinguishable from every other clone and gets throttled as a group.

## Keyed (optional, hidden without a key)

| Source         | Env var          | Free tier          | Where to register                 |
| -------------- | ---------------- | ------------------ | --------------------------------- |
| Mapy.com       | `MAPY_API_KEY`   | 250k credits/month | developer.mapy.com                |
| OpenWeatherMap | `OWM_API_KEY`    | Limited free tier  | openweathermap.org/api            |
| Foursquare     | `FSQ_API_KEY`    | Limited free tier  | location.foursquare.com/developer |
| OpenAI         | `OPENAI_API_KEY` | Paid               | platform.openai.com               |
| Ollama Cloud   | `OLLAMA_API_KEY` | Free tier          | ollama.com                        |

Mapy.com is the one source with a hard display condition: whenever its tiles are shown, the Mapy
logo control must be visible. That is enforced in `MapCore` by binding the control's lifetime to
the provider rather than to the map style.

## Deliberately not integrated

Some well-known sources look attractive and are a poor fit for a forkable Apache-2.0 project. The
common thread: the fork inherits the code but not the contract.

- **Google Places** — terms require results to be displayed on a Google map.
- **TripAdvisor (Terra)** — 1,000 calls/month free, then paid; signed master terms plus mandatory
  branding (their logo, their exact rating graphics and hex colours) that every fork would ship
  without having agreed to it.
- **Geocaching.com** — partner programme is a waiting list that explicitly rejects small projects,
  and imposes branding plus feature limits for non-premium users. Use Opencaching instead.
- **Munzee** — API restricted to approved partners.
- **Yelp Fusion** — weak European coverage.
- **Strava** — requires a subscription and caps athlete count as of 2026.
- **Komoot / Trailforks / theCrag** — B2B agreements or case-by-case approval only.

## Checklist for a new source

1. Does the licence permit use in an Apache-2.0 project that anyone can fork and self-host?
2. Does it require branding, a signed agreement, or per-deployment approval? If yes, it belongs
   behind a capability flag at most — never as a default.
3. What attribution string must be displayed? Add it to the adapter's `attribution` field.
4. Does the free tier survive a map that refetches on viewport change? If not, mark the layer
   `viewportCost: "expensive"` so it only loads on explicit request.
5. Add a row to the tables above.
