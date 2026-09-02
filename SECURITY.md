# Security policy

## Supported versions

| Release line                                                            | Security fixes      |
| ----------------------------------------------------------------------- | ------------------- |
| Current `main` and the active production release                        | Yes                 |
| The immediately preceding production release while rollback is retained | Critical fixes only |
| Older snapshots and extension schema v1 after its compatibility window  | No                  |

The exact active and rollback releases are deployment facts, not a promise that an old checkout is
supported indefinitely. See [the compatibility policy](docs/compatibility-policy.md).

## Report a vulnerability privately

Please use the repository host's private security-advisory feature. If that feature is not available,
ask a maintainer for a private reporting channel without including exploit details in the public
request. Do not open a public issue containing secrets, personal data, precise user locations or a
working exploit.

Include the affected revision or release, impact, prerequisites, a minimal reproduction and any
suggested mitigation. Remove real credentials and personal/location data. We will acknowledge the
report when a maintainer receives it, assess severity, coordinate a fix and publish only the detail
needed for users to upgrade safely.

## Scope and safe testing

In scope are the MapOS source, first-party deployment configuration, public SDK/CLI and server-side
connectors. Provider outages, provider-owned accounts and third-party services are outside MapOS
control unless the issue is caused by MapOS integration code.

Use local fixture mode or infrastructure you own. Do not access other users' data, degrade a public
service, run automated high-volume scans, or retain data discovered accidentally. Stop and report
if testing crosses an ownership boundary.
