# How to add a layer

MapOS is built so that adding a layer is proportionate to what the layer needs. There are three
paths, from "no code at all" to "full renderer". Pick the first one that fits.

| Path                   | Effort          | Use it when                                                        |
| ---------------------- | --------------- | ------------------------------------------------------------------ |
| 1. Add source from URL | a dialog        | The data is already a WMS/WMTS/ArcGIS/PMTiles/GeoJSON endpoint     |
| 2. `dataPlugin`        | ~30 lines + API | A JSON/GeoJSON API should become pins (or circles) on the map      |
| 3. Custom renderer     | a plugin module | The layer needs WebGL, particles, 3D, or its own interaction model |

---

## 1. A source from a URL — no code

Layers → **Add source from URL**. Paste the endpoint; the adapter registry
(`packages/adapter-sdk`) probes it and detects WMS, WMTS, ArcGIS MapServer/FeatureServer,
PMTiles, XYZ raster and plain GeoJSON. The layer is stored with `source_url`,
`source_adapter_id` and a `source_manifest`, and the web app registers a real
`LayerManifestV2` plugin for it at runtime — it behaves like a built-in layer: pins, detail
sheet, filters, presets.

This is also the right answer for one-off datasets a user brings (a club's map, a research
export). If the URL works here, nobody needs to touch the repository.

## 2. A `dataPlugin` — a public API as pins

The canonical example is the earthquakes layer in
`apps/web/src/layers/plugins/dataLayers.ts`. Three parts:

1. **Manifest** (`LayerManifestV2`): id, name, icon, category, renderer (`circles` with
   `sizeProperty` for magnitude-style scaling, or plain pins), `queryPolicy` (viewport
   strategy, debounce, `searchHere` behaviour, cache TTL) and `filters` (range/select facets
   the drawer renders for free).
2. **Server adapter**: an endpoint under `/api/v2/layers/<id>/features` that fetches the
   upstream, normalizes it to a GeoJSON FeatureCollection and sets cache headers. The browser
   never talks to the upstream directly — the server is one polite, cached, identified caller
   (see `MAPOS_CONTACT` in `docs/data-sources.md`).
3. **Detail profile** (optional but expected): `detail.fieldOrder` lists which feature
   properties the place sheet shows and in what order; `capabilities: ["detail", "media"]`
   turns on the photo tab. Without it the sheet falls back to a generic layout.

If the upstream needs a key, add `requiresCapability` and document the env var in
`docs/data-sources.md` — a layer gated behind a key the deployment doesn't hold is not offered
at all, which is kinder than a toggle that can only produce an error.

## 3. A custom renderer

When the layer is not pins — weather fields, the game, particle wind — write a plugin with its
own `create(ctx)` that returns a handle with `update(bbox, filters, signal)`, `setVisible`,
`setOpacity` and `dispose`. Reference implementations:

- `apps/web/src/layers/weatherLayer.ts` + `layers/weather/adaptiveOverlay.ts` — a MapLibre
  source/layer pair driven by a zoom-dependent strategy, with progressive refinement.
- `apps/web/src/layers/game/gameLayer.ts` — a MapLibre custom layer owning a Three.js scene.

Rules of the road: register through `registerLayerV2`, keep network inside `update` (the engine
decides when viewport changes are worth a refetch), respect the abort signal, and never add DOM
markers — symbol layers or a custom renderer, so pins stay cheap by the thousand.

## Checklist for any new layer

- [ ] Attribution in the manifest (label + url + licence), and a row in `docs/data-sources.md`
- [ ] `detail.fieldOrder` so the place sheet shows what the layer actually knows
- [ ] `queryPolicy.searchHere` chosen deliberately (`after-pan` for expensive sources)
- [ ] An offline fixture in `apps/api/src/routes/offlineFixtureRoutes.ts` so e2e can see it
- [ ] One e2e assertion that toggling it on renders something (see `e2e/dataLayers.spec.ts`)

## Known blockers (assets, not code)

- **Aavegotchi 3D models**: the open-source gotchi projects (e.g. defi-dungeons-verse) ship 2D
  sprites, not GLBs, and the official 3D models are not openly licensed. The avatar pipeline
  (`layers/game/avatarAssets.ts`) is licence-gated and ready — what is missing is a GLB we may
  redistribute. Until then the game renders the reviewed neutral/cube-guy avatars.
