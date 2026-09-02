# MapOS v20 global task center r16 live evidence

- Release: `20260902-mapos-v20-ui-ux-r16`
- Public origin: `https://mapos.promptstudio3000.com`
- Deployment payload: 996,279 compressed bytes; dependencies, caches, generated output, local models and environment files were excluded.
- Rollback backup: `/opt/ps3000/apps/mapos-v3/backups/20260902-mapos-v20-ui-ux-r16`
- Source-rights and licensing metadata remain advisory only; they do not gate data, layers, UI, build, runtime or deployment.

## Delivered scope

- A compact global task center now appears at the bottom right whenever work is active or a failure needs attention.
- The collapsed control shows the exact active-task count and a short localized operation label instead of merging all work into an ambiguous spinner.
- The expanded panel keeps each task separate and shows its typed scope, numeric or indeterminate progress, safe message and only the actions supported by that task.
- Running cancellable work exposes Cancel. A terminal failure never exposes a dead Cancel action; it offers Retry only when a runtime retry callback exists and can otherwise be hidden.
- Retry starts a new task without reloading the application and dismisses the obsolete failed record.
- The center shifts above active footer contributions, respects desktop right drawers, mobile bottom navigation and safe-area insets, and remains free of horizontal overflow.
- The former top source strip now reports source arrival only. Global operational work has one clear owner instead of being duplicated across unrelated UI.
- Completed and stale history stays out of the user-facing center; privacy-bounded terminal diagnostics remain inside the existing bounded in-memory registry.

## Verification before deployment

- Complete web unit suite: 320 checks, 313 passed, 7 advisory skips, 0 failures.
- New model/registry coverage proves localized task kinds, progress labels, active-before-failure ordering, terminal-only dismissal and capability-aware retry.
- Task-center browser flow: 2/2 passed. It verifies three parallel requests as three entries, final disappearance, desktop footer separation, a mobile provider failure, context-safe retry and mobile safe-area/overflow behavior.
- Combined shell/task/smoke regression: 28/28 passed.
- Accessibility profile: 4/4 passed, including keyboard focus, 200% mobile text and reduced motion.
- Inspected visual images: `e2e/screenshots/1440-task-center-concurrent.png` and `e2e/screenshots/390-task-center-error.png`.
- Production SDK, runtime, API, web and starter builds passed. All workspace typechecks, ESLint, secret/source scan and architecture-boundary checks passed.

## Public runtime smoke

The post-deployment check was deliberately bandwidth-light: it fetched only the small HTML/health responses and the headers of the new main asset.

- Public web, health, security headers and CSP reporting: passed
- Hostile credentialed CORS: blocked
- Unauthenticated account deletion: blocked
- Operations endpoint: protected
- New main asset: `/assets/index-y8lAD7SF.js`, HTTP 200, declared 1,646,114 bytes with immutable caching; its body was not downloaded by this smoke
- HTML transferred for asset discovery: 1,203 bytes
- Active symlink: `releases/20260902-mapos-v20-ui-ux-r16`
- API, web and PostgreSQL containers: healthy
- Verified rollback dump: `mapos.dump`, 30,447,421 bytes
- Backup bundle contains the dump, checksum list, restore drill, PostGIS plan and HTTP soak record.
- Loopback-only container sample: 60 requests, p50 0.009017 s, p95 0.018273 s; this is release evidence, not a production SLO claim.
