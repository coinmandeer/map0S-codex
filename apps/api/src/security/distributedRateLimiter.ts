import { createHmac } from "node:crypto";
import type { RateLimitDecision, RequestRateLimiter } from "./publicApiHardening.js";

export interface RateLimitWindowStore {
  increment(input: {
    bucketHash: string;
    windowStartMs: number;
    windowMs: number;
    expiresAt: Date;
  }): Promise<number>;
  deleteExpired(limit: number): Promise<void>;
}

export interface RateLimitSqlClient {
  unsafe<T extends unknown[]>(statement: string, parameters?: (string | number)[]): Promise<T>;
}

/** PostgreSQL adapter shared by every API instance. It stores only a keyed hash, never a raw IP. */
export class PostgresRateLimitWindowStore implements RateLimitWindowStore {
  constructor(private readonly client: RateLimitSqlClient) {}

  async increment(input: {
    bucketHash: string;
    windowStartMs: number;
    windowMs: number;
    expiresAt: Date;
  }): Promise<number> {
    const rows = await this.client.unsafe<Array<{ request_count: number }>>(
      `INSERT INTO rate_limit_windows
        (bucket_hash, window_start_ms, window_ms, request_count, expires_at)
       VALUES ($1, $2, $3, 1, $4)
       ON CONFLICT (bucket_hash, window_start_ms) DO UPDATE
         SET request_count = LEAST(rate_limit_windows.request_count + 1, 2147483647),
             expires_at = EXCLUDED.expires_at
       RETURNING request_count`,
      [input.bucketHash, input.windowStartMs, input.windowMs, input.expiresAt.toISOString()]
    );
    const count = Number(rows[0]?.request_count);
    if (!Number.isSafeInteger(count) || count < 1) throw new Error("Invalid rate-limit counter");
    return count;
  }

  async deleteExpired(limit: number): Promise<void> {
    await this.client.unsafe(
      `DELETE FROM rate_limit_windows
       WHERE ctid IN (
         SELECT ctid FROM rate_limit_windows WHERE expires_at < NOW() ORDER BY expires_at LIMIT $1
       )`,
      [limit]
    );
  }
}

export class DistributedFixedWindowRateLimiter implements RequestRateLimiter {
  private cleanupSequence = 0;

  constructor(
    private readonly store: RateLimitWindowStore,
    private readonly secret: string,
    private readonly now: () => number = () => Date.now()
  ) {
    if (secret.length < 32 || secret.length > 512) {
      throw new Error("Distributed rate-limit secret must be 32–512 characters");
    }
  }

  async consume(key: string, limit: number, windowMs: number): Promise<RateLimitDecision> {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("limit must be positive");
    if (!Number.isSafeInteger(windowMs) || windowMs < 1) {
      throw new Error("windowMs must be positive");
    }
    const now = this.now();
    const windowStartMs = Math.floor(now / windowMs) * windowMs;
    const resetAt = windowStartMs + windowMs;
    const bucketHash = createHmac("sha256", this.secret).update(key).digest("hex");
    const count = await this.store.increment({
      bucketHash,
      windowStartMs,
      windowMs,
      expiresAt: new Date(resetAt + 5 * 60_000)
    });
    this.cleanupSequence += 1;
    if (this.cleanupSequence % 1_000 === 0) {
      void this.store.deleteExpired(500).catch(() => undefined);
    }
    return {
      allowed: count <= limit,
      limit,
      remaining: Math.max(0, limit - count),
      resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1_000))
    };
  }
}
