# MapOS v20 UI/UX r2 — live deployment evidence

Date: 2026-09-02
Release: `20260902-mapos-v20-ui-ux-r2`
Public URL: `https://mapos.promptstudio3000.com`

## Delivered UI/UX slice

- mobile mode content dismisses by a downward gesture and by keyboard from the peek state;
- `Nový plán` creates a genuinely clean draft rather than rehydrating the prior plan;
- a planning stop accepts common GPS forms, locality/address/POI geocoding and an explicit AI query;
- AI stop results remain suggestions until the fixed-center map picker is confirmed;
- Layers and basemap controls remain usable while the map picker is active;
- route handoff actions generate bounded Google Maps, Mapy.com and OpenStreetMap URLs and explain provider point limits;
- Personal omits zero-value headline statistics and keeps lazy sections collapsed.

Licence and source-rights metadata remains advisory throughout the prototype. Security, privacy,
ownership, moderation and technical validation boundaries remain enforced.

## Local verification before deployment

- focused planning/shell browser scenarios: 14 passed;
- web unit suite: 296 total, 289 passed, 7 explicit advisory skips, 0 failed;
- web TypeScript check: passed;
- scoped ESLint check: passed;
- production web build: passed;
- visual capture across 1440, 768 and 390 px: passed.

## Data-efficient deployment

- compressed release payload: 924,927 bytes;
- staged API and web images were built while the previous release stayed live;
- candidate API and web health checks passed before cutover;
- database backup `/opt/ps3000/apps/mapos-v3/backups/20260902-mapos-v20-ui-ux-r2` was verified;
- `current` was atomically switched to
  `/opt/ps3000/apps/mapos-v3/releases/20260902-mapos-v20-ui-ux-r2`;
- API, web and PostgreSQL containers reported `healthy` after cutover.

Live web assets:

- `PlanningPanel-BdIhaj6V.js`
- `index-DqrFo44x.css`

## Public smoke verification

- public web: pass;
- public health: pass;
- security headers: pass;
- CSP reporting: pass;
- hostile CORS: blocked;
- unauthenticated delete: blocked;
- operations endpoint: protected.

This evidence does not claim that every open master-plan item is complete. It records the exact r2
slice that was verified and deployed.
