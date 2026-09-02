# MapOS v20 UI/UX r3–r5 — live deployment evidence

Date: 2026-09-02  
Public URL: `https://mapos.promptstudio3000.com`

Licence and source-rights metadata is advisory throughout these prototype releases. Security,
privacy, ownership, moderation and technical validation boundaries remain enforced.

## r3 — planning actions and scoped AI

Release: `20260902-mapos-v20-ui-ux-r3`

- removed the generic POI/nearby-place block from Planning;
- added save, native content sharing with copy fallback, itinerary copy and GPX, GeoJSON, KML and
  MapOS JSON exports;
- added bounded handoffs to Google Maps, Mapy.com and OpenStreetMap-compatible routing;
- added a clearly disclosed plan-scoped AI discussion that cannot silently mutate the plan;
- the external model projection omits private notes, identity, conversation IDs and arbitrary
  metadata;
- added route summary and provider-limit wording.

Verification before deployment:

- API: 391 passed, 0 failed;
- web: 297 total, 290 passed, 7 advisory skips, 0 failed;
- focused planning/shell browser scenarios: 15 passed;
- API and web type checks, scoped lint and production builds: passed;
- visual captures at 1440, 768 and 390 px: passed.

Deployment:

- compressed payload: 930,433 bytes;
- verified backup: `/opt/ps3000/apps/mapos-v3/backups/20260902-mapos-v20-ui-ux-r3`;
- candidate and post-cutover API/web/PostgreSQL health: passed;
- all public smoke and security checks: passed.

## r4 — Node 22 secure upstream compatibility

Release: `20260902-mapos-v20-ui-ux-r4`

- fixed the pinned-DNS HTTPS client for Node 22's `{ all: true }` lookup contract;
- retained DNS pinning and mixed/private-address rejection while allowing valid public providers;
- added scalar and all-address lookup regression coverage.

Verification before deployment:

- API: 392 passed, 0 failed (two consecutive full runs after one non-reproduced transient test
  failure);
- compressed payload: 930,791 bytes;
- verified backup: `/opt/ps3000/apps/mapos-v3/backups/20260902-mapos-v20-ui-ux-r4`;
- all public smoke and security checks: passed;
- live synthetic plan discussion: HTTP 200, configured Ollama model returned a non-empty answer and
  the disclosure was present. No user plan or private data was used.

## r5 — visible Discover guide redesign

Release: `20260902-mapos-v20-ui-ux-r5`

- replaced the sparse Discover panel with a map-centred guide surface containing a region hero,
  administrative breadcrumb, quick facts, source/model summary, collapsible guide sections and
  accessible map-place list;
- added the required weather accordion with current conditions and a compact multi-day strip;
- weather performs no request until the user opens the accordion and reuses the loaded result when
  collapsed and reopened;
- the explicit `Zjistit co je tady` action can now produce a labelled AI summary from bounded public
  region/guide context and active-use-case metadata;
- removed licence-gate wording from the boundary notice. Missing administrative geometry remains an
  honest technical-data limitation and no bbox is presented as a real border;
- added light/dark responsive visual evidence for 1440, 1024, 768, 390 and 360 px, plus explicit
  Discover and expanded-weather captures.

Verification before deployment:

- API: 393 passed, 0 failed;
- web: 297 total, 290 passed, 7 advisory skips, 0 failed;
- focused Discover browser scenarios: 3 passed;
- visual matrix: 11 passed; focused Discover/game capture: passed;
- API and web type checks, scoped lint and production builds: passed.

Data-efficient deployment:

- compressed payload: 934,739 bytes;
- verified backup: `/opt/ps3000/apps/mapos-v3/backups/20260902-mapos-v20-ui-ux-r5`;
- candidate and post-cutover API/web/PostgreSQL health: passed;
- all public smoke and security checks: passed;
- live public Discover request: HTTP 200, resolved `Plzeň 3`, returned two public sources and a
  labelled non-empty model summary from the configured Ollama model.

This evidence records exact verified slices. It does not claim the entire source-grounded master
plan is complete; durable share links, boundary ingestion and other open requirements remain tracked.
