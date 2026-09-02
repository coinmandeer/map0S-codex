# MapOS v20 adaptive weather UI r23 live evidence

- Release: `20260902-mapos-v20-ui-ux-r23`
- Public origin: `https://mapos.promptstudio3000.com`
- Deployment payload: 1,015,620 compressed bytes; dependencies, caches, generated output, local models and environment files were excluded.
- Rollback backup: `/opt/ps3000/apps/mapos-v3/backups/20260902-mapos-v20-ui-ux-r23`
- Source-rights and licensing metadata remain advisory only; they do not gate data, layers, UI, build, runtime or deployment.

## Delivered scope

- Regional zoom renders a vivid continuous colour field from one bounded provider grid and displays the matching variable ramp, unit, valid time, viewport median/range and Open-Meteo attribution in the shared timeline.
- Closer zooms progressively use coloured cells and local numeric sectors instead of stretching the regional representation beyond its useful scale.
- Hover and touch/click now feed the same typed weather-cell event and the same visible timeline detail. The card identifies preview versus selected place, shows the exact value, variable and valid time, and remains dismissible.
- POI hit-testing stays ahead of weather, while weather cells stay ahead of an underlying Discover region. A tap therefore opens the most specific available surface.
- Variable changes update the existing canvas source/layer in place. A browser lifecycle assertion proves the MapLibre instance, source identity and base style stay stable across `Teplota → Oblačnost → Teplota` with zero `style.load` events and one grid layer.
- If a camera move ends while a source is still loading, the most recent viewport refresh is retained and completed on the first MapLibre idle event instead of being dropped. This removes the stale-scale edge case without resetting the basemap.

## Verification before deployment

- Web suite: 327 checks, 320 passed, 7 advisory source-rights skips, 0 failures.
- Focused adaptive-weather browser flow: 1/1 passed with a touch-capable context, regional and local render strategies, equal hover/tap value, stable source identity and no style reload.
- Deterministic combined Discover/shell/smoke/weather/task regression: 37/38 passed in one run; the only failure was a pre-existing first-start Discover fixture timeout and that exact scenario passed immediately in a focused rerun. The new weather scenario passed in the combined run.
- Accessibility profile: 4/4 passed, including mobile 200% text and reduced motion.
- Visual profile: 16/17 passed in one run; the unrelated final Search fixture timed out once and passed in an immediate focused rerun. Both new weather screenshots were inspected separately.
- Workspace lint, secret/source scan, complete typecheck, formatting check and production build passed.
- Inspected images: `e2e/screenshots/1440-weather-regional.png` and `e2e/screenshots/390-weather-local-tap.png`.

## Public and live runtime evidence

The public smoke transferred only small HTML/health responses and the main-asset headers. The live provider grid was evaluated over VPS loopback and only its summary crossed the mobile connection.

- Public web, health, security headers and CSP reporting: passed.
- Hostile credentialed CORS: blocked; unauthenticated account deletion: blocked; operations endpoint: protected.
- Public HTML transferred for exact byte count: 1,217 bytes.
- Main asset: `/assets/index-BUOW6NkP.js`, declared 1,648,769 bytes with immutable caching; its body was not downloaded.
- Live loopback Open-Meteo grid: HTTP 200, 389 bytes, `temperature`, 6×5 / 30 valid samples, 19.6–23.0 °C, median 21.8 °C and valid time `2026-09-02T11:00:00.000Z`.
- A repeated identical request returned the same bounded 389-byte grid.
- Active symlink: `releases/20260902-mapos-v20-ui-ux-r23`; API, web and PostgreSQL containers healthy.
- Verified rollback dump: `mapos.dump`, 30,453,525 bytes.
- Loopback-only sample: 60 successful `/health` requests, p50 0.005413 s, p95 0.009698 s; this is release evidence, not a production SLO claim.

This record closes `WX-005`, `WX-013` and `WX-015` at the r23 release scope: the regional colour field and corresponding legend are browser-visible, touch selects the same cell value as hover, and repeated visualization/zoom changes preserve the MapLibre/style/source lifecycle without flicker-producing resets.
