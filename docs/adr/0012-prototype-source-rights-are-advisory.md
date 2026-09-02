# ADR 0012: Source-rights metadata is advisory in the prototype

- Status: accepted by operator
- Date: 2026-09-01

## Context

The source-grounded plan proposed licence and attribution checks as release gates. The prototype
operator explicitly prioritizes the broadest technically available data surface and does not want
rights metadata to hide layers or block CI and VPS deployment.

## Decision

- Source-rights and attribution records remain visible provenance metadata.
- Their audit is opt-in through `npm run audit:source-rights`.
- The default test suite, CI, deployment, layer picker, provider-panel registry, cache, export and
  AI paths do not enforce that audit.
- Runtime availability is governed only by technical controls: explicit provider enablement,
  credentials, health, quotas, response safety and server capability.
- The v19 prototype enables all technically available place sources by default. A provider that
  rejects, throttles or changes its interface fails locally without taking down other sources.
- Authentication, payment, privacy, SSRF, response-size and secret-handling controls are not
  relaxed by this decision.

## Consequences

`QUAL-009` and the licence-only acceptance in `QUAL-010` are superseded for the prototype rather
than falsely reported as verified. The attribution part of `QUAL-015` is advisory, so that mixed
requirement returns to partial until a future production policy decides otherwise.

The repository keeps the structured inventory because it is useful for provenance and future
production hardening. It must not be described as a release blocker. Large historical game models
remain outside the mobile-data-efficient v19 bundle; that is a payload decision, not a licence
gate.
