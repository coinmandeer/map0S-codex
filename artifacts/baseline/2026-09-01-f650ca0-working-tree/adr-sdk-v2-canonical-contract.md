# ADR-P0-001 — Canonical Layer SDK v2 contract baseline

- Date: `2026-09-01`
- Status: proposed for Phase 1 implementation
- Scope: `@mapos/layer-sdk` v2 compatibility slice

## Context

The source-grounded plan contains several illustrative shapes whose version literals, feature-query paths and field names are not fully consistent. The nine files in `schemas/v2/` and twelve validated files in `examples/v2/` form the most precise machine-readable baseline and must not be replaced by a second unrelated domain model.

## Decision

1. `schemas/v2/*.schema.json` and `examples/v2/*.json` are the canonical Phase 1 contract inputs.
2. New v2 documents use semantic version `2.0.0`; validators accept only the supported `2.x.x` range defined by the schemas.
3. The public viewport feature endpoint is `GET /api/v2/layers/:id/features`.
4. A viewport POI query is clamped server-side to at most `100` full features per layer/query. Client input cannot raise this limit; truncation and cursor metadata remain explicit.
5. Existing v1 SDK exports, manifests, routes and first-party layers remain operational through a compatibility adapter during the migration window.
6. An unknown major schema/manifest version fails safely with a structured compatibility error and must not crash or partially apply data.
7. The first implementation slice migrates one simple fixture-backed first-party POI layer without a visual behavior change.

## Consequences

- Phase 1 adds v2 contracts and runtime validation aditively inside `@mapos/layer-sdk`.
- Prose examples that disagree with the machine-readable schemas are reconciled through this ADR rather than copied into parallel types.
- V1 removal is out of scope until adapter parity, contract tests, rollout evidence and a rollback window exist.
- API, web and SDK tests must cover schema validation, the 100-result clamp, v1 parity and safe rejection of unknown major versions.

## Rollback

Disable the v2 host path and continue serving v1 through the existing exports and routes. No v1 contract or persisted data is removed by the first slice.
