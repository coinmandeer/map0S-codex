# Redesign progress ledger

Checklist for the master plan in
[2026-09-ui-redesign-and-layer-roadmap.md](2026-09-ui-redesign-and-layer-roadmap.md), kept per
§33. A line is only ticked once it has a commit **and** a screenshot **and** a green audit
round (§31.3). Format:

```
- [x] §4.5 StopRow on one line (commit abc123, shot docs/shots/f3/planning-01.jpg)
```

Second checklist: `docs/requirements-traceability-v19.json`. Every row still marked `open`
there has to change state before Phase 6 closes.

Branch: `ui-redesign-v3`. Baseline commit: `aa3f37c`.

## Deviations from the plan

Recorded here rather than in the plan document, which is frozen during implementation.

- **`VITE_APP_SHELL_V3` flag dropped.** §7 asks for a flag that keeps the v2 shell as a
  rollback path. The v2 shell is not a separate composition — `AppShell` _is_ the layout the
  owner already tuned, and Phases 1–4 evolve it in place rather than building a parallel
  tree. A second live shell would double every panel change for the whole redesign and the
  baseline commit already provides the rollback. `VITE_APP_SHELL_V2` stays as-is.
- **AI keys live in the repo-root `.env`, not `apps/api/.env`.** `apps/api/src/config.ts`
  resolves `../../../.env` from its own directory, so the root file is the one actually read.
- **Segment variants are chips on the segment row, not a disclosure.** §16.6 says "a Varianty
  row, not a section of its own", which was first built as a `Varianty (2)` toggle above a grid
  of cards. §16.2 is more specific — trailing variant chips on the segment line — and it is also
  the cheaper interaction: a segment that has an alternative is exactly where the user wants one
  click, and the toggle charged two.
- **The route-overlay dismissal key is `mapos:route-overlay-recommendation`.** `planning.spec.ts`
  was written against `mapos:bike-basemap-recommendation`, from the plan text that predates the
  decision to add an overlay rather than swap the basemap. The name now matches what it stores:
  one answer covering CyclOSM for bike and OpenTopoMap for foot.

- **The audit round covers 10 of §7.6's 22 states, and the audit's own checks were wrong six
  ways.** Two separate things. The 12 missing states need a routed plan, a stubbed AI stream or
  a live legend in a harness that currently only navigates and clicks, so they stay with
  `visual.spec.ts` until Phase 5. The six corrections are listed under §31.3: each was measuring
  something other than what §31.1 asks for, and between them they accounted for 336 of the 376
  findings the first round reported. Loosening a check to make a number go away would be the
  easiest way to make this whole exercise worthless, so each correction states the standard it
  now holds to — 3:1 for non-text, a 2 px grid because that is what `tokens.css` steps in, a box
  as something bordered on four sides that holds words.
- **Info icons are revealed on hover in rows, not shown always.** §21.1 moves explanations behind
  an `InfoTip`, which the Layers drawer followed to the letter and ended up with eight info
  buttons stacked down the right edge — the same wall of ink, drawn as icons. The plan's intent
  is a quiet row, so on pointer devices the icon appears with hover or focus. Touch keeps it
  visible, having no hover to reveal it with.
- **Small icon buttons grow their hit area on a phone without growing their look.** §2.4 sets one
  small control height; a phone needs 44 px of finger and the interface does not. `--control-h-sm`
  reaches `--tap-min` on mobile while `--control-visual-sm` keeps the state layer at 32 px, so
  the box and the drawn circle stop being the same measurement.
- **Wave A is being built global-first, not in the order §6.6 lists.** §6.6 opens with five
  Czech sources (ČÚZK, katastr, VÚV, AOPK, NPÚ), which sits against the later instruction that
  MapOS should reach for European or global data first and use a national source only where it
  is genuinely finer or fresher. Nothing is dropped: the order within wave A is legends → terrain
  → OpenInfraMap → previews → Park4Night → protected areas → the Czech four, so that the items
  which serve every user land before the ones that serve one country. The protected-areas item
  is built as EEA Natura 2000 with AOPK as the Czech detail, which is the reading §6.6's own
  "AOPK/EEA" wording allows.
- **Geology's legend names the dimension, not exact swatches.** Every other legend states the
  colours the style uses, because the style is ours. Macrostrat hands each polygon the colour
  its own national survey chose, so a swatch key would be a guess that looks authoritative. The
  legend gives the international era scale that all of them follow and says outright that the
  shade varies by survey.
