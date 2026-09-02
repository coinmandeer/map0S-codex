import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createRecentSearchRepository,
  LEGACY_SEARCH_HISTORY_KEY,
  RECENT_SEARCHES_KEY
} from "./recentSearches.js";

class MemoryStorage {
  readonly values = new Map<string, string>();
  failGet = false;
  failSet = false;
  failRemove = false;

  getItem(key: string): string | null {
    if (this.failGet) throw new Error("get failed");
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failSet) throw new Error("set failed");
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    if (this.failRemove) throw new Error("remove failed");
    this.values.delete(key);
  }
}

describe("recent search repository", () => {
  it("migrates the legacy string list once, preserving order and deduplicating", () => {
    const storage = new MemoryStorage();
    storage.values.set(
      LEGACY_SEARCH_HISTORY_KEY,
      JSON.stringify(["Praha", " Brno ", "praha", null, ""])
    );
    const repository = createRecentSearchRepository(storage, { now: () => 1_000 });

    const entries = repository.list();
    assert.deepEqual(
      entries.map(({ query, usedAt }) => ({ query, usedAt })),
      [
        { query: "Praha", usedAt: 1_000 },
        { query: "Brno", usedAt: 999 }
      ]
    );
    assert.equal(storage.values.has(LEGACY_SEARCH_HISTORY_KEY), false);
    assert.equal(JSON.parse(storage.values.get(RECENT_SEARCHES_KEY)!).version, 1);
  });

  it("does not remove legacy data until the versioned write succeeds", () => {
    const storage = new MemoryStorage();
    storage.values.set(LEGACY_SEARCH_HISTORY_KEY, JSON.stringify(["Praha"]));
    storage.failSet = true;
    const repository = createRecentSearchRepository(storage);

    assert.equal(repository.list()[0]?.query, "Praha");
    assert.equal(storage.values.has(LEGACY_SEARCH_HISTORY_KEY), true);
  });

  it("adds most recent first, deduplicates case-insensitively and caps the list", () => {
    const storage = new MemoryStorage();
    let timestamp = 10;
    const repository = createRecentSearchRepository(storage, {
      maxEntries: 2,
      now: () => timestamp++
    });

    repository.add({ query: "Praha", kind: "locality" });
    repository.add({ query: "Brno", label: "Brno, Česko", kind: "locality" });
    const result = repository.add({ query: "praha", label: "Praha znovu", kind: "locality" });

    assert.deepEqual(
      result.map((entry) => entry.query),
      ["praha", "Brno"]
    );
    assert.equal(result[0]?.label, "Praha znovu");
  });

  it("keeps exact locations private unless persistence was explicitly enabled", () => {
    const storage = new MemoryStorage();
    const privateByDefault = createRecentSearchRepository(storage, { now: () => 50 });
    assert.deepEqual(
      privateByDefault.add({
        query: "49.7, 13.3",
        kind: "coordinates",
        coordinates: { lat: 49.7, lng: 13.3 }
      }),
      []
    );
    assert.deepEqual(
      privateByDefault.add({ query: "https://maps.apple.com/?ll=49.7,13.3", kind: "place" }),
      []
    );

    const optedIn = createRecentSearchRepository(new MemoryStorage(), {
      now: () => 50,
      persistPreciseLocations: true
    });
    assert.deepEqual(
      optedIn.add({
        query: "49.7, 13.3",
        kind: "coordinates",
        coordinates: { lat: 49.7, lng: 13.3 }
      })[0]?.coordinates,
      { lat: 49.7, lng: 13.3 }
    );
  });

  it("filters precise legacy entries while migrating with the private default", () => {
    const storage = new MemoryStorage();
    storage.values.set(
      LEGACY_SEARCH_HISTORY_KEY,
      JSON.stringify(["49.7, 13.3", "https://mapos.example/?lat=49.7&lng=13.3", "Praha"])
    );
    const repository = createRecentSearchRepository(storage);
    assert.deepEqual(
      repository.list().map((entry) => entry.query),
      ["Praha"]
    );
  });

  it("returns defensive copies", () => {
    const storage = new MemoryStorage();
    const repository = createRecentSearchRepository(storage, { now: () => 100 });
    const first = repository.add({ query: "Praha", kind: "locality" });
    first[0]!.label = "mutated";
    assert.equal(repository.list()[0]?.label, "Praha");
  });

  it("treats corrupt or unavailable storage as an empty safe repository", () => {
    const corrupt = new MemoryStorage();
    corrupt.values.set(RECENT_SEARCHES_KEY, "not-json");
    assert.deepEqual(createRecentSearchRepository(corrupt).list(), []);

    const unavailable = new MemoryStorage();
    unavailable.failGet = true;
    assert.deepEqual(createRecentSearchRepository(unavailable).list(), []);

    const oddOptions = createRecentSearchRepository(new MemoryStorage(), {
      maxEntries: Number.NaN,
      now: () => Number.NaN
    });
    assert.equal(oddOptions.add({ query: "Praha", kind: "locality" })[0]?.usedAt, 0);
  });

  it("clears both current and legacy keys and reports storage failure", () => {
    const storage = new MemoryStorage();
    storage.values.set(RECENT_SEARCHES_KEY, "{}");
    storage.values.set(LEGACY_SEARCH_HISTORY_KEY, "[]");
    const repository = createRecentSearchRepository(storage);
    assert.equal(repository.clear(), true);
    assert.equal(storage.values.size, 0);

    storage.failRemove = true;
    assert.equal(repository.clear(), false);
  });
});
