import assert from "node:assert/strict";
import test from "node:test";
import {
  DistributedFixedWindowRateLimiter,
  PostgresRateLimitWindowStore,
  type RateLimitWindowStore
} from "./distributedRateLimiter.js";

class SharedMemoryWindowStore implements RateLimitWindowStore {
  readonly counts = new Map<string, number>();
  readonly inputs: Array<{ bucketHash: string; windowStartMs: number }> = [];

  async increment(input: {
    bucketHash: string;
    windowStartMs: number;
    windowMs: number;
    expiresAt: Date;
  }): Promise<number> {
    this.inputs.push(input);
    const key = `${input.bucketHash}:${input.windowStartMs}`;
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    return count;
  }

  async deleteExpired(): Promise<void> {}
}

test("the postgres adapter serializes expiry dates before using the unsafe parameter API", async () => {
  const calls: Array<{ statement: string; parameters: Array<string | number> }> = [];
  const store = new PostgresRateLimitWindowStore({
    async unsafe<T extends unknown[]>(
      statement: string,
      parameters: Array<string | number> = []
    ): Promise<T> {
      calls.push({ statement, parameters });
      return [{ request_count: 1 }] as T;
    }
  });

  const count = await store.increment({
    bucketHash: "a".repeat(64),
    windowStartMs: 1_788_290_740_000,
    windowMs: 60_000,
    expiresAt: new Date("2026-09-01T16:24:00.000Z")
  });

  assert.equal(count, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.parameters[3], "2026-09-01T16:24:00.000Z");
  assert.equal(
    calls[0]?.parameters.some((value) => Object.prototype.toString.call(value) === "[object Date]"),
    false
  );
});

test("two limiter instances consume one shared window without storing a raw IP", async () => {
  const store = new SharedMemoryWindowStore();
  const now = () => Date.parse("2026-09-01T08:00:30.000Z");
  const first = new DistributedFixedWindowRateLimiter(store, "a".repeat(32), now);
  const second = new DistributedFixedWindowRateLimiter(store, "a".repeat(32), now);
  assert.equal((await first.consume("auth:203.0.113.44", 2, 60_000)).allowed, true);
  assert.equal((await second.consume("auth:203.0.113.44", 2, 60_000)).allowed, true);
  const denied = await first.consume("auth:203.0.113.44", 2, 60_000);
  assert.equal(denied.allowed, false);
  assert.equal(denied.remaining, 0);
  assert.equal(denied.retryAfterSeconds, 30);
  assert.match(store.inputs[0]?.bucketHash ?? "", /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(store.inputs), /203\.0\.113\.44|auth/);
});

test("distributed windows reset deterministically", async () => {
  const store = new SharedMemoryWindowStore();
  let current = 30_000;
  const limiter = new DistributedFixedWindowRateLimiter(store, "b".repeat(32), () => current);
  assert.equal((await limiter.consume("read:ip", 1, 60_000)).allowed, true);
  assert.equal((await limiter.consume("read:ip", 1, 60_000)).allowed, false);
  current = 60_001;
  assert.equal((await limiter.consume("read:ip", 1, 60_000)).allowed, true);
});
