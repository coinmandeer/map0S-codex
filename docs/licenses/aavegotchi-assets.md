# Aavegotchi 3D asset advisory inventory

Status on 2026-09-01: **no Aavegotchi binary is bundled by Phase 16.** The v19 catalog is empty to
keep the mobile-data payload small. This file preserves optional source metadata and is not a
runtime, build or release gate under ADR 0012.

## Current asset inventory

| Asset class                             | Exact source / commit                                          | Advisory source metadata           | Runtime strategy                               | Status        |
| --------------------------------------- | -------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------- | ------------- |
| MapOS neutral procedural avatar         | `apps/web/src/layers/game/neutralAvatar.ts` in this repository | original MapOS repository metadata | generated in memory; no binary/network request | active        |
| Aavegotchi body/model/rig               | not supplied                                                   | not supplied                       | none                                           | not bundled   |
| Aavegotchi wearables/materials/textures | not supplied                                                   | not supplied                       | none                                           | not bundled   |
| Aavegotchi animation clips              | not supplied                                                   | not supplied                       | none                                           | not bundled   |
| Aavegotchi trademark/brand treatment    | not supplied                                                   | not supplied                       | none                                           | informational |

The generic third-party GLBs already used by legacy encounter/player fixtures are not represented
as Aavegotchi assets and do not supply the missing character payload. Phase 16 neither downloaded nor added a model,
texture, wearable, animation, SDK bundle or cached response.

## Recommended metadata for an operator-supplied asset

Every body, wearable, texture atlas, material, rig and animation clip needs its own reviewed row
containing all of the following:

1. immutable source URL and source commit/release plus a SHA-256 of every produced binary;
2. artwork licence (separate from a code-repository licence) and written evidence path;
3. explicit rights for redistribution, modification/conversion, caching and commercial use;
4. attribution text and placement, trademark constraints and any user-ownership condition;
5. chosen strategy: reviewed bundle, reviewed same-origin runtime asset or user-owned fetch;
6. source-to-GLB conversion recipe and an asset report for payload, triangles, textures, draw
   calls, animation names and LOD0/LOD1/LOD2;
7. review date and a removal/rollback test which leaves the game playable.

Missing advisory fields do not block the prototype. They remain useful when the project later
chooses a production distribution policy.

## Runtime enforcement

`AvatarAssetProvider` accepts a real model when its descriptor has:

- a same-origin `/models/avatars/…` GLB URL without traversal/query/fragment;
- idle/walk mappings and LOD metrics inside the selected performance budget.

When the payload is absent, the URL is unsafe or the budget fails, `ThreeScene` uses the original
MapOS procedural 3D placeholder. It never calls the former on-chain SVG sprite path for the player
or ghost artwork. `VITE_GAME_AVATAR_V2=0` is the code-path rollback to the pre-existing generic
player while keeping the GameHost, orbs, quests and zones active.

## 2026-09-05 runtime guest appearance

The new default appearance resolves token #100 through the existing official renderer/indexer
pipeline. It is a guest visual, never a declaration that the visitor owns the token. No GLB was
added to the repository or release archive. The same-origin model route permits the known default
appearance and its LOD URLs for guests; other model hashes retain the authenticated access check.
The existing on-demand cache/conversion pipeline is reused. The renderer returned a 1,094,808-byte
low LOD with 11,796 triangles and 14 draw calls during local verification. Upstream unavailability
still falls back to the clearly provisional explorer; the VPS now has an operator-warmed persistent cache for this fixed guest appearance.
