# MapOS

An open map engine: a minimal 2D map plus a registry of layers you switch on and off — OSM points
of interest, weather, routes, your own pins, and a 3D quest game rendered over the same viewport.

**It runs with no API keys.** A fresh clone gets a basemap (CARTO), POI search (OpenStreetMap via
Overpass), weather (Open-Meteo) and rain radar (RainViewer) without anyone signing up for
anything. Sources that do need a key announce themselves through `GET /config` and stay hidden
until one is present, so nothing breaks in a keyless install — it just offers less.

## Quick start

```bash
npm install
npm run db:up          # PostGIS on :5434
npm run db:seed        # demo data
npm run dev            # API :4033 + web :5173
```

Demo login: `demo@mapos.test` / `demo1234`.

Optional configuration lives in `.env` (copy from `.env.example`); every entry is optional. See
[docs/environment.md](docs/environment.md) for what each key unlocks.

## Architecture

- `apps/web` — Vite, React and MapLibre
- `apps/api` — Fastify and PostGIS
- `packages/layer-sdk` — the shared contracts: layer plugins, place sources, info panels

The engine is built around three registries, and nearly every feature is a new entry in one of
them rather than a change to the core. [CONTRIBUTING.md](CONTRIBUTING.md) walks through all three
with minimal examples:

1. **Layer plugins** — anything drawn on the map.
2. **Place sources** — anything that answers "what is near this bounding box".
3. **Info panels** — anything shown in the place detail dialog.

## Layers

| ID            | Kind      | Description                              |
| ------------- | --------- | ---------------------------------------- |
| `osm-poi`     | pins      | OSM travel POI (castles, viewpoints…)    |
| `user-layers` | pins      | Your own layers, with an edit mode       |
| `weather`     | raster    | Rain radar, temperature, wind and more   |
| `game`        | custom-gl | 3D quest zones and encounters (Three.js) |

## Tests

```bash
npm run lint
npm run typecheck
npm test           # unit tests
npm run test:e2e   # Playwright, boots the in-memory API — no database needed
```

## Deployment

```bash
DEPLOY_HOST=user@your-server ./scripts/deploy-vps.sh
# or directly:
docker compose -f infra/compose.production.yml up -d --build
```

## Licence

[Apache-2.0](LICENSE).

Map data and imagery belong to their respective providers and carry their own terms — most
notably OpenStreetMap under ODbL and Wikipedia/Wikivoyage under CC BY-SA. Attribution is a licence
condition, not a courtesy: every layer and source declares its own, and the engine aggregates them
into the map's attribution control. [docs/sources.md](docs/sources.md) lists what is integrated and
under which terms.
