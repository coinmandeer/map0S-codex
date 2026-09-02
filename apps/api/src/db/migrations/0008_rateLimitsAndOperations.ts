import { defineMigration } from "./migration.js";

/** Shared abuse-control windows; bucket hashes are keyed HMACs and contain no raw IP address. */
export const rateLimitsAndOperationsMigration = defineMigration({
  version: "0008",
  name: "rate_limits_and_operations",
  steps: [
    {
      sql: `CREATE TABLE IF NOT EXISTS rate_limit_windows (
        bucket_hash CHAR(64) NOT NULL CHECK (bucket_hash ~ '^[a-f0-9]{64}$'),
        window_start_ms BIGINT NOT NULL CHECK (window_start_ms >= 0),
        window_ms INTEGER NOT NULL CHECK (window_ms > 0),
        request_count INTEGER NOT NULL DEFAULT 1 CHECK (request_count > 0),
        expires_at TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (bucket_hash, window_start_ms)
      )`
    },
    {
      sql: `CREATE INDEX IF NOT EXISTS rate_limit_windows_expiry_idx
        ON rate_limit_windows (expires_at)`
    }
  ]
});
