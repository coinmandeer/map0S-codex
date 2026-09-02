# MapOS v20 Discover sourced statistics r21 live evidence

- Release: `20260902-mapos-v20-ui-ux-r21`
- Public origin: `https://mapos.promptstudio3000.com`
- Deployment payload: 1,011,106 compressed bytes; dependencies, caches, generated output, local models and environment files were excluded.
- Rollback backup: `/opt/ps3000/apps/mapos-v3/backups/20260902-mapos-v20-ui-ux-r21`
- Source-rights and licensing metadata remain advisory only; they do not gate data, layers, UI, build, runtime or deployment.

## Delivered scope

- Discover exposes a generic sourced-statistics section rather than a fixed UI section per provider.
- The population card shows the newest dated, non-deprecated Wikidata population statement, its regional scope, year and explicit community-data uncertainty. Nominatim population remains a bounded fallback when Wikidata has no usable statement.
- The economic card shows Eurostat regional GDP per person in current prices, its NUTS code, reference year and explicit regional-aggregate wording. It is not presented as a household wage, live value or forecast.
- Nominatim supplies only the join identifiers (`wikidata`, `ref:nuts`) and the public response does not expose those internal joins outside each statistic's declared scope.
- Wikidata and Eurostat are requested in parallel through the bounded upstream client, cached for seven days and capped at 512 KiB and 128 KiB respectively. The complete Discover context remains deduplicated and cached for the viewport/use-case key.

## Verification before deployment

- API suite: 413/413 passed.
- Web suite: 327 checks, 320 passed, 7 advisory source-rights skips, 0 failures.
- Focused parser/context suite: 10/10 passed, including dated Wikidata selection, deprecated-statement rejection and exact one-cell Eurostat parsing.
- Discover browser suite: 3/3 passed with both sourced cards at desktop and mobile widths.
- Combined Discover/shell/task/smoke browser regression: 31/31 passed.
- Accessibility profile: 4/4 passed, including mobile 200% text and reduced motion.
- Visual profile: 17/17 passed.
- Workspace lint, source/secret scan, API/web typecheck, focused formatting check and complete production build passed.
- Inspected images: `e2e/screenshots/1440-discover-usecase.png` and `e2e/screenshots/390-discover-usecase.png`.

## Public and live runtime evidence

The public smoke deliberately transferred only small HTML/health responses and the main-asset headers. The provider-backed response was checked over VPS loopback.

- Public web, health, security headers and CSP reporting: passed.
- Hostile credentialed CORS: blocked; unauthenticated account deletion: blocked; operations endpoint: protected.
- Public HTML transferred for exact byte count: 1,218 bytes.
- Main asset: `/assets/index-CEpzvmkW.js`, HTTP 200, declared 1,647,024 bytes with immutable caching; its body was not downloaded.
- Live loopback Discover context: 6,386 bytes; region `Plzeňský kraj`, `admin1`, ready `Polygon`, source `nominatim-osm`.
- Live population: `614640`, year `2025`, uncertainty `reported-community-data`, source `wikidata:Q46070`.
- Live regional GDP per person: `25300 EUR`, year `2024`, geographic code `CZ032`, uncertainty `regional-aggregate`, source `eurostat:nama_10r_3gdp`.
- A repeated identical request returned `cache.hit=true`, two statistics and one ready statistics block without repeating provider work.
- Active symlink: `releases/20260902-mapos-v20-ui-ux-r21`; API, web and PostgreSQL containers healthy.
- Verified rollback dump: `mapos.dump`, 30,452,603 bytes.
- Loopback-only sample: 60 health requests, p50 0.004987 s, p95 0.015186 s; this is release evidence, not a production SLO claim.

This record closes `DISC-018`: population is live with source, aggregation level, year and uncertainty. It closes `DISC-019`: the live economic metric has an advisory rights label, geographic scope, date and explicit aggregate semantics. It moves `DISC-020` from gap to partial: multiple provider statistics render through one generic UI collection, while a separately registered context-capability catalogue remains open.
