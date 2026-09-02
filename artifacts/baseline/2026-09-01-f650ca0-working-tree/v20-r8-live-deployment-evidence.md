# MapOS v20 UI/UX r8 live deployment evidence

- Release: `20260902-mapos-v20-ui-ux-r8`
- Public origin: `https://mapos.promptstudio3000.com`
- Deployment payload: 961,572 compressed bytes; dependencies, build output, caches, local models and environment files were excluded.
- Rollback backup: `/opt/ps3000/apps/mapos-v3/backups/20260902-mapos-v20-ui-ux-r8`

## Delivered scope

- `PLAN-025`: the Adventure preference now opens a dedicated responsive planning surface instead of relying on a provider fallback label.
- It searches bounded OSM landmark categories, deterministically pre-ranks places, and verifies the final detour with the same adjacent-route provider used by the plan.
- The response publishes algorithm version, deterministic flag, score formula, detour limit, score breakdown, scanned coverage, source state and a finite provider/data budget.
- The UI offers 10%, 15% and 25% detour limits, shows the actual routed detour and score breakdown, and adds accepted places through the canonical batch `add-stop` command before recalculating the affected segments.
- No model, random waypoint generator or licensing gate participates in selection. Rights/provenance remain advisory metadata; security, technical and privacy boundaries remain enforced.

## Verification before deployment

- API typecheck and web typecheck passed.
- API suite: 402 passed, 0 failed.
- Web suite: 291 passed, 7 advisory skips, 0 failed.
- Planning browser suite: 10 passed, including the Adventure score/detour/add-and-reroute flow.
- Targeted adventure and plan-route tests: 8 passed.
- ESLint, changed-file Prettier check, production builds and secret/source plus built-artifact scan passed.
- Visual browser evidence: `e2e/screenshots/1440-planning-adventure.png`.

## Public runtime smoke

The smoke used an anonymous two-stop cycling draft near Plzeň. It created no account and made no persistent plan write.

- Health HTTP: 200
- Web HTML HTTP: 200
- Current JavaScript asset HTTP: 200
- `POST /api/v2/routing/adventure`: HTTP 200
- Algorithm: `mapos-adventure-v1`, deterministic `true`
- Requested detour limit: 25%
- Live suggestions: 1, all within the published cap
- OSM source state: ready, 62 places available to the bounded scorer
- Scanned segments: 1
- Response body: 1,121 bytes uncompressed JSON
- Active symlink: `releases/20260902-mapos-v20-ui-ux-r8`
- Rollback backup presence verified after cutover.

This record demonstrates `PLAN-025` only at the stated live scope. It does not claim that unrelated open phase requirements are complete.