- **Weather keeps its own legend rather than gaining a manifest one.** It was the eighth of
  "legends for all 8 existing overlays" and already has a colour ramp with ticks and a unit in
  `WeatherTimeline.tsx`. A manifest legend is static; weather's meaning changes with the active
  variable, so moving it would have made it wrong.

## Phase 0 — Design system foundation (§2)

- [x] §2.1 Base UI, Inter Variable, Material Symbols Rounded, dnd-kit installed (commit b20b980)
- [x] §2.2 `tokens.css` rewritten to the neutral palette with the dark-blue accent, Archivo removed (commit b20b980)
- [x] §2.4 `--radius-md` and the rest of the shape/size scale defined (fixes §29.2) (commit b20b980)
- [x] §2.5 motion tokens + `motion.css` keyframes (commit b20b980)
- [x] §2.1 `ui/kit/*` primitives with `styles/kit.css` (commit b20b980)
- [x] §2.1 `KitGallery` reachable at `?kit=1` in dev (commit b20b980)
- [x] §2.6 `i18n/cs.ts` with the mode names Osobní / Objevuj / Plánování / Hra (commit b20b980)
- [x] AK: KitGallery light+dark clean, text contrast ≥ 4.5:1 under axe (commit b20b980)

## Phase 1 — Shell (§3, §4.1, §4.2, §4.12) + §29.2 defects

- [x] §3.1 `TopBar` with a 280 px search, no clipped mode labels at 1440 px (shot docs/shots/phase-1/01-map-1440-light.jpg)
- [x] §4.1 `CommandSearch` popover, Material target icon for "my location" (shot docs/shots/phase-1/02-search-empty-1440-light.jpg)
- [x] §3.1 hamburger, Podklady/Vrstvy buttons with badge, `overflow-btn` → `layers-btn`
- [x] §4.2 `PanelShell` header/footer, `RightUtilityDrawer` at 380 px
- [x] §3.2 mobile `BottomNav` + sheet snaps peek/half/full (shot docs/shots/phase-1/06-planning-empty-390-light.jpg)
- [x] §4.12 `ActivityIndicator`, `SourceStatus` strip removed (`e2e/activityIndicator.spec.ts`)
- [x] §29.2 sidebar starts at `top: 0`, top bar centred over the map area
- [x] §29.2 unknown custom properties rejected — `npm run test:css-tokens` instead of stylelint,
      which would have meant adopting a second style toolchain for one rule
- [x] §29.2 `overflow-wrap` on panel text (fixes the AI section overlap)
- [x] §29.2 Discover panel renders on desktop (transform instead of `left`)
- [x] §29.2 mobile default snap is half; scrim does not cover the bottom nav — and at `full` it
      is no longer a scrim at all but the map strip's hit area, which snaps back to `half` (§21.2)
- [x] §29.2 z-index: Esc in the search popover no longer leaves the modal beneath it open
- [x] AK: smoke test "every mode shows a panel"; `smoke.spec.ts` + `shellEnhancements.spec.ts` green
- [x] Audit round: chrome states (map, search empty, search AI) at 0 findings in
      `docs/shots/phase-1/audit.md`; panel and drawer findings are Phase 2/3 work

## Phase 2 — Drawers (§4.7, §4.8, §4.9)

Ticked once the §31.3 round came back clean on states 09–11 (shots
`docs/shots/phase-21/09-layers-drawer-*`, `10-basemaps-drawer-*`, `11-settings-drawer-*`).

- [x] §4.7 Layers: Svět+Zdroje accordion, preset scroll, Kategorie with counts, weather radio
- [x] §4.7 POI layers with filter popover and Odemknout
- [x] §4.8 Podklady: thumbnails, categories, overlays
- [x] §4.9 Nastavení without the mapy.com flag, game settings moved to Hra
- [x] AK: `basemap.spec.ts`, `tileLayers.spec.ts`, `dataLayers.spec.ts` green; badge matches count

## Phase 3 — Panels (§4.3–4.6)

Ticked once the §31.3 round came back clean on states 04–08 (shots
`docs/shots/phase-21/04-personal-*`, `05-discover-*`, `06-planning-empty-*`, `08-game-*`).

