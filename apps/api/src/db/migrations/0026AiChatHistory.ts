import { defineMigration } from "./migration.js";
export const aiChatHistoryMigration = defineMigration({
  version: "0026",
  name: "ai_chat_history",
  steps: [
    {
      sql: `CREATE TABLE IF NOT EXISTS ai_chat_history (
    id TEXT PRIMARY KEY, owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0, turns JSONB NOT NULL DEFAULT '[]',
    workspace JSONB, archived BOOLEAN NOT NULL DEFAULT FALSE, deleted BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS ai_map_artifacts (
    id TEXT PRIMARY KEY,owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,conversation_id TEXT NOT NULL REFERENCES ai_chat_history(id) ON DELETE CASCADE,document JSONB NOT NULL
  )`
    },
    {
      sql: `INSERT INTO ai_chat_history(id,owner_user_id,title,revision,updated_at,archived)
        SELECT id,owner_user_id,'Starší konverzace',revision,updated_at,
          (document->>'archivedAt') IS NOT NULL FROM ai_conversations
        ON CONFLICT(id) DO NOTHING`
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS ai_chat_history_owner ON ai_chat_history (owner_user_id, updated_at DESC, id)`
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS ai_chat_requests (
        owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        id UUID NOT NULL, fingerprint TEXT NOT NULL,
        conversation_id TEXT REFERENCES ai_chat_history(id) ON DELETE CASCADE,
        response JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY(owner_user_id,id)
      )`
    }
  ]
});
