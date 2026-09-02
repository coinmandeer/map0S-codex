# MapOS v20 Discover contribution UI r24 live evidence

- Release: `20260902-mapos-v20-ui-ux-r24`
- Public origin: `https://mapos.promptstudio3000.com`
- Deployment payload: 1,021,996 compressed bytes; dependencies, caches, generated output, local models and environment files were excluded.
- Rollback backup: `/opt/ps3000/apps/mapos-v3/backups/20260902-mapos-v20-ui-ux-r24`
- Source-rights and licensing metadata remain advisory only; they do not gate data, layers, UI, build, runtime or deployment.

## Delivered scope

- A first visit now opens at the privacy-safe Europe overview (`lng=10.2`, `lat=51`, `z=4`). Exact location is requested only after the explicit **Moje poloha** action; denied GPS keeps the safe view and shows a non-blocking explanation instead of inventing a precise location.
- Discover context providers are independently registered capabilities. Guide, regional statistics and the regional catalogue execute in isolation, expose their own ready/empty/error state and can be extended without adding a fixed statistic section to the UI.
- The Discover panel now contains a prominent **Komunitní mapa** contribution card and a readable three-stage `Koncept → Kontrola → Zveřejnění` journey on desktop and mobile.
- A Discover contribution is never published immediately. The server owns its author, provenance timestamp, revision and moderation state; client-supplied approval, revision and author fields are ignored. Submission advances revision 1 to revision 2 in `in-review`.
- The contribution UI exposes origin, author binding and revision status before submission. Review is an open moderation workflow, not a licensing gate.

## Verification before deployment

- API suite: 418/418 passed.
- Web unit suite: 321 passed, 7 advisory source-rights skips, 0 failures.
- Full API and web typechecks, lint, formatting, secret scan and production builds passed.
- Existing attribution/auth/basemap/data-layer regression: 17/17 passed serially.
- Relevant Discover/contribution/geolocation/smoke/weather/events regression: 29/30 passed in the combined serial run. One pre-existing nested-weather-accordion timing scenario briefly closed its parent accordion; the exact scenario then passed 1/1 on immediate focused rerun.
- Accessibility profile: 4/4 passed. Visual profile: 17/17 passed.
- A first three-worker full Playwright attempt overloaded the local Vite/WebGL fixture during cold starts and was stopped; affected and release-relevant scenarios were rerun serially as recorded above.
- Inspected desktop and mobile images: `e2e/screenshots/1440-discover-contribute.png`, `e2e/screenshots/1440-discover-review.png`, `e2e/screenshots/390-discover-contribute.png` and `e2e/screenshots/390-discover-review.png`. The contribution card and wizard remained readable without horizontal overflow at 390 px.

## Public and live runtime evidence

Only the 1,217-byte HTML, API summaries and headers crossed the mobile connection; the main JavaScript body was not downloaded.

- Public API health returned `status=ok`.
- Public HTML: 1,217 bytes.
- Main asset: `/assets/index-B1mymcEK.js`, declared 1,648,808 bytes; only headers were requested.
- A live Plzeň Discover request returned three independent capabilities: `guide=ready`, `regional-statistics=empty` and `region-catalogue=empty` at locality zoom 12. The ready guide remained available even though the two viewport-inapplicable capabilities were empty.
- A live authenticated contribution test rejected forged author and approval fields, preserved `provenance.source=discover`, assigned a real author and returned `status=in-review`, `revision=2`.
- The test draft and its temporary guest account were deleted immediately; deletion reported zero retained objects.
- Active symlink: `/opt/ps3000/apps/mapos-v3/releases/20260902-mapos-v20-ui-ux-r24`; API, web and PostgreSQL containers were healthy.
- Verified rollback dump: `mapos.dump`, 30,454,069 bytes.
- Loopback-only sample: 60 successful `/health` requests, p50 7.305 ms and p95 13.481 ms; this is release evidence, not a production SLO claim.

This record closes `DISC-006`, `DISC-020` and `DISC-023` at the r24 release scope and completes the Phase 9 Discover acceptance set.
