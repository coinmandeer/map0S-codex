# Versioning and compatibility policy

## Public surfaces

The public compatibility promise covers exported `@mapos/layer-sdk` types and validators, versioned
manifest/package schemas, documented import/export formats and versioned HTTP routes. Internal React
components and undocumented provider payloads are not public APIs.

| Surface         | Current                                                         | Compatibility rule                                                                                                     |
| --------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Runtime         | MapOS 19.0.0; Node.js 22; modern evergreen browsers             | Patch releases may fix behaviour; a runtime change is announced in an upgrade guide                                    |
| Layer SDK       | 2.0.0 (`sdkRange: ^2.0.0`)                                      | A host rejects ranges that do not include its SDK version before loading the layer                                     |
| Layer manifest  | v2 canonical, v1 adapter                                        | v1 stays readable for the concrete window below; new fields in v2 are optional unless a new schema version is declared |
| Feature/package | v2 canonical                                                    | Export is deterministic; imports reject unknown/incompatible major versions before mutation                            |
| HTTP            | existing legacy routes plus versioned `/api/v2` or `/v2` routes | Additive fields are allowed; removal or semantic break requires a new version                                          |
| Database        | ordered expand/migrate migrations                               | A release must be able to start on the prior production schema and keep a tested rollback path                         |

The workspace SDK artifact is versioned 2.0.0 and follows SemVer from this release onward. Public
npm publication still requires its separate provenance/signing approval; until that happens, the
repository revision and dated production release remain the distributable identifiers.

## Capability negotiation

An extension declares its schema version, SDK range, optional `minimumRuntime`, permissions,
licence, attribution and health policy. The one exported production validator is also used by the
contract runner and CLI. It returns stable issue codes for an unsupported schema major, invalid or
unsupported SDK range, unmet runtime floor and every missing server capability. Supported SDK range
syntax is an exact/partial version (`2.0.0`, `v2`), caret or tilde range (`^2`, `~2.0`), wildcard
(`2.x`) or space-separated comparator range (`>=2.0.0 <3.0.0`).

The runtime must not execute extension JavaScript in the main client context. Declarative HTTP
extensions use the server sandbox and its network/size/time limits.

## Concrete v1 support window

MapOS 19 (released 2026-09-01) makes LayerManifest v2 canonical. The checked-in v1 adapter and v1
fixture remain supported through the complete MapOS 20 release line and until at least 2027-03-01,
whichever is later. Therefore removal cannot ship in MapOS 19 or 20, even if first-party migration
finishes sooner.

The earliest possible removal is a subsequently announced major release after both boundaries have
passed. It additionally requires a dated deprecation notice, green v1 fixture/parity tests, an
upgrade guide, privacy-safe adoption evidence and a tested rollback asset. Until every condition is
met, v1 input is adapted in memory and writes/exports remain canonical v2.

## Deprecation and removal

Deprecation requires migration notes, a replacement or explicit end-of-support outcome, fixtures for
the old version and a rollback plan. Removal additionally requires green compatibility and golden
flow tests plus privacy-safe evidence that the old path is no longer needed. Absence of telemetry is
not evidence of zero use, so v1 adapters and legacy facades remain until that gate is met.
