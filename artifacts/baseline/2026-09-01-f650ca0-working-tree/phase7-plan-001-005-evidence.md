# Phase 7 evidence — PLAN-001 through PLAN-005

Evidence date: 2026-09-01

Scope: the manual, non-AI planning slice only. This record does not close the rest of phase 7.

## Acceptance evidence

- `PLAN-001`: `e2e/planning.spec.ts` edits a draft, requests adjacent routing, creates the
  owner-bound PlanDocument through `POST /v2/plans`, removes both local plan keys, reloads from
  `GET /v2/plans`, and downloads/inspects the GPX. The test records AI/CML requests and asserts
  that the list stays empty.
- `PLAN-002`: the same browser flow changes the editable title, inspects the saved API response,
  removes local persistence and verifies that the title and stops are restored from the server.
- `PLAN-003`: the keyboard scenario verifies that departure is initially hidden in native
  `details`/`summary`, Enter opens “Více možností”, and the next Tab focuses the date input.
- `PLAN-004`: the browser request proves the canonical camper profile and dimensions reach the
  routing API and survive server reload. The 200%-text assertion reports no horizontal overflow
  inside the options disclosure.
- `PLAN-005`: all four canonical preferences are keyboard-reachable; the UI renders native or
  fallback capability state. Shared unit tests execute every provider/vehicle/preference mapping,
  and `docs/planning-routing.md` documents the exact provider request and fallback.

## Fresh commands and results

1. Targeted SDK/API/web planning tests:

   ```text
   node --import tsx --test packages/layer-sdk/src/v2/planRouting.test.ts \
     apps/api/src/services/adjacentRouteProvider.test.ts \
     apps/api/src/services/segmentRoutingService.test.ts \
     apps/api/src/routes/planV2Routes.test.ts \
     apps/api/src/services/planDocumentService.test.ts \
     apps/api/src/services/planExportService.test.ts \
     apps/web/src/planning/routingTask.test.ts

   tests 29; pass 29; fail 0; skipped 0
   ```

2. Zero-public-network browser acceptance:

   ```text
   npx playwright test e2e/planning.spec.ts --workers=1

   2 passed (8.4s)
   ```

   `e2e/fixtures/offlineTest.ts` blocks every non-loopback request that has no explicit local
   fixture and automatically asserts that the unexpected-external list is empty after each test.
   Both scenarios passed that assertion. The first scenario additionally asserted zero `/ai` and
   `/cml` requests.

3. Static gates:

   ```text
   npm run typecheck -w @mapos/layer-sdk  # pass
   npm run typecheck -w @mapos/web        # pass
   npx eslint <scoped planning files>      # pass
   ```

   The whole API workspace typecheck was also run but is not claimed as passing: it stopped at
   the concurrently owned, out-of-scope `apps/api/src/services/ai/toolCatalog.ts:855` with
   `TS2698` (spreading an `unknown` value). All targeted planning API tests above pass. This shared
   tree issue must be cleared before a release-wide API typecheck can be claimed.

## Explicit non-claims and remaining phase delta

- Memory routing is deterministic offline evidence, not proof that Mapy.com or OSM/OSRM honors a
  profile in production.
- Unsupported provider capabilities stay visible as fallbacks; no fast response is relabelled as
  shortest, adventure, or motorway-free.
- This record does not claim a live VPS deployment, live provider routing, complete StopInput/map
  picker behavior, unlimited interactive editing, plan handoffs, or adventure waypoint policy.
  Those later phase-7 requirements remain open.
