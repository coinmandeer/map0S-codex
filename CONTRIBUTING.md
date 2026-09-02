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

`npm run test` and `npm run test:e2e` must both pass before a pull request is reviewed. CI also runs
lint/format/type/build, contract, migration, privacy, load, offline, accessibility and clean-room
runtime gates.

## Extension point 1: adding a map layer

External/data-only layers should start with the public SDK scaffold in
`docs/public-layer-sdk-v2.md`; they are installed through the validated package/import boundary and
do not edit the mode UI. A reviewed first-party renderer lives under `apps/web/src/layers/` and
registers itself with `registerLayer` or `registerLayerV2` from `layers/registry.ts`. Add its
side-effect import to `layers/builtins.ts` (or to an existing plugin group such as
`layers/plugins/tileLayers.ts`).

For anything tile-shaped, the factory does the work and your file is pure configuration:

```ts
import { registerLayer } from "../registry";
import { createTileLayer } from "../tileLayer";

registerLayer({
  kind: "raster",
  manifest: {
    id: "cyclosm",
    name: "Cyklomapa",
    icon: "bike",
    color: "#7c3aed",
    description: "Cyklistické trasy",
    category: "outdoor"
  },
  attribution: [
    {
      label: "CyclOSM / OpenStreetMap contributors",
      url: "https://www.cyclosm.org/",
      license: "ODbL-1.0"
    }
  ],
  create: (context) =>
    createTileLayer(context.map, context.layerId, {
      tiles: ["https://a.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png"],
      maxzoom: 20,
      attribution: "© OpenStreetMap contributors, tiles CyclOSM"
    })
});
```

`viewportCost` belongs on query-backed plugins. Tiles use the default cheap lifecycle. Anything
that hits a rate-limited upstream (Overpass and most third-party APIs) should be `expensive`, so it
only refetches after a meaningful viewport action instead of firing continuously while panning.

`attribution` is mandatory, and for ODbL, CC-BY-SA or CDLA sources it is a licence obligation
rather than a courtesy. The engine aggregates every active layer's attribution into the map
control automatically.

## Extension point 2: adding a POI source

POI sources are merged into one deduplicated set of places. Create a `DataSource` under
`apps/api/src/services/dataSources/` and add it to the appropriate exported source array
(`natureSources`, `communitySources`, `mobilitySources`, `keyedSources` or `eventSources`):

```ts
import { fetchJson } from "../../utils/upstream.js";
import { point, type DataSource } from "./types.js";

export const partnerParks: DataSource = {
  id: "partner-parks",
  v2: {
    providerId: "partner-parks",
    attribution: "Example public parks dataset",
    license: "CC0-1.0",
    rights: "open",
    confidence: 0.6
  },
  async load(bbox) {
    const data = await fetchJson<{ features?: unknown[] }>("https://api.example.test/places", {
      providerId: "partner-parks",
      ttlMs: 15 * 60_000
    });
    return (data.features ?? []).flatMap((feature, index) =>
      /* validate the provider record first */
      feature ? [point(`partner-parks:${index}`, "Místo", bbox[0], bbox[1], "partner-parks")] : []
    );
  }
};
```

Three rules that matter more than they look:

- **Use the bounded shared upstream client.** Give it one stable lowercase `providerId`; raw fetch,
  redirects and user-controlled hosts bypass SSRF, response-size and circuit-breaker controls.
- **Return a stable source-prefixed id** on every place (`osm:12345`, `wikidata:Q42`). It is what
  deduplication and deep links can preserve across refreshes.
- **Fail closed on missing credentials.** Follow `dataSources/keyed.ts`: keep keys in server config,
  expose a capability for the layer manifest and return an actionable `UpstreamError`. The wrapper
  degrades only that source and preserves the rest of the result.

`v2.confidence` and source rights/provenance decide how records can be fused and redistributed.

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

## Extension point 6: adding a basemap

Backgrounds are a catalogue entry, not code (`packages/layer-sdk/src/basemaps.ts`). A keyless
source is the whole change:

```ts
{
  id: "cuzk-ortofoto",
  label: "ČÚZK Ortofoto",
  group: "satellite",
  hint: "Nejostřejší letecké snímky pro Česko",
  kind: "raster",
  tiles: ["https://ags.cuzk.cz/.../{z}/{y}/{x}"],
  imagery: true,
  attribution: [{ label: "© ČÚZK", url: "https://cuzk.cz/" }]
}
```

`imagery: true` is what makes the label overlay and the "labels over imagery" toggle apply —
without it an aerial photo shows up with no place names and no way to add them.

If the upstream needs a key, add `proxy: { provider, mapset }` instead of `tiles`, register the
provider in `apps/api/src/services/basemapService.ts`, and add its key to `config.tileKeys`. The
capability flag that hides the background on a keyless deployment is derived from the key's name,
so there is nothing to wire on the frontend. `docs/basemaps.md` is where the sign-up link and the
free-tier terms go — including whether the provider asks for a credit card, which is the part
people care about most.

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
