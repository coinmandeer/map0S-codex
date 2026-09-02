# MapOS v20 UI/UX r11 live deployment evidence

- Release: `20260902-mapos-v20-ui-ux-r11`
- Public origin: `https://mapos.promptstudio3000.com`
- Deployment payload: 973,270 compressed bytes; dependencies, caches, generated output, local models and environment files were excluded.
- Rollback backup: `/opt/ps3000/apps/mapos-v3/backups/20260902-mapos-v20-ui-ux-r11`

## Delivered scope

- The shell now follows the source-grounded breakpoint contract: phone below 768 px, tablet from 768 px and desktop composition above it. The 767/768 boundary has an explicit browser assertion.
- Desktop keeps one optically centred command row with logo, a 280 px search fallback, visible `Moje poloha`, ordered modes and Settings. Layers and Mapové podklady remain an independent right rail and cannot move the command centre.
- Phone chrome now has a standalone hamburger on the left, a genuinely centred search without a competing logo, and a vertical right rail ordered Mapové podklady, Vrstvy, Settings. Modes remain in the bottom navigation.
- The left context panel uses the requested 380 px default, 320 px minimum and `min(560px, 46vw)` maximum with pointer and keyboard resizing.
- Visual Viewport handling detects a real software keyboard only while an editable control owns focus. It publishes bounded viewport metrics without remounting the form, hides obstructing bottom chrome and keeps the focused sheet/drawer scrollable above the keyboard.
- Safe-area variables, phone sheet snaps, tablet layout and light/dark information hierarchy remain intact.
- Source-rights and licensing metadata remain advisory and do not gate shell, layers, data, build, deployment or runtime behavior.

## Verification before deployment

- Complete web unit suite: 300 checks, 293 passed, 7 advisory skips, 0 failures.
- Shell browser suite: 11/11 passed, including optical centring, exact 767/768 composition, no tablet rail collision, keyboard-safe forms, panel resize persistence and footer/drawer coexistence.
- Accessibility profile: 3/3 passed, including accessible names, focus restoration, 200% mobile text and reduced-motion behavior.
- The complete 12-scenario visual matrix passes when counted after the corrected tablet navigation rerun: 1440, 1024, 768, 390 and 360 px; light/dark baselines; planning, layers, Discover, game, durable sharing and AI thread captures.
- Production SDK, runtime, API, web and starter builds passed. Web typecheck, ESLint, changed-file formatting and secret/source plus built-artifact scans passed.
- Inspected images: `e2e/screenshots/baseline/1440x900-light.png`, `e2e/screenshots/baseline/768x1024-light.png` and `e2e/screenshots/baseline/390x844-light.png`.

## Public runtime smoke

The post-deployment check was deliberately bandwidth-light: it fetched the small HTML/health responses and only the headers of the new main asset.

- Public web, health, security headers and CSP reporting: passed
- Hostile credentialed CORS: blocked
- Unauthenticated account deletion: blocked
- Operations endpoint: protected
- New main asset: `/assets/index-B2AahfA9.js`, HTTP 200, declared 1,627,958 bytes; body not downloaded by this smoke
- Active symlink: `releases/20260902-mapos-v20-ui-ux-r11`
- Verified rollback dump: `mapos.dump`, 30,448,790 bytes
