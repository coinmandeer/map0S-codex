import { defineMigration } from "./migration.js";

export const planCollaborationMigration = defineMigration({
  version: "0010",
  name: "plan_collaboration",
  steps: [
    {
      sql: `CREATE TABLE IF NOT EXISTS plan_share_links (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        plan_id UUID NOT NULL REFERENCES trip_plans(id) ON DELETE CASCADE,
        owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash CHAR(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
        permission TEXT NOT NULL DEFAULT 'view' CHECK (permission = 'view'),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        revoked_at TIMESTAMPTZ
      )`
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS plan_share_links_owner_plan_idx
        ON plan_share_links (owner_user_id, plan_id, created_at)`
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS plan_discussion_threads (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        plan_id UUID NOT NULL REFERENCES trip_plans(id) ON DELETE CASCADE,
        owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
        message_count INTEGER NOT NULL DEFAULT 0 CHECK (message_count BETWEEN 0 AND 40),
        messages JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (
          jsonb_typeof(messages) = 'array'
          AND octet_length(messages::text) <= 262144
        ),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS plan_discussion_threads_owner_plan_idx
        ON plan_discussion_threads (owner_user_id, plan_id, updated_at)`
    }
  ]
});
