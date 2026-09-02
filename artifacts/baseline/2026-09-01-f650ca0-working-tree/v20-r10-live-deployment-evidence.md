# MapOS v20 UI/UX r10 live deployment evidence

- Release: `20260902-mapos-v20-ui-ux-r10`
- Public origin: `https://mapos.promptstudio3000.com`
- Deployment payload: 971,819 compressed bytes; dependencies, caches, generated output, local models and environment files were excluded.
- Rollback backup: `/opt/ps3000/apps/mapos-v3/backups/20260902-mapos-v20-ui-ux-r10`

## Delivered scope

- `PLAN-019`: every real adjacent route geometry is retained as an independent selectable map feature. A direct map click highlights the exact segment in orange and synchronizes the corresponding planning card. Failed or unresolved gaps still never receive a fabricated connector.
- `PLAN-006`: a dated plan has a visible departure-context surface, shared timeline cursor, opt-in map weather action and timed per-segment context. Forecast warnings use only returned Open-Meteo values. Traffic and forecast gaps are explicitly labelled and never simulated.
- Weather context is data-bounded: one upstream batch, at most 20 evenly sampled stops, no automatic heavy weather-map fetch. Large-plan routing remains separately batched and uncapped at product level.
- The read-only share list no longer races link creation; a late list response merges rather than erases a newly created link.
- Source-rights and licensing metadata remain advisory and do not gate these flows.

## Verification before deployment

- Planning browser suite: 13/13 passed, including three connected selectable map segments, sourced dated context, shared timeline, explicit unavailable traffic, per-segment weather warnings, GPS fallback, large plans and durable collaboration.
- Complete API suite passed with exit code 0; the complete web suite passed with 292 tests, 7 advisory skips and 0 failures.
- Temporal-context service and route suites: 11 targeted checks passed, covering one bounded weather batch, timing/dwell propagation, risk warnings, out-of-range no-fetch behavior and transport contract.
- Route parity, API/web typechecks, ESLint, changed-file formatting, production builds and secret/source plus built-artifact scan passed.
- Visual browser evidence: `e2e/screenshots/1440-planning-selectable-segment.png` and `e2e/screenshots/1440-planning-temporal-context.png`.

## Public runtime smoke

The anonymous smoke made no persistent write and used one three-stop weather batch.

- Health HTTP: 200 (36 bytes)
- Web HTML HTTP: 200 (1,218 bytes)
- Current JavaScript asset HTTP: 200 (`/assets/index-COb4wOe_.js`)
- Two live adjacent OSM segments: HTTP 200, 2/2 ready, 2 provider calls, 3,293-byte response
- Dated temporal context: HTTP 200, `active`, Open-Meteo `ready`, 3/3 sampled stops, 1 upstream weather batch, 1,650-byte response
- Traffic context: explicitly `unavailable`; no value was inferred or simulated
- Active symlink: `releases/20260902-mapos-v20-ui-ux-r10`
- Rollback database backup is non-empty and verified.

The live smoke proves the deployed route/context endpoints and real forecast response. Direct segment selection and weather-risk rendering remain fresh browser evidence against controlled provider fixtures, so benign live weather producing zero warnings is not misreported as a warning-path test.
