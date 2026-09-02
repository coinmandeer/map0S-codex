# MapOS governance

MapOS is an Apache-2.0 project with maintainer review. The repository remains the source of truth for
code, schemas, decisions and releases.

## Decisions

Small, reversible changes use normal review. A change to a canonical schema, public SDK contract,
privacy boundary, licence policy, persistence model or supported runtime needs an issue or proposal
that contains examples, compatibility impact, migration and rollback. Accepted architectural
decisions are recorded in `docs/adr/`.

Provider-specific fields start in an extension namespace. They move into the core model only when
more than one integration demonstrates the same durable concept. A paid or hosted integration does
not receive authority over the open keyless core.

## Roles

- Contributors propose code, documentation, fixtures and reviews under the contribution rules.
- Maintainers triage, review compatibility/security/licensing and cut releases.
- Owners of an integration maintain its provenance, attribution, health metadata and fixtures.

Maintainers should not approve their own material security exception or undisclosed commercial
conflict. When consensus is not possible, prefer the option that preserves user data, portability,
backwards compatibility and a reversible rollout; document the decision.

## Releases and deprecation

Public contract changes follow [the compatibility policy](docs/compatibility-policy.md). A release
records migrations, feature flags, external gates, validation evidence and a rollback target.
Telemetry may justify removing a legacy path only when the telemetry is privacy-safe and the stated
adoption, test and rollback gates are met.
