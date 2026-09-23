# Game / QuestLayer roadmap

Status: 2026-09-18. The 3D game was ported from the legacy **QuestLayer V3** codebase into
`apps/web/src/layers/game/` and `apps/web/src/world/`. This document records what is done, what is
half-wired, and the plan for finishing it. It is written for whoever picks the game up next.

## Where the game lives

| Area           | Files                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| One renderer   | `apps/web/src/layers/game/threeScene.ts`, `GameHost.ts`, `modelCatalog.ts`, `neutralAvatar.ts`          |
| Active layer   | `apps/web/src/world/worldLayer.ts` (registered in `layers/builtins.ts` as `id: "game"`)                 |
| Scene entities | `apps/web/src/world/WorldObjects.ts`                                                                    |
| HUD            | `apps/web/src/world/GameHudOverlay.tsx` (always-on arcade HUD), `WorldHud.tsx` (left panel)             |
| Social         | `apps/web/src/world/WorldSocial.tsx`, `socialMap.ts`, `runtime.ts` (WebSocket `/v2/world/live`)         |
| Modules        | `apps/web/src/layers/game/*` (orbs, controller, ghosts, avatar, performance, trail-signals, aavegotchi) |
| Server         | `apps/api/src/game/*`, `apps/api/src/world/*`, `/game/*` and `/v2/world/*` routes                       |

Requirement IDs: `GAME-001`…`GAME-018` in `docs/requirements-traceability-v19.md`. Two gates remain
external and accepted: `GATE-GAME-ASSET` (a real, rights-verified Aavegotchi GLB) and
`GATE-GAME-INDEXER` (live inventory). Everything else is in our hands.

## Done recently

- **Modular world/game switcher** (`apps/web/src/world/GameSwitcher.tsx`): an always-on row of
  focus tabs (one per `GAME_MANIFESTS` entry) plus a "Nastavení hry" popover with per-game active
  toggles, camera (top/follow) and avatar (Gotchi/Cube) controls. Aavegotchi is the default; more
  games appear automatically from the manifest list. `game-selector-<id>` is always visible,
  `game-active-<id>` lives in the popover.
- **Entity GLBs wired**: `WorldObjects.CATALOG_ENTITY_MODEL` maps `essence → bigCrystal`,
  `boss → giant`, `lickquidator → goblin`; the procedural shape is the fallback and stays until the
  model loads. `WorldObjects.attachCatalogModel` detaches the HP bar before swapping so the bar
  survives the swap.
- **Animations tick**: every entity mixer is updated each frame (was only the player mixer).
- **Production models (corrected 2026-09-20)**: Docker does not fetch GLBs. Production mounts `MODELS_HOST_DIR` read-only at `/models`; missing assets use the procedural fallback. See `docs/audits/2026-09-20-atlas-audit.md` for the current RPG implementation and remaining work.
- **HUD unification**: the always-visible `GameHudOverlay` carries `data-testid="game-hud"` and an
  `orb-count`; the left panel HUD is `game-panel-hud`. `worldLayer` publishes the practice orb
  count through `game-practice`. Quest rows carry `quest-<id>`.
- **Desk play works**: the practice orb board generates in simulation even with a server session
  (capabilities arrive after the first frame, so the board is refreshed from a `worldRuntime`
  subscription). `render_game_to_text` exposes `orbField`.
- **Ghosts and encounters**: `worldLayer` fetches `/game/ghosts` and `/game/encounters` for the
  sector, syncs them into the scene, and clicking one catches/resolves it — ported from the dead
  `gameLayer.ts` into the active layer.
- **Perf**: `WorldObjects.pick` reuses a `Vector2` and a stable object array; `update` no longer
  re-projects every entity every frame (base x/y is cached in `sync`).
- **Input**: empty-map click in simulation emits `game-tap-target` (tap-to-move is live again);
  engage→attack awaits the server round trip instead of a fixed 350 ms timer.
- **Tests**: `e2e/game.spec.ts` went from ~1 to 6 passing, including the two-games/one-render-loop
  switcher test and camera/avatar switching.

## Known gaps (the plan)

### Phase 1 — HUD and interaction parity (do first, small)

1. **Game selector + active game list**: `game-active-<id>` / `game-selector-<id>` and the avatar
   choice (`avatar-gotchi` / `avatar-cube`) exist only in the dead `ui/GameHud.tsx`. Move the game
   registry (`layers/game/gameRegistry.ts`) selector into `GameHudOverlay` (a compact menu), and the
   avatar choice into `WorldHud`. Keep `game-hud` on the overlay.
