# Phase 2/3 shell UI evidence — v19

- Date: `2026-09-01`
- Scope: local/offline working tree
- Requirements: `LAY-002`, `LAY-012`, `LAY-014`, `LAYER-007`, `BASE-004`, `FOOT-007`

## Fresh checks

| Check                                                                           |         Result | Covered boundary                                                                                                                                                                    |
| ------------------------------------------------------------------------------- | -------------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web unit suite                                                                  | 285/285 passed | Existing shell, store and component behavior after the change.                                                                                                                      |
| New focused presentation helpers                                                |   14/14 passed | Width bounds/persistence, active-layer counting, basemap labels, preset keyboard navigation, grouped basemaps and legend presentation.                                              |
| Affected offline browser cluster                                                |   29/29 passed | Resizing without a map remount, live badge/accessible basemap label, narrow preset strip, manifest-driven accordions, expandable legends and existing shell/basemap/timeline flows. |
| Accessibility browser profile                                                   |     3/3 passed | Keyboard/focus, mobile 200% text and reduced motion.                                                                                                                                |
| 1100 × 900 dual-panel footer regression                                         |     1/1 passed | Concurrent left/right panels, timeline and expanded legend remain outside both drawers.                                                                                             |
| Web typecheck, scoped ESLint, Prettier, architecture check and production build |         passed | Static integration and production bundle remain valid.                                                                                                                              |

The offline browser fixture rejected every unexpected external request. The only explicit tile-style
stub was the exact OpenFreeMap fixture URL and returned a checked-in empty MapLibre style; no public
provider was contacted.

## Acceptance mapping

- `LAY-002`: desktop width defaults to 368 px, clamps to 320–480 px and at most 42vw, supports
  pointer and keyboard resize/reset, persists locally, and leaves the same `MapCore` instance alive.
- `LAY-012`: the badge counts active canonical POI/thematic layers and excludes structural overlays.
- `LAY-014`: the control shows a bounded short label while retaining the full accessible name/title.
- `LAYER-007`: all four presets form a no-wrap horizontal swipe strip with Arrow/Home/End keyboard
  navigation and focus-aware scrolling.
- `BASE-004`: native keyboard-operable accordions are derived from manifest groups; empty capability
  groups are omitted.
- `FOOT-007`: multiple legend contributions expose a compact summary and an accessible expandable
  per-layer list; responsive insets keep the legend/timeline stack out of simultaneous drawers.

## Explicit non-claims

This record does not claim v19 deployment, public-provider behavior, exact command-bar/mobile chrome
parity outside these rows, basemap screenshot generation, or completion of all Phase 2/3 requirements.
