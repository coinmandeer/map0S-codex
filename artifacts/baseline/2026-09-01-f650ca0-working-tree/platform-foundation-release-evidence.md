# MapOS platform foundation — release evidence

- Date: `2026-09-01`
- Release: `20260901-mapos-v18-platform-foundation`
- Production: `https://mapos.promptstudio3000.com`
- Previous release / rollback target: `20260901-mapos-v17-sdk-v2-security`

## Delivered slice

1. Closed the Phase 0 evidence gates with a machine-readable production/memory route inventory,
   intentional-drift tests, architecture-boundary checks and an explicit zero-upstream offline
   fixture mode.
2. Kept the Phase 1 v2 SDK additive and extended it with the attached `TaskRecord` contract.
   Every legacy and v2 feature provider now enforces the shared per-layer ceiling of 100.
3. Added the Phase 2 shell facade and exactly four canonical modes (`personal`, `discover`,
   `planning`, `game`). Legacy `mine`, `poi` and `weather` links resolve to meaningful canonical
   state; a weather link activates the weather layer.
4. Implemented the Phase 3 taxonomy: exclusive basemaps and six additive structural overlays live
   in **Mapové podklady**; Weather and Events remain normal Layers. The UI exposes exactly four
   source-grounded presets. Timeline and legend visibility are derived from active manifest
   contributions.
5. Added the Phase 4 `TaskRegistry`, bounded LayerEngine concurrency, immediate stale/abort handling
   and typed task status/cancel feedback.
6. Replaced the inline database bootstrap with checksumed `0001_baseline_snapshot` and additive
   `0002_spatial_columns` migrations under an advisory lock. Nine point tables retain `lng/lat` and
   gain nullable `geography(Point,4326)`; game zones also gain a polygon. Validated 5,000-row
   backfills and ten concurrent GiST indexes are retry-safe.
7. Hardened the public API with exact credentialed CORS, a separate mutation-Origin guard,
   address/CIDR proxy trust, bounded process-local rate limits, body/runtime schemas and an
   authenticated canonicalize route. Synthetic staking is disabled unless explicitly enabled.

The complete D06 AppShell host/orchestration redesign remains a subsequent compatible slice; this
release deliberately retains the current content and `MapCore` mounting structure.

## Local verification

| Gate                    |                                         Result |
| ----------------------- | ---------------------------------------------: |
| Architecture boundaries | 0 violations; 1,026 imports / 268 source files |
| Unit and contract tests |           288 passed: SDK 10, API 169, web 109 |
| Typecheck               |                             SDK/API/web passed |
| Lint                    |                                         passed |
| Format and whitespace   |                                         passed |
| Production build        |                                         passed |
| Offline browser smoke   |    1 passed; zero unexpected external requests |

The build retains the known Vite warning for the large main and game chunks. Network-backed E2E was
not run; the changed shell, offline, query, task, taxonomy and migration contracts are covered by
unit/contract tests and the isolated offline Playwright profile.

## Deployment and live verification

- Uploaded `479791` compressed bytes in one release archive.
- Staged images were built while v17 stayed live; database dump and environment backup were
  verified before the atomic cutover.
- Active symlink: `releases/20260901-mapos-v18-platform-foundation`.
- API, web and Postgres are healthy with restart count `0`; Nginx configuration test passed and
  recent API/web logs contain no critical startup pattern.
- Public web and health return HTTP 200 with CSP present. Same-origin guest bootstrap returns 200;
  unauthenticated canonicalize returns 401; prototype staking returns 404. An attacker-origin
  preflight receives no credentialed CORS headers.
- The hostile v2 query `limit=10000` reports `limit=100` and returns no more than 100 features.
- Migration ledger contains `0001` and `0002` with the immutable release tag. The first rollout
  exposed that the tag had not yet been passed through Compose; the two just-created
  `unknown-release` metadata values were conditionally corrected, and the deploy/Compose sources
  now inject the tag for all subsequent releases.
- Production has ten GiST indexes. `EXPLAIN (ANALYZE, BUFFERS)` on `canonical_places` selected
  `canonical_places_geog_gist` and completed in `0.677 ms` on the current small dataset.

## Rollback

The prior v17 symlink and tagged API/web images remain available. Both database migrations are
additive and preserve the old coordinate columns, so the application can roll back without a
down-migration. The deployment script restores the previous symlink/images automatically if any
post-cutover health check fails.