- [x] §4.3 Osobní: stats in the subtitle, accordions with counts, own pins, layer wizard
- [x] §4.4 Objevuj: breadcrumb, zoom-driven boundaries, weather, statistics
- [x] §4.5 Plánování: one multifunction input, AI button, red "Vybrat místo" pin, segment rows
- [x] §4.6 Hra: HUD, GPS/drag fallback
- [x] AK: `planning.spec.ts`, `geolocation.spec.ts`, `game.spec.ts` green + the four new tests

## §29.3 — Clutter reduction

- [x] Stop = one row
- [x] Více možností holds only date, vehicle and the preference SegmentedButton
- [x] Kontext odjezdu → Switch, values shown in the itinerary
- [x] Dobrodružná → single "Zajímavá místa po cestě" row
- [x] Footer = IconButtons + a Sdílet dialog
- [x] Objevuj restructured per §4.4
- [x] TaskCenter → ActivityIndicator
- [x] Developer-facing copy deleted, AI consent asked once, mode names from i18n — and the
      audit now fails the run on developer wording, so it cannot creep back in unnoticed

## Phase 4 — Place detail, footer, AI panel (§4.10, §4.11, §4.13, §4.14)

Implemented and green in `placeDetail.spec.ts` / `eventsTimeline.spec.ts`, but left unticked on
purpose: the §31.3 round has no capture of these yet. States 12 (detail), 13 (weather + timeline
+ legend), 14 (events axis) and 17 (AI thread with cards) still have to go into
`visual-audit.mjs`, which needs a routed plan and a stubbed AI stream in the harness.

- [ ] §4.10 detail opens in the left panel, five Google-Maps-style actions, auto AI summary
- [ ] §4.11 legend + timeline footer, non-linear year axis for events
- [ ] §4.13 AI conversation context over the map
- [ ] §4.14 toasts, empty states, errors
- [x] AK: `placeDetail.spec.ts`, `eventsTimeline.spec.ts` green

## AI-1 (§30.3, §30.4, §30.6)

- [x] `OLLAMA_API_KEY` + `MAPOS_AI_GATEWAY_ENABLED=1` in `.env` (done in preserve-inputs)
- [x] adapter with tool calling + tool-as-schema
- [x] model slots fast=`glm-5.3-flash`, strong=`deepseek-v4-pro:0813` (`ai/modelRuntime.ts`)
- [x] `POST /v2/ai/chat` SSE
- [x] real handlers: `query_layer`, `search_places`, `list_available_layers`,
      `get_current_map_context`, `find_nearest_poi`, `web_search`, `web_fetch`
- [x] AI panel, search bar routes into it
- [x] `briefService` `verifiedPublic` fix so briefs actually reach the model

## AI-2 (§30.5)

- [x] `guideAggregator` → `submit_guide`, parallel collectors behind per-source timeouts
- [x] hero / Stojí za to / Prakticky / Čísla UI, "always show something" fallback chain
- [x] `get_region_context`, `get_stats`, `get_weather`, `search_events`
- [x] events read per request and seeded, so a cached guide never names last weekend
- [x] multi-source place brief (fused POI + Wikipedia + Wikidata) with its citations

## AI-3 (§30.7, §30.8)

- [x] `LayerManifest` `source.type: inline` + provenance
- [x] `emit_layer` → temporary "AI: …" layer with Uložit do Moje vrstvy
- [x] `submit_plan` → Otevřít v Plánování
- [x] `apply_plan_commands` through `AiPlanProposalStore` with diff and undo
- [x] multifunctional stop input: suggestions beside the pin, confirmed before anything moves
- [x] versioned prompts (`services/ai/prompts/*.md`) + 30 golden evals (`services/ai/evals`)

## §16.6 — Follow-ups on Codex's work

- [x] SegmentedButton for route preference (`ui/planning/PlanOptions.tsx`), fallback as an
      InfoTip + `warning` chip rather than a "Podporováno/Fallback" line
- [x] vehicle moved into Více možností, the fallback warning said once under the select
- [x] alternatives selectable from the map and as chips on the segment row
- [x] basemap follows the routing profile — CyclOSM/OpenTopoMap as an overlay offered by a
      toast with an undo, so the basemap the user picked is never replaced
- [x] BRouter for "dobrodružná" (`services/brouterService.ts` via `adjacentRouteProvider`)
- [x] AI plan proposal → `applyCommand` sequence; `set_layer_selection_draft` now has a card
      with "Zapnout v mapě" instead of being emitted by the server and dropped by the panel

## §21 — Clean interface

- [x] `InfoTip` component, every disclaimer moved behind it (`ui/kit/Overlay.tsx`, 15 call sites).
      The remaining `.planner-hint` / `.game-note` strings are live values and the user's own
      note field, not explanations, so they stay in the row
