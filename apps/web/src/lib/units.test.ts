import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatDistance } from "./units";

describe("distance preference", () => {
  it("formats the same canonical metre value in metric or imperial units", () => {
    assert.equal(formatDistance(12_340, "metric"), "12.3 km");
    assert.equal(formatDistance(12_340, "imperial"), "7.7 mi");
    assert.equal(formatDistance(100, "imperial"), "328 ft");
  });
});
