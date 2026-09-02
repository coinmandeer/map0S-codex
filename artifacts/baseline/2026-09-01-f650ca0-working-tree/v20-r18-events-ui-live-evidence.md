# MapOS v20 annual events UI r18 live evidence

- Release: `20260902-mapos-v20-ui-ux-r18`
- Public origin: `https://mapos.promptstudio3000.com`
- Deployment payload: 1,001,789 compressed bytes; dependencies, caches, generated output, local models and environment files were excluded.
- Rollback backup: `/opt/ps3000/apps/mapos-v3/backups/20260902-mapos-v20-ui-ux-r18`
- Source-rights and licensing metadata remain advisory only; they do not gate data, layers, UI, build, runtime or deployment.

## Delivered scope

- Events remains a temporal layer inside the four-mode shell. Enabling it opens a dedicated event explorer in Discover instead of adding a fifth mode or crowding the map footer with a second event list.
- The shared footer host presents one twelve-month Events timeline. The first 90 days occupy 65% of the interaction track and the remaining annual tail is compressed; the ordinary -24 h/+7 d cursor does not compete when Events is the only temporal layer.
- Desktop and mobile share quick ranges for today, weekend, week, month, three months and year. Sidebar choices and the footer range remain synchronized, including under concurrent browser load.
- The Discover explorer shows a result count and vertical event cards with date, time, venue, state, price and distance. Cards open the canonical detail and expose the sourced official action when available.
- Type, time, price, distance and venue controls affect the loaded map/list result set as appropriate. Unknown price is explicitly labelled `Cena neuvedena` and is never presented as free.
- The 390 px layout remains keyboard-operable and free of horizontal overflow. Quick time controls keep annual navigation usable even when the mobile context sheet overlays the footer.
- Repeated failure of the same layer retires its earlier failed task before exposing the replacement, while genuinely concurrent work from different layers remains separate. Retry starts after the activating click completes, avoiding a detached action control.

## Verification before deployment

- Complete web unit suite: 325 checks, 318 passed, 7 advisory skips, 0 failures.
- Event explorer, nonlinear annual range, task lifecycle and layer replacement focused suite: 17/17 passed.
- Combined Events/task/shell/map browser regression: 31/31 passed under two-worker load.
- Accessibility profile: 4/4 passed, including keyboard focus, 200% mobile text and reduced motion.
- Visual capture profile: 1/1 passed across 1440 px and 390 px Events views.
- Inspected visual images: `e2e/screenshots/1440-events-explorer.png` and `e2e/screenshots/390-events-explorer.png`.
- Production build, workspace lint, web typecheck and secret/source scan passed.

## Public runtime smoke

The post-deployment check was deliberately bandwidth-light: it fetched only the small HTML/health responses and the headers of the main asset.

- Public web, health, security headers and CSP reporting: passed
- Hostile credentialed CORS: blocked
- Unauthenticated account deletion: blocked
- Operations endpoint: protected
- Main asset: `/assets/index-BdtSWq-Q.js`, HTTP 200, declared 1,646,858 bytes with immutable caching; its body was not downloaded by this smoke
- HTML transferred for asset discovery: 1,217 bytes
- Active symlink: `releases/20260902-mapos-v20-ui-ux-r18`
- API, web and PostgreSQL containers: healthy
- Verified rollback dump: `mapos.dump`, 30,448,154 bytes
- Backup bundle contains the dump, checksum list, restore drill, PostGIS plan and HTTP soak record.
- Loopback-only container sample: 60 requests, p50 0.005698 s, p95 0.017198 s; this is release evidence, not a production SLO claim.

This record verifies `EVT-006`, `EVT-007`, `EVT-008`, `EVT-009` and `EVT-010` at the stated live scope. Phase 11 remains open because cited AI event enrichment (`EVT-005`) and a geography/time-feasible festival route (`EVT-015`) are still absent.
