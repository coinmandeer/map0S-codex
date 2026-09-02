import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  readPrivatePlaceNote,
  writePrivatePlaceNote,
  type KeyValueStorage
} from "./privatePlaceNote";

function memoryStorage(): KeyValueStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
}

describe("private place note", () => {
  it("is scoped by stable place id and remains usable offline", () => {
    const storage = memoryStorage();
    writePrivatePlaceNote(storage, "osm:node/42", "  Tiché místo  ", "2026-09-01T12:00:00Z");
    assert.deepEqual(readPrivatePlaceNote(storage, "osm:node/42"), {
      body: "Tiché místo",
      updatedAt: "2026-09-01T12:00:00Z"
    });
    assert.equal(readPrivatePlaceNote(storage, "osm:node/43"), null);
  });

  it("removes an empty note and rejects malformed storage", () => {
    const storage = memoryStorage();
    writePrivatePlaceNote(storage, "place", "note");
    assert.equal(writePrivatePlaceNote(storage, "place", "  "), null);
    assert.equal(readPrivatePlaceNote(storage, "place"), null);

    const broken: KeyValueStorage = {
      getItem: () => "{broken",
      setItem: () => undefined,
      removeItem: () => undefined
    };
    assert.equal(readPrivatePlaceNote(broken, "place"), null);
  });
});
