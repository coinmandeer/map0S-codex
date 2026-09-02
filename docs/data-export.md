# Data export and deletion paths

MapOS keeps portable artifacts separate from provider-owned data.

## Available exports

- A plan can be exported as deterministic GPX or GeoJSON from Planning.
- A user layer can be exported as a versioned MapOS package or GeoJSON from its transfer tools.
- Import preview validates a package before an atomic commit; rollback removes only the layer created
  by that import and only for its owner.

Exports preserve coordinates and any available provenance, freshness, licence and attribution as
advisory metadata. Prototype export does not filter rows by source-rights status. It still excludes
provider secrets, session cookies, password hashes, private AI prompts, payment credentials and
data outside the authenticated owner's visibility.

## Account-scoped data

`GET /api/v2/me/export` returns a versioned, owner-scoped JSON archive covering the account profile,
linked identities, layers and pins, layer-import history, saved places and collections, plans,
follows, reviews, comments, drafts, game progress and the user's minimal commerce records, including
entitlements addressed to a wallet linked to that account. The route is authenticated,
private/no-store and selects an explicit field allow-list. Password hashes,
sessions/cookies, authentication challenges, provider secrets, raw payment events, security logs and
rate-limit state are never exported.

`DELETE /api/v2/me` requires the exact confirmation `DELETE MY ACCOUNT` and erases all owner-scoped
map, planning, social, identity, session and game data in one transaction. Shared-world activity is
unlinked from the account. If no financial record exists, the user row is removed. When an order,
subscription or user-subject entitlement must remain for legal/accounting handling, the login
identity is replaced by an unusable pseudonymous account, provider identifiers and referral metadata
are removed, subscriptions are cancelled and entitlements revoked. In wallet-subject entitlements,
the wallet address is replaced with a non-address pseudonym; user-subject entitlements retain only
the database-required link to the unusable pseudonymous account. Tips are unlinked. The response reports
`deleted-with-retention` and the `commerce-audit` exception instead of claiming complete physical
erasure; its `pseudonymized-and-deactivated` state does not claim that every legally retained row is
technically unlinked.

Automated contract and browser end-to-end tests cover places, plans, layers/pins and comments. The
release restore drill runs the production PostgreSQL repository against a disposable restored
database and verifies both those deletions and the commerce-retention pseudonymisation branch. Backup copies can
retain deleted records until the hosting retention period expires; they are access-controlled
disaster-recovery artifacts, not queried by the product. A restored backup must undergo privacy
reconciliation before it can serve traffic. The off-host retention/encryption schedule remains an
explicit hosting gate.

Operational backups are for disaster recovery and are not user exports. Their retention and restore
process is described in [backup and restore](operations/backup-restore.md).