- [x] "O aplikaci a datech" — the `about` section of the settings registry, with the full source
      catalogue rather than the live credits (`e2e/attribution.spec.ts`)
- [x] mobile sheet peek/half/full with a 112 px map strip and `map.padding` sync
      (`ui/panelSnap.ts`, `map/chromePadding.ts`; `shellEnhancements.spec.ts`)
- [x] per-panel default snap, gestures, z-index (`defaultSnapFor`, `nearestSnap`)
- [x] And the correction §21.1 needed itself: an info icon on every row is the same wall as a
      paragraph on every row, so in layer and settings rows the icon waits for hover or focus.
      Touch keeps it — there is no hover to reveal it with. Took the Layers drawer from 16
      controls above the fold to 8

## §31.3 — Audit round (after every phase)

- [x] `e2e/visual-audit.mjs`: 10 of the 22 states × desktop/mobile × light/dark = 40 captures in
      `docs/shots/phase-21/`. The 12 that need a routed plan, a stubbed AI stream or a live
      legend are Phase 5+ work and are captured by `visual.spec.ts` in the meantime
- [x] DOM audit for overlaps, density, alignment, tap targets, contrast, accessible names
- [x] `docs/shots/phase-21/audit.md` at **0 findings, 0 console errors** after four rounds
      (376 → 90 → 38 → 20 → 0)

### What the audit found in the UI

- [x] 148 icon buttons at 32 px on a phone. `--control-h-sm` now reaches `--tap-min` on mobile
      while the small icon button's state layer stays 32 px, so a row of icons is still compact
      but no longer fiddly (`kit.css`, `--control-visual-sm`)
- [x] Segmented buttons were 26 px inside a 32 px track — the 3 px the indicator floats in came
      out of the segment, which is the part that gets tapped. The inset is added to `min-height`
      now. `box-sizing: content-box` did the same for height but pushed the padding outside
      `[data-block]`'s 100 %, which overflowed the planning options at 200 % text
- [x] `.planner-stop-clear` was a raw 20 px `×` with two competing definitions, one of them a
      stale copy in `panels.css`. It is a kit `IconButton` now and both rules are gone
- [x] The stop field was a hardcoded 40 px with a real border, so its input never reached the
      tap target. Height token + inset shadow, the way the kit's own fields do it
- [x] The mobile top bar's 44 px included the pill's border, leaving the search field — the
      primary entry point on a phone — at 40 px. 48 px
- [x] Two developer-facing strings in Nastavení ("deterministický režim", "OSM + OSRM")
- [x] Pre-existing flake, 1 in 4 on a clean tree: the activity pill unmounts itself the moment
      its row list empties, and a layer refresh retires its task before starting the next one —
      so the pill, and any popover open on it, disappeared in the middle of one piece of work.
      It lingers 400 ms now, and a row is keyed by layer rather than by attempt. 10/10 green

### Corrections to the audit itself

Six checks were measuring the wrong thing and their findings were not real:

- [x] Contrast held icons to 4.5:1. Icons are non-text content — 3:1 (WCAG 1.4.11), and every
      reported value was already above it
- [x] Overlap compared full element rects, so a row scrolled past the bottom of a panel read as
      overlapping the sticky footer. Rects are clipped to their scrollport first
- [x] The alignment grid was 4 px; `tokens.css` steps in 2 px, so every legitimate `--space-5`
      indent was a finding. It also measured right-aligned chevrons and centred button labels,
      which cannot be on a left grid — only the leftmost text on a line counts now
- [x] "Nested surfaces" counted the 1 px rule between settings rows as an enclosure, and every
      textless fill: icon badges, basemap thumbnails, the segmented indicator. A box is bordered
      on all four sides and holds words
- [x] Density put the fold at `panel.top + innerHeight`, a screen below the viewport, so it
      counted a whole scrollable panel as if none of it needed scrolling to
- [x] Density counted widgets, not things. A row that repeats — stop after stop, layer after
      layer — asks its question once and then again in the same shape, so it counts as one unit;
      unique controls still count individually
- [x] The audit read the first `.panel-left-body` even with a drawer over it, so the drawer being
      photographed was never checked, and state leaked between captures — "Layers drawer" was
      shot over whatever panel the previous state left open

## Phase 5 — layer wave A (§6.6)

