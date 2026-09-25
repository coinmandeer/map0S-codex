import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  USER_PRESET_LIMIT,
  parseUserPresets,
  sortUserPresets,
  userPresetId,
  withUserPreset,
  withoutUserPreset,
  type UserPreset
} from "./userPresets.js";

function preset(name: string, layers: string[] = ["osm-poi"]): UserPreset {
  return { id: userPresetId(name), name, layers };
}

describe("parseUserPresets", () => {
  it("survives anything that is not a list of presets", () => {
    assert.deepEqual(parseUserPresets(null), []);
    assert.deepEqual(parseUserPresets("{}"), []);
    // One bad entry does not cost the user the sets that are still readable.
    assert.deepEqual(
      parseUserPresets('[{"id":"user:a","name":"A","layers":["osm-poi"]},{"name":"broken"}]'),
      [{ id: "user:a", name: "A", layers: ["osm-poi"] }]
    );
  });
});

describe("withUserPreset", () => {
  it("replaces a set of the same name rather than growing a second card for it", () => {
    const saved = withUserPreset([preset("Weekend")], preset("weekend ", ["vanlife"]));
    assert.equal(saved.length, 1);
    assert.deepEqual(saved[0]!.layers, ["vanlife"]);
  });

  it("keeps every saved set rather than dropping the oldest", () => {
    const many = Array.from({ length: USER_PRESET_LIMIT }, (_, index) => preset(`Set ${index}`));
    const saved = withUserPreset(many, preset("Newest"));
    assert.equal(saved.length, USER_PRESET_LIMIT + 1);
    assert.equal(saved.at(-1)!.name, "Newest");
    // The oldest set is still there: saving must never silently delete the user's work.
    assert.ok(saved.some((item) => item.name === "Set 0"));
  });

  it("orders saved sets by their own timestamp when one is present", () => {
    const older = { ...preset("Older"), updatedAt: 100 };
    const newer = { ...preset("Newer"), updatedAt: 200 };
    assert.deepEqual(
      sortUserPresets([newer, older]).map((item) => item.name),
      ["Older", "Newer"]
    );
  });
});

describe("withoutUserPreset", () => {
  it("removes only the one asked for", () => {
    const saved = withoutUserPreset([preset("A"), preset("B")], userPresetId("A"));
    assert.deepEqual(
      saved.map((item) => item.name),
      ["B"]
    );
  });
});

describe("userPresetId", () => {
  it("makes a usable id out of a name in any script or spacing", () => {
    assert.equal(userPresetId("  Weekend  Trip "), "user:weekend-trip");
    // Nothing latin left to slug: still an id, because the name is the user's business.
    assert.equal(userPresetId("Тест"), "user:preset");
  });
});
