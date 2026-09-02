# MapOS v20 Settings UI/UX r14 live evidence

- Release: `20260902-mapos-v20-ui-ux-r14`
- Public origin: `https://mapos.promptstudio3000.com`
- Deployment payload: 988,449 compressed bytes; dependencies, caches, generated output, local models and environment files were excluded.
- Rollback backup: `/opt/ps3000/apps/mapos-v3/backups/20260902-mapos-v20-ui-ux-r14`
- Source-rights and licensing metadata remain advisory only; they do not gate data, layers, UI, build, runtime or deployment.

## Delivered scope

- Settings now use the standard exclusive right utility drawer on desktop and the same responsive surface on mobile.
- The first view is a visible preference overview with five focused sections: appearance, map, account, AI and about.
- Theme supports system, light and dark modes; system mode follows device changes and updates the map background twin.
- Comfortable/compact density is persistent and changes information density without reducing interactive target sizes.
- The typed versioned preference envelope persists theme, density, units, map animation/search controls and AI controls, with deterministic migration from the legacy theme value.
- Kilometres/miles are applied to search AI results, place lists, route output and planning distances.
- Map animation and “search this area” visibility are real runtime preferences. Disabling animation switches camera movement to an immediate jump.
- Global AI and automatic place-summary preferences are visible. The data-saving default leaves automatic summaries off; disabling AI removes AI entry points while ordinary geocoding remains available.
- Provider readiness and attribution/licensing details are read-only status surfaces. Mapy.com is no longer a user experiment flag; automatic geocoding prefers it when configured and otherwise falls back to Nominatim.
- Duplicate basemap controls and game controls were removed from global Settings. Basemaps remain in their dedicated surface and game controls remain in the game HUD without losing their stored state.
- The legacy-to-target audit records the disposition of every former setting, including retained, moved, merged and removed duplicates.
- The UI registry is typed, rejects duplicate IDs and unknown sections, and is covered by an extension fixture that adds a later setting without introducing a monolithic switch component.
- The responsive top-rail label collapse now covers the 1280 px collision range while preserving full labels at 1440 px.

## Verification before deployment

- Complete web unit suite: 311 checks, 304 passed, 7 advisory skips, 0 failures.
- Complete API unit suite: 407 checks, 407 passed, 0 failures.
- Settings browser flow: 3/3 passed.
- General smoke: 15/15 passed.
- Shell enhancement flow: 11/11 passed.
- Accessibility profile: 4/4 passed, including mobile Settings at 200% text without horizontal overflow.
- Settings visual scenario: 1/1 passed at 1440 px and 390 px. Inspected images: `e2e/screenshots/1440-settings-redesign.png`, `e2e/screenshots/1440-settings-ai-map.png`, `e2e/screenshots/390-settings-redesign.png` and `e2e/screenshots/390-settings-ai-map.png`.
- Production SDK, runtime, API, web and starter builds passed. API/web typechecks, ESLint, formatting, secret/source scans and architecture-boundary checks passed.

## Public runtime smoke

The post-deployment check was deliberately bandwidth-light: it fetched only the small HTML/health responses and the headers of the new main asset.

- Public web, health, security headers and CSP reporting: passed
- Hostile credentialed CORS: blocked
- Unauthenticated account deletion: blocked
- Operations endpoint: protected
- New main asset: `/assets/index-BV276fNS.js`, HTTP 200, declared 1,642,007 bytes; its body was not downloaded by this smoke
- Active symlink: `releases/20260902-mapos-v20-ui-ux-r14`
- API, web and PostgreSQL containers: healthy
- Verified rollback dump: `mapos.dump`, 30,449,588 bytes
- Loopback-only container sample: 60 requests, p50 0.005271 s, p95 0.012610 s; this is release evidence, not a production SLO claim
