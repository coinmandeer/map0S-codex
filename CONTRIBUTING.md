# Contributing to MapOS

MapOS is a map engine: a shell that renders overlays, and a set of registries you plug things
into. Almost every contribution is one of three shapes, and each one is a single new file plus a
single registration line. If you find yourself editing `LayerEngine.ts` to add a data source,
something has gone wrong — open an issue instead, because that means the contract is missing
something.

## Getting set up

```bash
npm install
cp .env.example .env      # everything in it is optional
npm run dev               # api on :4033, web on :5173
```

A fresh clone with an empty `.env` is a supported configuration. The basemap (CARTO), POI search
(OpenStreetMap via Overpass), weather (Open-Meteo) and radar (RainViewer) all work without a
single API key. Sources that need a key advertise themselves through `GET /config` and are hidden
in the UI when the key is absent — so never make a keyless feature depend on a keyed one.

For the test suite:

```bash
npm run typecheck
npm run test              # unit tests (node:test)
npm run test:e2e          # Playwright, boots the in-memory API
```

`npm run test` and `npm run test:e2e` must both pass before a pull request is reviewed. CI runs
exactly these commands.

## Extension point 1: adding a map layer

Layers are plugins. Create one file under `apps/web/src/layers/` that exports a `LayerPlugin`,
then register it in `apps/web/src/layers/catalog.ts`.

For anything tile-shaped, the factory does the work and your file is pure configuration:

```ts
import { createTileLayer } from "./factories/tileLayer";
import type { LayerPlugin } from "@mapos/layer-sdk";

export const cyclosmPlugin: LayerPlugin = {
  manifest: { id: "cyclosm", name: "Cyklomapa", category: "outdoor", kind: "tiles" },
  viewportCost: "cheap",
  attribution: "© OpenStreetMap contributors, tiles CyclOSM",
  create: async () =>
    createTileLayer({
      tiles: ["https://a.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png"],
      maxzoom: 20
    })
};
```

`viewportCost` is the one field worth thinking about. Tiles are `cheap` and refresh on every map
move. Anything that hits a rate-limited upstream (Overpass, and most third-party APIs) is
`expensive` and only refetches when the user presses "Search here" — this is what keeps a panning
user from firing sixty Overpass queries a minute.

`attribution` is mandatory, and for ODbL, CC-BY-SA or CDLA sources it is a licence obligation
rather than a courtesy. The engine aggregates every active layer's attribution into the map
control automatically.

## Extension point 2: adding a POI source

POI sources are merged into one deduplicated set of places. Create an adapter under
`apps/api/src/sources/` and register it:

```ts
export const openTripMapAdapter: PlaceSourceAdapter = {
  id: "opentripmap",
  confidence: 0.6,
  unavailableReason: () => (config.openTripMapKey ? null : "OPENTRIPMAP_API_KEY not set"),
  async fetch({ bbox, signal }) {
    /* ... return Place[] ... */
  }
};
```

Three rules that matter more than they look:

- **Never throw.** A failing source must return `[]` and let the other sources answer. One dead
  upstream should degrade the result, not blank the map.
- **Return a `sourceRef`** on every place (`osm:12345`, `wikidata:Q42`). It is what deduplication
  joins on and what the info engine deep-links with.
- **Declare `unavailableReason()`** when the source needs a key, so it is skipped cleanly with a
  visible explanation instead of failing at request time.

`confidence` decides which source wins a field when two of them disagree about the same place.

## Extension point 3: adding an info panel

The place detail dialog is a tab bar over a registry of panels. A panel declares when it applies
and what kind of content it is:

```ts
export const wikipediaPanel: InfoPanelDescriptor = {
  id: "wikipedia",
  label: "Wikipedie",
  icon: "book",
  kind: "iframe",
  appliesTo: ({ refs }) => Boolean(refs.wikipedia),
  attribution: "Wikipedia, CC BY-SA 4.0"
};
```

`appliesTo` keeps the tab bar honest: a panel that has nothing to show must not offer itself, so
users never click a tab and find an empty box.

There are three `kind`s, and picking the right one is mostly about someone else's HTTP headers.
`api` fetches JSON and renders it with our own components. `iframe` embeds the source directly,
which only works when the site permits it — Wikipedia, OpenStreetMap, Mapillary and Windy do;
Google Maps, Foursquare and Komoot send `X-Frame-Options: SAMEORIGIN` and cannot be framed. When
in doubt, the server probe at `GET /info/embeddable?url=` gives you the verdict. `link` is the
honest fallback for the rest, and every new iframe host must also be added to the CSP `frame-src`
allowlist or the browser will block it.

## Extension point 4: adding a quest source

The game does not invent locations any more: a quest is anchored to a real place supplied by a
`QuestSourceAdapter` (`apps/api/src/game/anchors.ts`). An adapter answers two questions — what is
in this viewport, and where exactly is this one anchor:

```ts
registerQuestSource({
  id: "opencaching",
  label: "Opencaching",
  attribution: "Opencaching, CC-BY-SA",
  unavailableReason: () => (config.okapiInstances.length ? null : "Chybí OKAPI klíč"),
  anchors: (bbox, limit) => nearbyCaches(bbox, limit),
  resolve: (ref) => oneCache(ref)
});
```

Quest ids are derived from `sourceId` plus the anchor's own ref, so no database row is written
until someone completes one. `resolve` matters more than it looks: a claim is verified against
the coordinates the adapter returns, never against the ones the client sent, so a source that
cannot resolve a single anchor cannot be used for claimable quests.

## Extension point 5: adding a guide source

Objevuj asks for editorial content by _area_ rather than by bounding box, because "what to do in
Brno" is an article about a place, not a query over points. A `GuideSourceAdapter`
(`packages/layer-sdk/src/guide.ts`) turns an area into sections:

```ts
registerGuideSource({
  id: "wikivoyage",
  label: "Wikivoyage",
  attribution: "Wikivoyage, CC BY-SA 4.0",
  fetchGuide: async (area, lang) => ({ sections: await sectionsFor(area, lang) })
});
```

Sources are tried in order until one returns something, so a new adapter is a fallback rather
than a replacement, and a fork can put a local tourist board ahead of Wikivoyage.

## Code conventions

- TypeScript everywhere, no `any` in new code.
- Comments explain _why_, never _what_. If a line needs a comment to say what it does, rename
  something instead. Constraints, trade-offs and non-obvious upstream behaviour are worth writing
  down; narration is not.
- Unit tests use `node:test`; anything with a pure core (spawning, parsing, dedup, ranking) should
  have its core tested directly rather than through the HTTP layer.
- Run `npm run lint` and `npm run format` before pushing.

## Data sources and licences

Adding a source means taking on its licence. Before opening a pull request, check that the terms
allow use in an Apache-2.0 project that anyone may fork and self-host. Sources requiring mandatory
branding, signed agreements, or per-deployment approval are a poor fit — the fork inherits the
code but not your contract. [docs/data-sources.md](docs/data-sources.md) lists what is currently
integrated, under which licence, what attribution each one requires, and which well-known sources
were rejected and why.

Attribution is wired, not written: put `label`, `url` and `license` in the plugin's or adapter's
`attribution` field and both the map's attribution control and Settings → O aplikaci pick it up.
A source credited only in a comment is a licensing bug.
