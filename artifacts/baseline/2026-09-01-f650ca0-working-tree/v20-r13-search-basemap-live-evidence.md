# MapOS v20 Search and basemap recovery r13 live evidence

- Release: `20260902-mapos-v20-ui-ux-r13`
- Public origin: `https://mapos.promptstudio3000.com`
- Deployment payload: 982,339 compressed bytes; dependencies, caches, generated output, local models and environment files were excluded.
- Rollback backup: `/opt/ps3000/apps/mapos-v3/backups/20260902-mapos-v20-ui-ux-r13`
- Source-rights and licensing metadata remain advisory only; they do not gate data, layers, UI, build or deployment.

## Delivered scope

- Global search now actually performs geocoder requests under React StrictMode; its request runner is cancelled on remount instead of being permanently disposed.
- Geocoder results visibly carry type, administrative hierarchy, source and an explicitly ordinal confidence label. Nominatim requests include address details; Mapy.com preserves its regional structure.
- Ambiguous input offers two visible paths: ordinary geocoding or AI. Typing, opening the AI preview and reviewing a proposed layer change send no AI request.
- The AI path uses the map centre and a dedicated global conversation scope. If the POI layer is inactive, activation is a preview command and requires confirmation.
- AI POI candidates remain source-labelled, open in the shared fixed-centre map picker, and a confirmed candidate returns to the same visible global-search conversation.
- Structured candidates can be rendered as working pins over the current basemap and active layers, or converted into an editable PlanDocument whose candidate stops remain `suggested` until the user accepts or edits them.
- A background draw failure now switches to the emergency style with an eight-second live status while restoring active overlays. A later explicit background choice gets one fresh recovery attempt without creating an error loop.
- Bike planning recommends CyclOSM but never overwrites the user's stored background; activation and dismissal are explicit.

## Verification before deployment

- Complete web unit suite: 304 checks, 297 passed, 7 advisory skips, 0 failures.
- Complete API unit suite: 407 checks, 407 passed, 0 failures, including the new geocoder-presentation tests.
- Focused browser regression: 33/33 passed across basemaps, global search, planning and shell behavior.
- Search flow: 2/2 passed, including zero AI calls before confirmation, confirmed POI-layer preview, global scope persistence across mode switches, candidate map round-trip, working-pin rendering and editable-plan creation.
- Basemap flow: 7/7 passed, including visible failure fallback with active overlay restoration.
- Accessibility profile: 3/3 passed.
- Search visual scenario: 1/1 passed at 1440 px and 390 px. Inspected images: `e2e/screenshots/1440-search-grounded.png`, `e2e/screenshots/1440-search-ai-results.png`, `e2e/screenshots/390-search-grounded.png` and `e2e/screenshots/390-search-ai-results.png`.
- Production SDK, runtime, API, web and starter builds passed. API/web typechecks, ESLint, formatting, secret/source scans and architecture-boundary checks passed.

## Public runtime smoke

The post-deployment check was deliberately bandwidth-light: it fetched only the small HTML/health responses and the headers of the new main asset.

- Public web, health, security headers and CSP reporting: passed
- Hostile credentialed CORS: blocked
- Unauthenticated account deletion: blocked
- Operations endpoint: protected
- New main asset: `/assets/index-Iy-vkNOX.js`, HTTP 200, declared 1,639,309 bytes; its body was not downloaded by this smoke
- Active symlink: `releases/20260902-mapos-v20-ui-ux-r13`
- API, web and PostgreSQL containers: healthy
- Verified rollback dump: `mapos.dump`, 30,449,281 bytes
- Loopback-only container sample: 60 requests, p50 0.005172 s, p95 0.008831 s; this is release evidence, not a production SLO claim
