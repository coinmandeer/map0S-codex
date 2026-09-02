# Load, accessibility and release gates

`apps/api/src/loadSmoke.test.ts` exercises deterministic offline request batches equivalent to
1, 5 and 10 active modules. It makes no public network calls, asserts every response, caps p95
batch duration at one second in CI and caps aggregate payload at 8 MiB. This is a regression gate,
not a hosting-capacity claim.

Release verification also requires:

- architecture boundaries, SDK/API/web tests and TypeScript checks;
- production build and immutable minimal archive;
- offline browser golden flows, keyboard/focus checks and game performance budget;
- clean migration run plus production backup/restore drill;
- strict headers/CORS/origin, rate-limit and privacy-log tests;
- public health, authenticated redacted operations status and provider-degraded behavior;
- no release-critical console error, crash/restart or migration checksum mismatch.

After atomic activation, `scripts/smoke-vps-public.sh` checks the exact public HTTPS origin. It
downloads only headers and tiny health/error bodies, performs no authenticated mutation and records
public health, security-header, hostile-CORS and protected-operations evidence.

Soak/capacity numbers are environment evidence: run the same offline scenario on the target VPS,
then add a longer authenticated read-only soak. Do not load-test public volunteer providers or AI
endpoints. Provider quotas and mobile-data budgets are correctness constraints, not traffic to
generate for a benchmark.