2. **Quest panel**: `quest-<id>` claim lives in `WorldHud` already but the e2e expects the quest HUD
   to update in place. Confirm `snapshot.quests` drives it and add the `quest-<id>` testid to the row.
3. **Camera actions**: `game-camera-top` / `game-camera-follow` testids for the overlay camera toggle.
4. **Settings disclosure**: `game-settings` + `game-performance` (draw calls, triangles, GPU estimate
   from `gamePerformance.ts`) surfaced in the panel, not only available to the console.
5. Delete `apps/web/src/ui/GameHud.tsx` once 1–4 land, and repoint any remaining e2e selectors.

### Phase 2 — Entity / GLB catalogue

1. Map the remaining kinds: `chest → wood-chest`, opening to `chest-open`; `quest → key` or a beacon;
   decorative zone props already use `pickZoneModelKey`.
2. Chest open animation: either keep the procedural lid or swap the GLB to `chest-open` on collect
   (the named `lid` path only exists on the procedural mesh).
3. Model LRU: the global promise cache in `modelCatalog.ts` lives for the page lifetime. Add a bounded
   LRU that **drops** entries (never disposes geometry that live clones share) and expose a hit/miss
   counter in `game-performance`.
4. Provenance: fill `docs/licenses/game-prop-assets.md` (origin, checksum, licence) to close
   `GAME-016`; keep the advisory status from ADR 0012.

### Phase 3 — Gameplay systems currently only in the dead `gameLayer.ts`

`apps/web/src/layers/game/gameLayer.ts` has 0 references but holds features the new layer never
ported. Port them into `worldLayer`/`WorldObjects` (or explicitly retire them):

1. **Ghosts**: `GET /game/ghosts`, `POST /game/ghosts/:id/catch`, `ghost-caught`, removing the sprite.
   `GameHost` already renders ghosts via `ghostRenderer.ts`; wire the client fetch + catch.
2. **Encounters**: proximity resolve via `POST /game/encounters/:id/resolve`.
3. **Server orb/progress sync**: `/game/orbs/collect` + `/game/progress` for signed-in practice, and
   daily reset. The authoritative path uses `/v2/world/action`, but the legacy board had road-snapped
   orbs + XP toast.
4. **Road geometry source**: `ensureRoadGeometry` / `mapos-game-road-geometry` — the e2e asserts this
   source exists. Reuse `roadSource.ts`.
5. After 1–4, delete `gameLayer.ts` so there is one game layer.

### Phase 4 — Avatar

1. `defaultAvatarAssetProvider` is an empty catalogue → always the neutral placeholder. Add the
   versioned `/models/avatars/` descriptors and enforce `AVATAR_ASSET_BUDGETS` (already implemented)
   in `setLiveAvatar` (inventory path checks the budget; the live-avatar path does not yet).
2. Surface the avatar state in the HUD: `pending` / `ready` / `unavailable`, and pre-warm the default.
3. Reset/despawn must dispose GLB clones; `threeScene.syncEncounters` removal currently leaks its
   clones (dead path, but fix when Phase 3 lands).

### Phase 5 — Performance and observability

1. `WorldObjects.update` still touches every object every frame for the bob/rotation; move the idle
   animation into the shader clock or only animate objects within the camera frustum.
2. `pick` still intersects every object; add a coarse cell/distance filter using the cached base
   positions before the raycast.
3. Close `GAME-018`: a long profiler run proving the React tree does not re-render per frame.
4. Extend `gamePerformance.ts` with entity counts and cache hit/miss, and surface it in `game-settings`.

### Phase 6 — Tests

1. Unit: `WorldObjects` (sync/replace/HP preservation, GLB swap, pick), `WorldHud`/`GameHudOverlay`
   (orb count, selected target), `worldLayer` (tap-to-move emit, engage→attack order).
2. E2E: one spec per HUD panel state; keep `orb-count`, `game-hud`, `game-panel`, `render_game_to_text`
   as the stable contract.
3. `game-performance.spec.ts` already checks one avatar owner / one render loop / heap growth; add the
   GLB-swap path to it once Phase 2 lands.

## Non-goals (unchanged)

No new economy, staking or multiplayer authority; no second renderer or DOM markers; GPS rewards are
never granted to a virtual avatar (ADR 0007). Rollback stays available via `VITE_GAME_AVATAR_V2=0`.
