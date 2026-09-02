# MapOS v20 map-first Discover boundary r19 live evidence

- Release: `20260902-mapos-v20-ui-ux-r19`
- Public origin: `https://mapos.promptstudio3000.com`
- Deployment payload: 1,003,932 compressed bytes; dependencies, caches, generated output, local models and environment files were excluded.
- Rollback backup: `/opt/ps3000/apps/mapos-v3/backups/20260902-mapos-v20-ui-ux-r19`
- Source-rights and licensing metadata remain advisory only; they do not gate data, layers, UI, build, runtime or deployment.

## Delivered scope

- The existing cached Nominatim reverse lookup now requests a simplified real administrative polygon in the same response; the browser does not make a second boundary request.
- Zoom bands select country, first-level administration, second-level administration, locality or neighbourhood without assuming a Czech-only hierarchy. Larger areas use a stronger simplification threshold to bound payload size.
- Only validated closed Polygon/MultiPolygon geometry is accepted. A query bbox is never presented as the administrative boundary and malformed or point geometry retains the honest unavailable state.
- Discover renders the sourced geometry through its existing MapLibre GeoJSON fill/line source. A visible panel card identifies the boundary and provides `Ukázat celou`, which derives the fit extent from polygon coordinates.
- Closing the Discover panel no longer removes the map overlay. Clicking/tapping the polygon is handled by the persistent map core, reopens the Discover context and names the selected area.
- POI/pin hit-test priority remains above the region fill, so the new overlay does not steal clicks from detailed places.

## Verification before deployment

- Complete API test workspace passed, including sourced boundary normalization, hierarchy selection, malformed geometry rejection, caching and citations.
- Complete web unit suite: 326 checks, 319 passed, 7 advisory skips, 0 failures.
- Focused boundary model/service suite: 8/8 passed.
- Combined Discover/shell/map browser regression: 27/27 passed.
- Accessibility profile: 4/4 passed.
- Visual profiles: existing multi-surface Discover capture and the focused map-first boundary capture both passed.
- Inspected visual images: `e2e/screenshots/1440-discover-boundary-map.png` and `e2e/screenshots/390-discover-boundary-map.png`.
- Production build, workspace lint, web/API typecheck and secret/source scan passed.

## Public runtime smoke

The post-deployment check was deliberately bandwidth-light: it fetched only small HTML/health/context responses and the headers of the main asset.

- Public web, health, security headers and CSP reporting: passed
- Hostile credentialed CORS: blocked
- Unauthenticated account deletion: blocked
- Operations endpoint: protected
- Live loopback Discover context for Plzeň: 3,584 bytes; boundary `ready`, geometry `Polygon`, region `Plzeňský kraj`, level `admin1`, source `nominatim-osm`
- Main asset: `/assets/index-DY6wdmsI.js`, HTTP 200, declared 1,647,015 bytes with immutable caching; its body was not downloaded by this smoke
- HTML transferred for asset discovery: 1,217 bytes
- Active symlink: `releases/20260902-mapos-v20-ui-ux-r19`
- API, web and PostgreSQL containers: healthy
- Verified rollback dump: `mapos.dump`, 30,452,030 bytes
- Loopback-only container sample: 60 requests, p50 0.004662 s, p95 0.010963 s; this is release evidence, not a production SLO claim.

This record verifies the data-driven hierarchy acceptance in `DISC-002` and supplies a live, visible boundary slice for `DISC-001`, `DISC-003` and `DISC-004`. Those broader requirements remain open/partial because the current provider returns the selected area, not a pre-ingested queryable Europe-wide multi-level boundary catalogue, and polygon clicks currently reopen the selected center context rather than selecting among multiple simultaneously loaded regions.
