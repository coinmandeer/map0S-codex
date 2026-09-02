import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nextPresetIndex } from "./presetNavigation.js";

describe("preset strip keyboard navigation", () => {
  it("moves within four presets and supports both ends", () => {
    assert.equal(nextPresetIndex(0, "ArrowRight", 4), 1);
    assert.equal(nextPresetIndex(3, "ArrowRight", 4), 3);
    assert.equal(nextPresetIndex(3, "ArrowLeft", 4), 2);
    assert.equal(nextPresetIndex(2, "Home", 4), 0);
    assert.equal(nextPresetIndex(0, "End", 4), 3);
    assert.equal(nextPresetIndex(0, "Enter", 4), null);
  });
});
