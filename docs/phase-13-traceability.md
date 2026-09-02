# Phase 13 traceability

Evidence date: 2026-09-01. “Verified” below means offline automated evidence in this repository;
it does not claim that a live provider or VPS database was exercised.

| Requirement         | Evidence                                                                                                                              | State                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| OS-004, OS-005      | `LayerManifestV2`, declarative source guard/schema, contract runner and fixture example                                               | verified offline                                        |
| OS-015, OS-016      | canonical `MapOSLayerPackageV2`, legacy/GeoJSON/CSV parser, deterministic export helpers and round-trip tests                         | verified offline                                        |
| OS-021              | exact server allowlist, HTTPS/credential/IP/DNS/redirect checks, time/byte budgets and mocked-network tests                           | verified offline                                        |
| OS-020, OS-022      | owner-bound PostgreSQL preview repository, SHA-256 digest, TTL/cap cleanup, advisory provenance preview, transactional consume/commit | verified offline across two service instances           |
| OS-023              | owner-scoped idempotent rollback with preserved report                                                                                | verified in memory/route tests; live DB gate open       |
| OS-024              | untrusted imports stay data-only; manifest compatibility controls the Personal UI option while API visibility remains explicit        | verified offline                                        |
| Phase 13 work 5     | `MinePanel` + `LayerTransferTools`: server preview → visibility choice → atomic commit → owner rollback and report                    | verified by offline browser E2E                         |
| Phase 13 work 5     | manifest/schema/SDK/minimum-runtime display and structured host report from `validateLayerManifestV2`                                 | verified by unit + offline browser E2E                  |
| LAYER-001–LAYER-012 | v2 manifest/feature/source/query contracts and schemas                                                                                | existing + extended                                     |
| LAYER-013–LAYER-018 | package, import preview/report and contract runner                                                                                    | verified offline                                        |
| LAYER-019–LAYER-023 | original geology/edit-location/filter/partner-filter/session-state requirements; durable preview state is owner-scoped                | preview gate verified; broader items tracked separately |

Acceptance evidence:

- A fixture layer is scaffolded, validated and contract-tested without editing mode UI.
- The untrusted contract permits only static/declarative data and rejects custom runtime/server
  adapter trust escalation.
- Canonical package/provenance round-trip is tested.
- Missing licence/attribution/open-rights metadata produces an advisory warning and does not block
  public import under ADR 0012.
- A preview created by one `LayerImportService` instance is committed by a second instance sharing
  the same repository; retry on the first instance returns the same report and creates one layer.
- Owner isolation, 15-minute expiry, safe consumption, a 20-preview per-owner cap and bounded
  expired-row cleanup are covered by deterministic repository/service tests.
- The Personal owner flow is exercised end to end against the memory API without external network:
  preview, canonical compatibility report, private/public selection, public commit, durable layer
  visibility and rollback.

Open gates and deliberate deviations:

- The current data model imports Points only. Polygon/line repair and preview is not silently
  approximated; unsupported geometry is rejected.
- Media paths are represented by the package contract but binaries are not persisted by the import
  repository yet.
- The owner install/publish/version dashboard is available in Personal. It installs data into an
  owner layer; it does not add an unreviewed executable extension or silently enroll a new live L1
  host. Live L1 sources still require a reviewed composition entry and the shipped registry is
  empty.
- `@mapos/layer-sdk` is version `2.0.0` and remains `private: true`: it is consumable by this npm
  workspace, but it has not been published to a registry. Registry publication,
  provenance/signing and the release operation remain release-engineering gates.
- Migration `0009` adds the expiring owner-bound PostgreSQL preview table and its owner/expiry
  indexes. The candidate deployment drill applies migrations twice, verifies the table/indexes and
  exercises preview→commit→rollback over HTTP against a restored PostgreSQL database.
- `GATE-SCALE-PREVIEW` is closed at repository/offline scope. The two-instance test proves shared
  durable state and idempotency, not horizontal throughput, multi-host failover or target-VPS SLO;
  those remain part of the broader OS-020 capacity evidence.
