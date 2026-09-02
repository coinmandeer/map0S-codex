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

- [ ] §4.7 Layers: Svět+Zdroje accordion, preset scroll, Kategorie with counts, weather radio
- [ ] §4.7 POI layers with filter popover and Odemknout
- [ ] §4.8 Podklady: thumbnails, categories, overlays
- [ ] §4.9 Nastavení without the mapy.com flag, game settings moved to Hra
- [ ] AK: `basemap.spec.ts`, `tileLayers.spec.ts`, `dataLayers.spec.ts` green; badge matches count

## Phase 3 — Panels (§4.3–4.6)

- [ ] §4.3 Osobní: stats in the subtitle, accordions with counts, own pins, layer wizard
- [ ] §4.4 Objevuj: breadcrumb, zoom-driven boundaries, weather, statistics
- [ ] §4.5 Plánování: one multifunction input, AI button, red "Vybrat místo" pin, segment rows
- [ ] §4.6 Hra: HUD, GPS/drag fallback
- [ ] AK: `planning.spec.ts`, `geolocation.spec.ts`, `game.spec.ts` green + the four new tests

## §29.3 — Clutter reduction

- [ ] Stop = one row
- [ ] Více možností holds only date, vehicle and the preference SegmentedButton
- [ ] Kontext odjezdu → Switch, values shown in the itinerary
- [ ] Dobrodružná → single "Zajímavá místa po cestě" row
- [ ] Footer = IconButtons + a Sdílet dialog
- [ ] Objevuj restructured per §4.4
- [ ] TaskCenter → ActivityIndicator
- [ ] Developer-facing copy deleted, AI consent asked once, mode names from i18n

## Phase 4 — Place detail, footer, AI panel (§4.10, §4.11, §4.13, §4.14)

- [ ] §4.10 detail opens in the left panel, five Google-Maps-style actions, auto AI summary
- [ ] §4.11 legend + timeline footer, non-linear year axis for events
- [ ] §4.13 AI conversation context over the map
- [ ] §4.14 toasts, empty states, errors
- [ ] AK: `placeDetail.spec.ts`, `eventsTimeline.spec.ts` green

## AI-1 (§30.3, §30.4, §30.6)

- [ ] `OLLAMA_API_KEY` + `MAPOS_AI_GATEWAY_ENABLED=1` in `.env` (done in preserve-inputs)
- [ ] adapter with tool calling + tool-as-schema
- [ ] model slots fast=`glm-5.3-flash`, strong=`deepseek-v4-pro:0813`
- [ ] `POST /v2/ai/chat` SSE
- [ ] real handlers: `query_layer`, `search_places`, `list_available_layers`,
      `get_current_map_context`, `find_nearest_poi`, `web_search`, `web_fetch`
- [ ] AI panel, search bar routes into it
- [ ] `briefService` `verifiedPublic` fix so briefs actually reach the model

## AI-2 (§30.5)

- [ ] `guideAggregator` → `submit_guide`
- [ ] hero / Stojí za to / Prakticky / Čísla UI, "always show something" fallback chain
- [ ] `get_region_context`, `get_stats`, `get_weather`, `search_events`

## AI-3 (§30.7, §30.8)

- [ ] `LayerManifest` `source.type: inline` + provenance
- [ ] `emit_layer` → temporary "AI: …" layer with Uložit do Moje vrstvy
- [ ] `submit_plan` → Otevřít v Plánování
- [ ] `apply_plan_commands` through `AiPlanProposalStore` with diff and undo
- [ ] versioned prompts + golden evals

## §16.6 — Follow-ups on Codex's work

- [ ] SegmentedButton for route preference
- [ ] vehicle moved into Více možností
- [ ] alternatives selectable from the map and from a Varianty row
- [ ] basemap follows the routing profile
- [ ] BRouter for "dobrodružná"
- [ ] AI plan proposal → `applyCommand` sequence, `set_layer_selection_draft`

## §21 — Clean interface

- [ ] `InfoTip` component, every disclaimer moved behind it
- [ ] "O aplikaci a datech" page
- [ ] mobile sheet peek/half/full with a 112 px map strip and `map.padding` sync
- [ ] per-panel default snap, gestures, z-index

## §31.3 — Audit round (after every phase)

- [ ] `e2e/visual-audit.mjs`: 22 states × desktop/mobile × light/dark
- [ ] DOM audit for overlaps, density, alignment; axe pass
- [ ] `docs/shots/<phase>/audit.md` written, fixes applied, round repeated

## Later phases

Not yet started; see §7, §15, §24.10 and §30.10 for the definitions.

- [ ] Phase 5 — layer wave A (§6.6)
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
