# MapOS v20 Discover task and use-case UI r20 live evidence

- Release: `20260902-mapos-v20-ui-ux-r20`
- Public origin: `https://mapos.promptstudio3000.com`
- Deployment payload: 1,005,893 compressed bytes; dependencies, caches, generated output, local models and environment files were excluded.
- Rollback backup: `/opt/ps3000/apps/mapos-v3/backups/20260902-mapos-v20-ui-ux-r20`
- Source-rights and licensing metadata remain advisory only; they do not gate data, layers, UI, build, runtime or deployment.

## Delivered scope

- `Zjistit co je tady` starts one deduplicated Discover context request and registers it in the global Task Center as `Zjišťuji kontext oblasti`.
- The task is cancellable and retryable. User cancellation, a replaced viewport and panel close finish neutrally rather than producing a red provider error.
- Discover now exposes the four source-grounded intents directly in the panel: Výlet, Město, Cestování and Sport. The active choice has an explicit selected state and works at desktop and mobile widths.
- Selecting an intent applies its ordinary editable layer/category preset, passes the preset ID as `useCase` into the context/cache key and shows up to three nearest recommendations from features already loaded in the map. It starts no second POI request.
- The selected use case therefore reaches the structured/model context pipeline instead of remaining only a Layers-drawer presentation choice.

## Verification before deployment

- Complete web unit suite: 327 checks, 320 passed, 7 advisory skips, 0 failures.
- Focused Discover boundary/task/use-case browser suite: 3/3 passed.
- Combined Discover/shell/task/smoke browser regression: 31 scenarios passed after adding the missing offline Waymarked Trails tile fixture.
- Accessibility profile: 4/4 passed, including mobile 200% text and reduced motion.
- Visual profile: 17 scenarios passed after making the Events capture independent of previous session state.
- Inspected images: `e2e/screenshots/1440-discover-usecase.png` and `e2e/screenshots/390-discover-usecase.png`.
- Workspace lint, source/secret scan, web typecheck and complete production build passed.

## Public runtime smoke

The public check deliberately fetched only small HTML/health responses and the headers of the main asset.

- Public web, health, security headers and CSP reporting: passed
- Hostile credentialed CORS: blocked
- Unauthenticated account deletion: blocked
- Operations endpoint: protected
- HTML transferred for asset discovery: 1,217 bytes
- Main asset: `/assets/index-DmIbL3-R.js`, HTTP 200, declared 1,647,024 bytes with immutable caching; its body was not downloaded by this smoke
- Live loopback Discover context for the `city` use case: 4,999 bytes; boundary `ready`, geometry `Polygon`, region `Plzeňský kraj`, level `admin1`, source `nominatim-osm`
- Active symlink: `releases/20260902-mapos-v20-ui-ux-r20`
- API, web and PostgreSQL containers: healthy
- Verified rollback dump: `mapos.dump`, 30,452,275 bytes
- Loopback-only sample: 60 health requests, p50 0.004593 s, p95 0.007751 s; this is release evidence, not a production SLO claim.

This record closes `DISC-016`: the explicit action has one browser-proven deduplicated request and visible TaskRegistry state. It also closes `DISC-022`: the same viewport now has a browser-proven preset-dependent context key and visible intent-specific ordering, while the server prompt receives that use case. Broader Phase 9 boundary-catalogue and sourced-statistics requirements remain open.
