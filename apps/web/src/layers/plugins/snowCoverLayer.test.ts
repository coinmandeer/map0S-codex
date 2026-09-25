import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { snowCoverDay } from "./snowCoverLayer.js";

/**
 * The dated GIBS product only reads a date it can actually request. A malformed or absent
 * filter must fall back to the published default rather than building a broken tile URL.
 */
describe("snow cover day", () => {
  it("accepts an ISO day from a filter, array or single value", () => {
    assert.equal(snowCoverDay({ day: "2026-01-15" }), "2026-01-15");
    assert.equal(snowCoverDay({ day: ["2026-02-01", "2026-02-02"] }), "2026-02-01");
  });

  it("falls back to a real recent day for anything unusable", () => {
    for (const value of [undefined, null, "", "yesterday", "2026-1-1", 42, {}]) {
      const day = snowCoverDay({ day: value });
      assert.match(day, /^\d{4}-\d{2}-\d{2}$/, `expected an ISO day for ${JSON.stringify(value)}`);
    }
  });
});
