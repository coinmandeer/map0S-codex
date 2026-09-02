# MapOS v20 Discover regional catalogue r22 live evidence

- Release: `20260902-mapos-v20-ui-ux-r22`
- Public origin: `https://mapos.promptstudio3000.com`
- Deployment payload: 1,014,492 compressed bytes; dependencies, caches, generated output, local models and environment files were excluded.
- Rollback backup: `/opt/ps3000/apps/mapos-v3/backups/20260902-mapos-v20-ui-ux-r22`
- Source-rights and licensing metadata remain advisory only; they do not gate data, layers, UI, build, runtime or deployment.

## Delivered scope

- Discover now requests the official Eurostat GISCO NUTS 2024 feature service by viewport bounding box and exactly one scale-appropriate NUTS level. The catalogue is Europe-wide, capped at 16 returned polygons and cached for seven days.
- Country views use NUTS 0, intermediate views use NUTS 1/2, closer regional views use NUTS 3, and locality views keep the selected Nominatim municipality without loading an unsuitable regional catalogue.
- One compact Eurostat statistics query resolves the returned codes to human-readable regional names. GISCO geometry is fetched as bounded text because its declared media type is `application/geo+json`.
- The Discover panel exposes a visible, responsive “Sousední správní plochy” section. Candidate polygons are blue, the selected polygon is amber, and either a polygon or its named button changes the map centre and triggers a new guide/context request.
- The map click resolver gives detailed POI pins priority over the regional overlay, so points remain operable wherever geometries overlap.
- Official provider references: `https://ec.europa.eu/eurostat/web/gisco/geodata/statistical-units/territorial-units-statistics` and `https://gisco-services.ec.europa.eu/features/collections/gisco.nuts_rg_20m_2024_4326.html`.

## Verification before deployment

- API suite: 415/415 passed.
- Web suite: 327 checks, 320 passed, 7 advisory source-rights skips, 0 failures.
- Focused catalogue/parser/context suite: 12/12 passed, including zoom-to-NUTS mapping, malformed/selected-region filtering, label resolution and truncation.
- Discover browser suite: 6/6 initially passed. It covers candidate selection, country-to-region replacement and POI-over-polygon priority.
- A deterministic combined 34-test browser run passed 33 unchanged scenarios and exposed one test-only stale-canvas resize target. After synchronizing MapLibre resize, the affected direct-polygon scenario passed 3/3 repeated runs; the extended country→region→locality scenario then passed separately.
- Accessibility profile: 4/4 passed, including mobile 200% text and reduced motion.
- Visual profile: 17/17 passed.
- Workspace lint, secret/source scan, complete typecheck, formatting check and production build passed.
- Inspected responsive images: `e2e/screenshots/1440-discover-regions.png` and `e2e/screenshots/390-discover-regions.png`.

## Public and live runtime evidence

The public smoke deliberately transferred only small HTML/health responses and the main-asset headers. Provider-backed responses were evaluated over VPS loopback and only their summaries crossed the mobile connection.

- Public web, health, security headers and CSP reporting: passed.
- Hostile credentialed CORS: blocked; unauthenticated account deletion: blocked; operations endpoint: protected.
- Public HTML transferred for exact byte count: 1,217 bytes.
- Main asset: `/assets/index-B0ihLztt.js`, declared 1,647,397 bytes with immutable caching; its body was not downloaded.
- Live zoom-7 response: 9,746 bytes; selected `Plzeňský kraj` (`admin1`), ready boundary, two sourced statistics and NUTS 3 catalogue.
- Live NUTS 3 catalogue: four returned neighbours — `Ústecký kraj (CZ042)`, `Jihočeský kraj (CZ031)`, `Karlovarský kraj (CZ041)` and `Středočeský kraj (CZ020)` — with `truncated=false` and the selected `CZ032` excluded.
- The identical second zoom-7 request returned `cache.hit=true` and 9,745 bytes without repeating provider work.
- Live zoom-4 response: 75,230 bytes; selected `Česko` (`country`), ready boundary and 16 bounded NUTS 0 country candidates.
- Live zoom-11 response: 4,269 bytes; selected `Plzeň` (`locality`), ready boundary and no mismatched regional catalogue.
- Live source list includes OpenStreetMap Nominatim, Wikivoyage, Wikidata, Eurostat statistics and `Eurostat GISCO · NUTS 2024`.
- Active symlink: `releases/20260902-mapos-v20-ui-ux-r22`; API, web and PostgreSQL containers healthy.
- Verified rollback dump: `mapos.dump`, 30,453,039 bytes.
- Loopback-only sample: 60 successful `/health` requests, p50 0.011607 s, p95 0.027235 s; this is release evidence, not a production SLO claim.

This record closes `DISC-001`, `DISC-003`, `DISC-004`, `DISC-007`, `DISC-008` and `MAP-017` at the r22 release scope: the live boundary sources cover country, regional and locality views, visible neighbouring polygons directly drive the context pipeline, zoom changes replace rather than mix administrative levels, and a browser hit-test selects a detailed POI above an active regional overlay.
