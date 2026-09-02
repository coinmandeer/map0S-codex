# ADR 0007: Game avatar assets use bounded local payloads and one controller contract

Status: accepted for the Phase 16 technical slice, 2026-09-01; source-rights blocking partially
superseded by ADR 0012.

## Context

MapOS already has one MapLibre/Three.js `GameHost`, georeferenced movement, orbs, quests, zones and
encounters. Its Aavegotchi player/ghost path was an on-chain SVG rendered as a `THREE.Sprite`, not
an animated 3D model. No local Aavegotchi GLB payload is present in the data-efficient v19 bundle.
Keyboard and GPS movement also need to share semantics with new mobile and accessible inputs.

## Decision

- Keep the existing GameHost and shared WebGL context; do not add a second renderer or canvas.
- Separate `AvatarInventoryProvider`, serialisable selection, `AvatarAssetProvider` and
  `ThreeScene`. A token reference is display metadata, never proof of ownership or asset rights.
- Default to an original, procedural MapOS 3D character with no downloaded binary or third-party
  artwork. Do not label it as Aavegotchi. The old SVG sprite is not a completion fallback.
- Permit an animated GLB through an injected descriptor with advisory source metadata, safe
  same-origin URLs, versioned LODs, animation mappings and static budgets.
- Treat `physicalPosition`, `gamePosition` and `anchorMode` as separate controller state. Keyboard,
  joystick, accessible D-pad, tap-to-move and GPS all dispatch into the same pure
  `CharacterController`; the renderer only consumes geographic position and animation state.
- Keep the informational hierarchy in the standard left `PanelShell`. The map overlay contains
  only immediate movement controls and hides when the mobile panel is open.
- Measure draw calls, triangles, visible entities, an explicitly estimated GPU allocation and a
  bounded renderer-duration sample. These are early warnings, not a substitute for a supported
  device trace.

## Asset and source strategy

The current catalog is deliberately empty to keep the mobile-data release payload small. An
operator build may place versioned files below `/models/avatars/` and inject their descriptors;
source metadata is advisory while local URL and performance validation remains enforced.
No remote URL, identity SDK, wallet/commerce flow or database migration is part of this boundary.

## Consequences and rollback

The game now has an honest true-3D technical path and animated placeholder, but `GAME-004` is not
fully verified as an Aavegotchi model until an actual payload and device visual evidence exist.
The former `GAME-005`/`QUAL-010` licence-only acceptance is superseded by ADR 0012.

Set `VITE_GAME_AVATAR_V2=0` to select the pre-existing generic player and hide the new mobile
overlay/inventory choice. The same GameHost and gameplay entities remain, so rollback does not
remount MapCore or discard orb/quest/zone state. Removing every future avatar binary must keep the
neutral placeholder path green.
