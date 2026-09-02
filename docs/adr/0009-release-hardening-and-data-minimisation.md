# ADR 0009: Release hardening and data minimisation

Status: accepted for VPS v19, 2026-09-01.

## Context

MapOS calls several independent providers, handles sessions and precise map coordinates, and runs
as more than one possible API process. A provider failure must not become an application outage,
and diagnostics must not create a second store of private user input. Production rollback also
needs evidence that a backup can be restored, not only that a dump command returned success.

## Decision

- Enforce exact production origins, same-site secure sessions, mutation-origin checks, strict
  request guards, bounded bodies and a shared HMAC-keyed rate-limit store. Raw client addresses are
  never persisted in that store.
- Permit arbitrary declarative networking only through the reviewed exact-host, DNS-pinned server
  sandbox. Fixed first-party providers keep explicit endpoints, timeouts, response limits and
  circuit isolation.
- Generate correlation ids on the server. Metrics use method, route template, status class, fixed
  provider id, outcome and duration only. Raw URLs, query values, coordinates, prompts, notes,
  email, wallets, cookies and authorization values are excluded from the telemetry model.
- Hide operational status and metrics behind a server-only token and return 404 when the feature is
  not configured.
- Apply ordered checksummed expand migrations under an advisory lock. Before production cutover,
  restore the new backup into a disposable database and verify its migration ledger and core
  tables. Keep the preceding release and avoid schema contraction in the same rollout.
- Isolate the map, shell and independently lazy-loaded surfaces with local error boundaries so one
  module can fail without blanking the application.

## Consequences and rollback

Operational telemetry is intentionally less useful for reconstructing an individual user's request;
provider/source health is diagnosable without collecting that history. Distributed limiting needs
PostgreSQL availability and a high-entropy server secret. Disable a newly failing provider or switch
the release symlink back before considering data restore. Additive v19 tables may safely remain
during application rollback.
