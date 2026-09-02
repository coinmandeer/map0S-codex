# MapOS v20 daily weather detail r17 live evidence

- Release: `20260902-mapos-v20-ui-ux-r17`
- Public origin: `https://mapos.promptstudio3000.com`
- Deployment payload: 997,935 compressed bytes; dependencies, caches, generated output, local models and environment files were excluded.
- Rollback backup: `/opt/ps3000/apps/mapos-v3/backups/20260902-mapos-v20-ui-ux-r17`
- Source-rights and licensing metadata remain advisory only; they do not gate data, layers, UI, build, runtime or deployment.

## Delivered scope

- Both Discover weather and the selected-place Weather panel now use the same accessible seven-day forecast presentation.
- Every day is a separate closed accordion row with date, condition icon, minimum/maximum temperature and precipitation summary.
- Opening one day reveals only that day's available hourly forecast, sampled at a deterministic three-hour interval and labelled with time, temperature and precipitation.
- Hourly values use a responsive wrapping grid instead of a week-wide horizontal strip, so desktop and 390 px mobile layouts remain free of horizontal overflow.
- A source with no hourly values keeps the daily forecast usable and shows an explicit no-detail state instead of inventing data.
- Discover remains data-efficient: no weather request is made before the forecast accordion opens, the result is reused after collapse/reopen, and the request is registered in the global task center with safe cancellation and retry.

## Verification before deployment

- Complete web unit suite: 322 checks, 315 passed, 7 advisory skips, 0 failures.
- New forecast-detail unit coverage verifies exact local-day selection, deterministic three-hour sampling and bounded Czech date/time formatting.
- Combined shell/task/smoke browser regression: 28/28 passed, including lazy one-request weather loading, per-day hourly detail and mobile overflow assertions.
- Accessibility profile: 4/4 passed, including keyboard focus, 200% mobile text and reduced motion.
- Visual capture profile: 1/1 passed across 1440 px, 768 px and 390 px viewports.
- Inspected visual images: `e2e/screenshots/1440-discover-weather.png` and `e2e/screenshots/390-discover-weather.png`.
- Production build, workspace lint, typecheck, secret/source scan and formatting checks passed.

## Public runtime smoke

The post-deployment check was deliberately bandwidth-light: it fetched only the small HTML/health responses and the headers of the main asset.

- Public web, health, security headers and CSP reporting: passed
- Hostile credentialed CORS: blocked
- Unauthenticated account deletion: blocked
- Operations endpoint: protected
- Main asset: `/assets/index-FhhDxE5q.js`, HTTP 200, declared 1,646,164 bytes with immutable caching; its body was not downloaded by this smoke
- HTML transferred for asset discovery: 1,217 bytes
- Active symlink: `releases/20260902-mapos-v20-ui-ux-r17`
- API, web and PostgreSQL containers: healthy
- Verified rollback dump: `mapos.dump`, 30,447,745 bytes
- Backup bundle contains the dump, checksum list, restore drill, PostGIS plan and HTTP soak record.
- Loopback-only container sample: 60 requests, p50 0.006958 s, p95 0.013281 s; this is release evidence, not a production SLO claim.

This record verifies `WX-010` at the stated live scope. The remaining open phase-10 requirements, including zoom visual acceptance, touch parity for map-cell detail and no-flicker performance evidence, remain tracked separately.
