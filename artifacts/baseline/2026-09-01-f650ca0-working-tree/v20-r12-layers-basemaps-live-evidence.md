# MapOS v20 Layers and basemaps r12 live evidence

- Release: `20260902-mapos-v20-ui-ux-r12`
- Public origin: `https://mapos.promptstudio3000.com`
- Deployment payload: 977,273 compressed bytes; dependencies, caches, generated output, local models and environment files were excluded.
- Rollback backup: `/opt/ps3000/apps/mapos-v3/backups/20260902-mapos-v20-ui-ux-r12`
- Source-rights and licensing metadata remain advisory only; they do not gate data, layers, presets, UI, build or deployment.

## Delivered scope

- The Vrstvy drawer now opens with a compact `Svět` accordion. World-scoped place sources and their availability are nested inside it, while the existing map status strip continues to expose live source health.
- Worlds use a manifest registry. A third fixture world registers, resolves and falls back without a shell switch branch.
- Exactly four horizontally scrollable presets remain: Výlet, Město, Cestování and Sport. Their categories now cover the source plan's complete open-data families, including water, peaks, observation towers, natural parks, shops, breweries, caravan services and fitness centres.
- `Kategorie` is a compact accordion below the presets. Its count updates after both preset and manual selection; manual edits become `Vlastní výběr` and survive a reload.
- The old `Integrace` heading is now `POI vrstvy`; weather is a separate exclusive visualization group.
- Layer visibility, opacity and sanitized public filters persist for the browser tab in bounded `sessionStorage`. Coordinates, geometry, owner/user fields and oversized/corrupt values fail closed and are not persisted.
- `Mapové podklady` is now the consistent user-facing name, including Settings. Every basemap card has a deterministic zero-network illustrative preview and a concise two-line visual description whose full text remains accessible.
- The manifest-driven legend and shared timeline remain simultaneously operable without overlap, including between both desktop drawers.

## Verification before deployment

- Complete web unit suite: 303 checks, 296 passed, 7 advisory skips, 0 failures.
- Focused registry, preset and session-persistence checks: 9/9 passed.
- Shell browser suite: 11/11 passed; the redesigned narrow-drawer scenario verifies four presets, accordion hierarchy, source visibility, category counts/custom state, reload persistence, basemap previews and the Settings terminology.
- Redesigned Layers/Basemaps visual scenario: 1/1 passed at 1440 px and 390 px after waiting for the final drawer position.
- Accessibility profile: 3/3 passed.
- Production SDK, runtime, API, web and starter builds passed. Web and SDK typechecks, ESLint, full formatting and secret/source plus built-artifact scans passed.
- Inspected images: `e2e/screenshots/1440-layers-redesign.png`, `e2e/screenshots/390-layers-redesign.png`, `e2e/screenshots/1440-basemaps-redesign.png` and `e2e/screenshots/390-basemaps-redesign.png`.

## Public runtime smoke

The post-deployment check was deliberately bandwidth-light: it fetched only the small HTML/health responses and the headers of the new main asset.

- Public web, health, security headers and CSP reporting: passed
- Hostile credentialed CORS: blocked
- Unauthenticated account deletion: blocked
- Operations endpoint: protected
- New main asset: `/assets/index-D7tkSIko.js`, HTTP 200, declared 1,631,854 bytes; its body was not downloaded by this smoke
- Active symlink: `releases/20260902-mapos-v20-ui-ux-r12`
- API, web and PostgreSQL containers: healthy
- Verified rollback dump: `mapos.dump`, 30,449,036 bytes
