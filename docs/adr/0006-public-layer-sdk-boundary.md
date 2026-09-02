# ADR 0006: Public Layer SDK and extension boundary

Status: accepted for the Phase 13 foundation, 2026-09-01; source-rights blocking partially
superseded by ADR 0012.

## Context

MapOS needs third-party layers without allowing an uploaded package to execute code in the main
web origin or to turn the API into a generic network proxy. Imports also need to avoid partially
created layers when one feature fails.

## Decision

The public L0/L1 surface is serialisable data only:

- `LayerManifestV2`, `MapOSFeatureV2`, `MapOSLayerPackageV2` and the contract report are public SDK
  contracts with runtime guards and JSON schemas.
- L0 is a static fixture. L1 is `declarative-http`: fixed HTTPS endpoint, bounded query mapping and
  safe dot-path response projection. It always requires the MapOS server proxy.
- A manifest may contain only an opaque `authRef`; trusted server composition resolves credentials.
  No header, token, template function or response code is accepted from the manifest.
- The server maintains an exact reviewed-host registry independent of the manifest. It rejects
  credentials, non-HTTPS/default ports, localhost, IP literals, private DNS answers, unsafe
  redirects, oversized bodies and timeouts. Redirect targets are resolved and checked again.
  The HTTPS connection is pinned to the verified address while preserving TLS SNI, preventing a
  second DNS lookup from rebinding the host after validation.
- L2 reviewed server adapters and L3 trusted UI remain separate code-review boundaries.
- Imports use owner-bound expiring preview state, then one database transaction for layer, pins and
  durable report. `preview_id` is unique, making a commit retry idempotent. Rollback locks the
  report, deletes only the imported owner layer and preserves an audit report.
- Missing attribution, licence or open source rights produces advisory warnings and does not block
  public commit. GeoJSON/CSV defaults private in the UI because it lacks a compatibility manifest,
  while the API still accepts an explicit public visibility choice. Unsupported geometry is
  rejected; it is never silently repaired.

## Consequences

An empty server registry is a deliberate fail-closed state and is also the rollback mechanism for
declarative sources. A partner fixture can be scaffolded and contract-tested without touching mode
UI code. Enabling a live source still requires an operator review and registry entry. The install /
publish dashboard, media bundle persistence, polygon repair workflow and sandboxed future runtime
are later slices; they are not implied by this foundation.
