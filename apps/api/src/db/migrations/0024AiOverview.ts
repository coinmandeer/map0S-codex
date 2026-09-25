import { defineMigration } from "./migration.js";
export const aiOverviewMigration = defineMigration({
  version: "0024",
  name: "ai_overview_history",
  steps: [
    {
      sql: `CREATE TABLE IF NOT EXISTS ai_conversations (
    id TEXT PRIMARY KEY, owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL CHECK (revision >= 0), document JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS ai_conversations_owner_updated ON ai_conversations (owner_user_id, updated_at DESC)`
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS ai_overview_snapshots (
    id UUID PRIMARY KEY, owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipe JSONB NOT NULL, snapshot JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS ai_overview_snapshots_owner_created ON ai_overview_snapshots (owner_user_id, created_at DESC)`
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS social_reviews_target_time ON social_reviews (target_type, target_id, updated_at DESC)`
    }
  ]
});
