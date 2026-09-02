# MapOS v20 Personal UI/UX r15 live evidence

- Release: `20260902-mapos-v20-ui-ux-r15`
- Public origin: `https://mapos.promptstudio3000.com`
- Deployment payload: 992,827 compressed bytes; dependencies, caches, generated output, local models and environment files were excluded.
- Rollback backup: `/opt/ps3000/apps/mapos-v3/backups/20260902-mapos-v20-ui-ux-r15`
- Source-rights and licensing metadata remain advisory only; they do not gate data, layers, UI, build, runtime or deployment.

## Delivered scope

- Personal has a clearly visible profile overview with account state, only non-zero statistics and two primary actions: create a plan and focus saved places.
- A new owner-scoped, no-store summary endpoint returns only three counts. It avoids downloading complete plans, places and layers merely to render closed accordion badges.
- Plans, places, layers and game sections start closed, load their detailed data independently and preserve exact counts after loading or mutation.
- The empty plan state is one compact action-oriented line and the New plan button remains at the bottom with zero or existing plans.
- Saved-place search covers title, note and tags, composes deterministically with category counts and includes an explicit clear action.
- Personal list data comes only from the authenticated saved-place endpoint. An active foreign public viewport layer does not populate the list.
- Personal pins remain globally sourced from the private saved-place collection, render larger than ordinary POI at every configured zoom stop, use category symbols and fall back to a stable default symbol.
- Recent searches are absent from Personal and remain available in the global command-search workflow.
- The light, dark and mobile Personal hierarchy has been visually inspected. Mobile remains free of horizontal overflow at 200% text.
- Planning once again offers the already-visible, ownership-reconciled map features as quick stop suggestions. The personal editable representation wins over a fused public duplicate.

## Verification before deployment

- Complete web unit suite: 316 checks, 309 passed, 7 advisory skips, 0 failures.
- Complete API unit suite: 408 checks, 408 passed, 0 failures.
- Combined relevant browser regression: 35/35 passed across Personal, ownership, layer import, shell, accessibility and smoke scenarios.
- Focused Personal browser flow: 4/4 passed, including authenticated-count presentation, existing/empty plan actions, composed filters, foreign-POI exclusion, 200% mobile text and dark mode.
- Inspected visual images: `e2e/screenshots/1440-personal-redesign.png`, `e2e/screenshots/1440-personal-places.png`, `e2e/screenshots/390-personal-redesign.png`, `e2e/screenshots/390-personal-places.png` and `e2e/screenshots/1440-personal-redesign-dark.png`.
- Production SDK, runtime, API, web and starter builds passed. API/web typechecks, ESLint, formatting, secret/source scans, route parity and architecture-boundary checks passed.

## Public runtime smoke

The post-deployment check was deliberately bandwidth-light: it fetched only the small HTML/health responses and the headers of the new main asset.

- Public web, health, security headers and CSP reporting: passed
- Hostile credentialed CORS: blocked
- Unauthenticated account deletion: blocked
- Operations endpoint: protected
- New main asset: `/assets/index-CK3h1b3H.js`, HTTP 200, declared 1,642,037 bytes; its body was not downloaded by this smoke
- Active symlink: `releases/20260902-mapos-v20-ui-ux-r15`
- API, web and PostgreSQL containers: healthy
- Verified rollback dump: `mapos.dump`, 30,449,774 bytes
- Loopback-only container sample: 60 requests, p50 0.004020 s, p95 0.007992 s; this is release evidence, not a production SLO claim
