# MapOS v20 UI/UX r7 — route alternatives and cycling UX evidence

Date: 2026-09-02  
Public URL: `https://mapos.promptstudio3000.com`  
Release: `20260902-mapos-v20-ui-ux-r7`

Licence and source-rights metadata remains advisory for this prototype. Security, privacy and
technical validation boundaries remain enforced.

## Delivered scope

- OSM/OSRM adjacent-segment routing requests at most two recommendation-ranked alternatives;
- each segment can compare its recommendation and alternative by distance, duration and delta;
- selecting one alternative uses the canonical revisioned command and leaves neighbouring
  segments unchanged;
- the selected geometry immediately redraws on the map;
- the route uses a high-contrast casing and numbered stop markers;
- map fitting reserves room for the desktop Planning panel and the shared timeline;
- choosing the bike profile activates a CyclOSM recommendation with explicit accept/dismiss
  controls;
- activating CyclOSM adds it as an overlay and preserves the user's manually chosen base map;
- interactive OSRM responses use simplified GeoJSON, omit unused waypoint metadata and cap
  alternative count at two for mobile-data economy.

## Verification before deployment

- API, web and SDK type checks: passed;
- repository lint and changed-source formatting: passed;
- full API test suite: passed;
- full web suite: 291 passed, 7 advisory skips, 0 failed;
- focused routing/alternative unit tests: 14 passed;
- full Planning browser suite: 9 passed;
- API and web production builds: passed;
- secret/source and built-artifact scan: passed.

Visual evidence:

- `e2e/screenshots/1440-planning-alternatives.png`
- `e2e/screenshots/390-planning-bike-map.png`

## Data-efficient deployment and live verification

- compressed upload: 951,754 bytes;
- candidate build, restored-backup drill, migration replay and pre-cutover health: passed;
- verified backup: `/opt/ps3000/apps/mapos-v3/backups/20260902-mapos-v20-ui-ux-r7`;
- atomic cutover completed with healthy API, web and PostgreSQL services;
- active release symlink resolves to `20260902-mapos-v20-ui-ux-r7`;
- public health and current hashed application asset: HTTP 200;
- one unauthenticated two-stop live routing smoke returned HTTP 200 with two alternatives and an
  explicit selected recommendation;
- the largest returned alternative used 16 coordinates and the complete uncompressed JSON response
  was 2,513 bytes;
- the live smoke created no account, plan row, share link or AI request.

This evidence completes PLAN-026 at offline/browser scope and PLAN-027 at live-provider scope. It
does not claim that PLAN-025 adventure POI scoring and detour control is implemented.
