# MapOS Phase 1 — release evidence

- Date: `2026-09-01`
- Release: `20260901-mapos-v17-sdk-v2-security`
- Production: `https://mapos.promptstudio3000.com`
- Previous release / rollback target: `20260830-mapos-v16-integrated-shell`

## Delivered slice

1. Added additive `@mapos/layer-sdk` v2 contracts for version envelopes, full GeoJSON geometry, source provenance/access, queries/results, layer manifests and their detail/action/legend/permission/temporal/commerce/AI fields.
2. Added the canonical Draft 2020-12 feature and layer schemas plus validated fixtures.
3. Added deterministic v1↔v2 feature adapters, a v1→v2 manifest adapter, a v2→v1 host view and structured rejection of unsupported schema majors.
4. Migrated the `earthquakes` layer to a native v2 manifest and `/api/v2/layers/earthquakes/features` while preserving the existing circles, labels, filters and attribution.
5. Added a deterministic offline earthquake provider for API/web contract tests. A hostile `limit=10000` is clamped to 100 server-side.
6. Closed three release blockers: session-scoped private layer cache with late-response protection; owner/public ACL for user-pin detail; allowlisted HTTPS-only embed probes with redirect revalidation and response/timeout limits.
7. Replaced the old deployment flow with staged build, verified DB/env backup, preserved model/volume state, atomic activation, health checks and rollback.

## Local verification

| Gate                     |                             Result |
| ------------------------ | ---------------------------------: |
| Clean dependency install |    passed offline from local cache |
| Typecheck                |                 SDK/API/web passed |
| Unit and contract tests  | 234 passed: SDK 8, API 140, web 86 |
| Lint                     |                             passed |
| Format                   |                             passed |
| Production build         |                             passed |

The production build retains the known Vite warning for the large main and game chunks. Full Playwright was not run because its current memory setup can still load live styles/tiles/providers; running it would contradict the requested mobile-data constraint. The changed browser contract and session race are covered by offline web tests instead.

## Deployment evidence

- Local upload payload: `468148` compressed bytes for the deployed release (about 0.47 MB).
- VPS DB dump and production-env checksums: verified before cutover.
- Final active symlink: `releases/20260901-mapos-v17-sdk-v2-security`.
- Post-cutover API, web and Postgres: healthy, restart count `0`.
- VPS-local `/health`: passed.
- VPS-local and public v2 query: passed; `limit=10000` reported `limit=100` and returned no more than 100 features.
- VPS-local private-address embed probe: blocked.
- Recent API/web logs: no critical startup pattern.
- Public root: HTTP 200 with CSP present.

An initial rollout invocation safely stopped after staging/build/backup because the remote dump process consumed the script stdin; the old release remained active. Cutover was then completed with the already verified artifacts. The deployment script now detaches `pg_dump` from script stdin and independently verifies the active symlink before reporting success.

## Rollback

The previous symlink target and tagged API/web images remain available. Application schema changes in this slice are additive and require no database down-migration; if runtime health fails, restore the previous symlink/images and start the existing compose project with `--no-build --force-recreate --wait`.
