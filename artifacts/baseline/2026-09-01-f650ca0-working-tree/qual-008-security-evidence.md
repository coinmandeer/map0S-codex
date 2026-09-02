# QUAL-008 offline security evidence

Date: 2026-09-01

Scope: local production bundle, in-memory API and recorded fixtures only. No public network or VPS
claim is made.

## Acceptance mapping

- `e2e/security.spec.ts` serves a provider-controlled XSS payload through the real OSM POI API/UI
  path. React renders the complete payload as text; no injected `img`, `script` or handler runs.
- The same run starts the production web bundle under the exact CSP from
  `infra/security-headers.inc`. A deliberately inserted inline script does not execute, emits an
  enforcing `securitypolicyviolation`, and sends a browser CSP report to the real bounded API
  endpoint, which returns `204`.
- `apps/api/src/security/cspReporting.test.ts` proves malformed and oversized reports are rejected
  and accepted reports expose only bounded, query-free metadata.
- `apps/api/src/security/cspPolicy.test.ts` keeps `frame-src` synchronized with the reviewed embed
  allowlist and pins the reporting endpoint and non-executable script/object policy.
- The production bundle no longer invokes AJV runtime code generation; its layer-manifest schema
  validator is deterministic standalone output checked during SDK build, test and typecheck.

## Fresh local results

- `npm run test:e2e:security -- --reporter=line`: 1 passed, 0 failed (11.3 s). The offline fixture
  rejected any unrecorded external request.
- Focused API/CSP tests: 5 passed, 0 failed.
- `npm test -w @mapos/layer-sdk`: 52 passed, 0 failed.
- API and Layer SDK typechecks, scoped ESLint/Prettier, shell syntax and diff checks passed.
- Production web build passed; static bundle scan found neither `new Function` nor `eval(`.

This is `verified-offline` evidence only. It does not assert that a new v19 build has already been
deployed or that a live VPS CSP report has been observed.
