/**
 * A small bounded cache for expensive, idempotent reads (catalogue coverage, inventories).
 *
 * Concurrent callers of one key share a single load instead of each running the same query, a
 * failed load is not cached, and the oldest entry makes room once `maxEntries` is reached (a hit
 * moves its key to the young end, so the bound behaves like an LRU).
 */
export class TtlCache<V> {
  private readonly entries = new Map<string, { until: number; value: V }>();
  private readonly inflight = new Map<string, Promise<V>>();
  private readonly now: () => number;

  constructor(private readonly options: { ttlMs: number; maxEntries: number; now?: () => number }) {
    this.now = options.now ?? Date.now;
  }

  get(key: string): V | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (hit.until <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit.value;
  }

  set(key: string, value: V, ttlMs = this.options.ttlMs) {
    this.entries.delete(key);
    while (this.entries.size >= this.options.maxEntries)
      this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(key, { until: this.now() + ttlMs, value });
  }

  async getOrLoad(key: string, load: () => Promise<V>): Promise<V> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const running = this.inflight.get(key);
    if (running) return running;
    const promise = load()
      .then((value) => {
        this.set(key, value);
        return value;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }

  clear() {
    this.entries.clear();
  }

  get size() {
    return this.entries.size;
  }
}