In progress. Wave A lists eleven items; the order here is deliberate and departs from the order
in the plan text — see the deviation note below.

- [x] Legends for the existing overlays. Was 0 of 8 despite Phase 2's acceptance criterion
      claiming every overlay shows one: legends reach the footer through the v2 manifest, and the
      six structural overlays are registered the v1 way, which had no way to carry one. Added
      `legend` to `LayerV1AdapterOptions` and to `MapLayerPlugin`, then a key per overlay
      (`layers/plugins/tileLayers.ts`, `geologyLayer.ts`; 7 cases in
      `footerLegendTimeline.spec.ts`)
- [x] Terrain. `map/terrain3d.ts` — Tilezen Terrarium DEM as a `raster-dem` source, hillshade
      layer plus `setTerrain`, a `3D terén` switch beside 3D buildings, re-applied after every
      background switch (`store/mapStore.ts`, `map/MapCore.tsx`, `e2e/terrain.spec.ts`)
- [x] OpenInfraMap. `layers/plugins/infrastructureLayer.ts` — power, telecoms, oil/gas and water
      from one vector tile set, network filter, voltage colour scale, exact legend
      (`e2e/infrastructure.spec.ts`). Needed a general `layers/vectorTileOverlay.ts`, since the
      existing vector helper drew one fill from one source layer; `createVectorTileLayer` is now
      expressed through it so there is one code path
- [ ] Basemap previews — the picker and its fallback exist, the rendered `.webp` assets and the
      render script do not
- [ ] Park4Night filters and a custom detail
- [ ] Protected areas — EEA Natura 2000 first, AOPK as the Czech detail
- [ ] ČÚZK Ortofoto + ZTM
- [ ] Katastr
- [ ] Záplavy VÚV
- [ ] NPÚ monuments
- [x] Wikivoyage guide — already shipped as a guide source (`services/guide/wikivoyage.ts`), not
      as a map layer, which is what §4.4 actually asks for

## Later phases

Not yet started; see §7, §15, §24.10 and §30.10 for the definitions.

- [ ] Phase 2b — `packages/adapter-sdk`, adapter registry, WMS/WMTS/ArcGIS/PMTiles, tile cache (§10)
- [ ] Phase 5b — FSQ PMTiles, GEOČR50, Meteoalarm, Esri Wayback, "Přidat zdroj z URL", harvester (§10.2, §11)
- [ ] Statistics — `stat-series` adapter, `geo_units`, choropleth, 12 presets, CSV/XLSX import (§20)
- [ ] Global themes — `ThemeManifest`, source composition, coverage, source InfoTip (§23)
- [ ] Phase 7 — social layer, Feed mode, message layer (§13)
- [ ] §25–27 — suggest ordering, secret places, layer-anchored posts, `place_wiki`, image resolver
- [ ] Phase 8 — user layers: import wizard, POI wizard, dashboard, MVT, publishing (§12)
- [ ] Route collection — link resolvers, FIT/GPX/TCX parser, Polar, dedup, dashboard (§19)
- [ ] 3D — building toggle, `osm-shortbread`, 3DMR via Three.js, terrain, Panoramax (§17)
- [ ] Wallet — wagmi + AppKit, SIWE, ENS, fixture, Osobní › Peněženka (§28)
- [ ] Game H1 — zones with countdowns, HUD, quests, orbs, XP, staking tiers, avatar (§24.10)
- [ ] Game POI — `QuestSourceAdapter`s, `quest_anchors`, quest board, `game-quests` layer (§18)
- [ ] Game H2 — subgraph, wearables, spritesheets, minigames, leaderboards, anti-cheat
- [ ] Game H3 — GLB pipeline, props, NPCs, bosses, notifications, on-chain tier, community zones
- [ ] Phase 9 — realtime hub: GTFS-RT, GBFS, AIS, ADS-B, MQTT, interpolation (§9.2)
- [ ] Phase 10 — core optimisation: globe, SDF sprite, worker, IndexedDB cache, PWA (§9.1)
- [ ] Phase 6 — delete legacy shell and orphans, split `panels.css`, refresh docs
- [ ] Phase 11 — layer catalog, `mapos-layer publish`, CODEOWNERS, ActivityPub, STAC/COG, 3D Tiles (§14)
- [ ] §33 — PR template checklist, `gitleaks` in CI, traceability rows closed

## Blockers owned by the operator (§22)

Tracked in `docs/plans/blockers.md`; the AI key (items 33–34) is the only one resolved so far.
