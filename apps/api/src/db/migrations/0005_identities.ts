import { defineMigration } from "./migration.js";

/** Guest-first linked identities, single-use SIWE challenges and metadata-only audit history. */
export const identitiesMigration = defineMigration({
  version: "0005",
  name: "linked_identities",
  steps: [
    {
      sql: `CREATE TABLE IF NOT EXISTS user_identities (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type TEXT NOT NULL
          CHECK (type IN ('email', 'wallet', 'passkey', 'oauth', 'simulated-wallet')),
        provider TEXT NOT NULL CHECK (char_length(provider) BETWEEN 1 AND 80),
        subject TEXT NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 320),
        display_label TEXT CHECK (display_label IS NULL OR char_length(display_label) <= 120),
        simulated BOOLEAN NOT NULL DEFAULT FALSE,
        verified_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (type, provider, subject)
      )`
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS user_identities_user_idx
        ON user_identities (user_id, created_at, id)`
    },
    {
      sql: `DO $$
        BEGIN
          IF EXISTS (
            SELECT lower(email)
            FROM users
            WHERE is_guest = 0
            GROUP BY lower(email)
            HAVING count(*) > 1
          ) THEN
            RAISE EXCEPTION 'case-insensitive duplicate user emails block identity migration';
          END IF;
        END $$`
    },
    {
      sql: `INSERT INTO user_identities
        (id, user_id, type, provider, subject, display_label, simulated, verified_at, created_at)
        SELECT gen_random_uuid(), id, 'email', 'password', lower(email), email, FALSE, NULL, created_at
        FROM users
        WHERE is_guest = 0
        ON CONFLICT (type, provider, subject) DO NOTHING`
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS identity_challenges (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        address TEXT NOT NULL CHECK (address ~ '^0x[0-9A-Fa-f]{40}$'),
        chain_id INTEGER NOT NULL CHECK (chain_id > 0),
        domain TEXT NOT NULL,
        uri TEXT NOT NULL,
        nonce TEXT NOT NULL UNIQUE CHECK (nonce ~ '^[A-Za-z0-9]{8,96}$'),
        message TEXT NOT NULL CHECK (octet_length(message) <= 16384),
        issued_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        CHECK (expires_at > issued_at),
        CHECK (used_at IS NULL OR used_at >= issued_at)
      )`
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS identity_challenges_owner_idx
        ON identity_challenges (user_id, expires_at, id)`
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS identity_audit_events (
        id UUID PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        identity_id UUID REFERENCES user_identities(id) ON DELETE SET NULL,
        action TEXT NOT NULL
          CHECK (action IN ('challenge-created', 'identity-linked', 'identity-revoked')),
        provider TEXT NOT NULL CHECK (char_length(provider) BETWEEN 1 AND 80),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS identity_audit_events_user_idx
        ON identity_audit_events (user_id, created_at, id)`
    },
    {
      sql: `INSERT INTO identity_audit_events
        (id, user_id, identity_id, action, provider, created_at)
        SELECT gen_random_uuid(), identity.user_id, identity.id, 'identity-linked', 'password', identity.created_at
        FROM user_identities AS identity
        WHERE identity.type = 'email'
          AND identity.provider = 'password'
          AND NOT EXISTS (
            SELECT 1 FROM identity_audit_events AS audit
            WHERE audit.identity_id = identity.id AND audit.action = 'identity-linked'
          )`
    }
  ]
});
