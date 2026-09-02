# Phase 16 — game 3D technical-slice evidence

Date: 2026-09-01  
Scope: web game runtime/UI/contracts only; no network download, identity/commerce change, new SDK
import or SDK change, API/DB migration, deployment or commit.

Policy update: ADR 0012 supersedes every source-rights/licence release gate described in this
historical evidence. The open items below are payload, LOD, visual and physical-device evidence.

## Before → target delivered

- on-chain SVG player sprite → bounded local GLB/LOD/animation contract with an original neutral
  procedural 3D fallback;
- token/style directly coupled to scene → renderer-neutral inventory selection and asset provider;
- separate keyboard/GPS behavior → one pure controller for keyboard, touch, accessible D-pad,
  tap-to-move and GPS, with distinct physical/game positions and anchor mode;
- fixed game HUD → standard left `PanelShell` / mobile bottom sheet plus a minimal map control;
- implicit performance expectations → explicit low/balanced asset and scene budgets, bounded
  telemetry, deterministic diagnostics and offline unit coverage;
- Aavegotchi-looking network sprites → procedural ghost/player placeholders until a model payload
  is supplied.

The existing one-GameHost architecture, map projection bridge, orbs, XP, quests, zones, encounters,
camera modes and collection flow remain in place.

## Static budgets

| Profile  | Avatar payload | Avatar triangles | Avatar texture bytes | Avatar draw calls | Scene p95 | Scene triangles | Estimated GPU | Entities |
| -------- | -------------: | ---------------: | -------------------: | ----------------: | --------: | --------------: | ------------: | -------: |
| low      |      750,000 B |           15,000 |                8 MiB |                 6 |     50 ms |          45,000 |        48 MiB |      120 |
| balanced |    1,500,000 B |           35,000 |               16 MiB |                10 |   33.4 ms |          90,000 |        96 MiB |      180 |

The procedural fallback has no payload/texture request. Its unit test checks real Three.js geometry,
animation states and low-profile static diagnostics: **228 triangles / 8 draw calls / 160,000 B
estimated GPU** on low and **412 / 8 / 160,000 B** on balanced. Renderer duration and GPU
allocation are explicitly proxy/estimate values; no claim about a physical device is made from
them.

## Traceability status

| Requirement        | Evidence / honest status                                                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| GAME-001/002/003   | no random zoom added; common controller uses map-centre simulation fallback, labels it simulated, and keeps GPS physical/game state separate |
| GAME-004           | technical 3D renderer and animated neutral model complete; **actual Aavegotchi model and screenshot remain absent**                          |
| GAME-005, QUAL-010 | source-rights acceptance superseded by ADR 0012; no Aavegotchi binary is present or fetched                                                  |
| GAME-006/007       | keyboard focus guard, joystick, tap-to-move/cancel and accessible D-pad share one controller; touch area is isolated from map gestures       |
| GAME-008           | existing proximity collection retained and now triggers `collect` animation                                                                  |
| GAME-009           | game content is hosted by standard left context / mobile panel, without parallel sidebar                                                     |
| GAME-010–013       | deliberately not claimed: live/fixture identity and inventory ownership remain Phase 14/provider gates                                       |
| GAME-014/015       | existing game world/registry policy retained; this slice does not rewrite presets                                                            |
| GAME-016           | serialisable GLB/LOD/animation/source-metadata/budget contract exists; conversion report awaits an actual source asset                       |
| GAME-017/018       | one existing shared WebGL layer and imperative scene loop retained; no per-frame React state update added                                    |

## Offline verification

- Phase 16 contract/controller/performance tests: **18/18 pass**.
- Targeted Phase 16 plus affected store/shell tests: **35/35 pass**.
- Full web unit suite: **248/248 pass**.
- Web TypeScript check: pass.
- Scoped ESLint: pass without warnings.
- Scoped Prettier and `git diff --check`: pass.
- Architecture boundary check: pass (**1,814 imports / 469 source files** at verification time).
- Web production build: pass; game remains a lazy chunk. Vite still reports the existing generic
  over-500-kB chunk-size warning, so no bundle-size regression is disguised as a clean budget.

All checks use installed dependencies and local fixtures. Playwright, screenshot capture and
supported low-end device profiling were intentionally not run because the task prohibits
network-heavy work while on mobile data. They remain performance evidence gaps rather than
inferred passes.

Open gates:

1. Obtain an actual Aavegotchi model/wearable/texture/animation payload; record revisions, hashes
   and advisory provenance when available.
2. Produce/optimize GLB LODs from that source and attach its machine asset report.
3. Run deterministic browser visual evidence plus low-end physical-device frame/memory traces.
4. Connect a verified inventory provider only through the Phase 14 identity/indexer boundary;
   never infer holdings from a typed token ID.

Rollback: set `VITE_GAME_AVATAR_V2=0`. The pre-existing generic player is selected and the Phase 16
avatar/mobile surface is hidden while the GameHost, orbs, quests and zones remain active.
