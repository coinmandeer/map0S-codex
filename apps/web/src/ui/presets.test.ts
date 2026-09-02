import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAP_PRESETS } from "./presets.js";

describe("canonical map presets", () => {
  it("exposes exactly the four source-grounded use cases in navigation order", () => {
    assert.deepEqual(
      MAP_PRESETS.map(({ id, name }) => ({ id, name })),
      [
        { id: "day-trip", name: "Výlet" },
        { id: "city", name: "Město" },
        { id: "travel", name: "Cestování" },
        { id: "sport", name: "Sport" }
      ]
    );
  });

  it("keeps every preset declarative, unique and bounded to registered layer ids", () => {
    assert.equal(new Set(MAP_PRESETS.map((preset) => preset.id)).size, MAP_PRESETS.length);
    for (const preset of MAP_PRESETS) {
      assert.ok(preset.layers.length > 0, `${preset.id} must activate a layer`);
      assert.equal(
        new Set(preset.layers).size,
        preset.layers.length,
        `${preset.id} repeats a layer`
      );
      assert.ok(preset.categories?.length, `${preset.id} must declare its POI intent`);
    }
  });

  it("covers every source-grounded category family without hiding partner-independent data", () => {
    const byId = Object.fromEntries(MAP_PRESETS.map((preset) => [preset.id, preset]));
    for (const category of [
      "castle",
      "viewpoint",
      "lake",
      "peak",
      "observation_tower",
      "nature_park"
    ]) {
      assert.ok(byId["day-trip"]!.categories!.includes(category as never), `Výlet: ${category}`);
    }
    for (const category of ["cafe", "shop", "restaurant", "bar", "brewery", "museum"]) {
      assert.ok(byId.city!.categories!.includes(category as never), `Město: ${category}`);
    }
    for (const category of ["camp_site", "fuel", "parking", "toilets", "shower"]) {
      assert.ok(byId.travel!.categories!.includes(category as never), `Cestování: ${category}`);
    }
    assert.ok(byId.travel!.layers.includes("vanlife"));
    for (const category of ["via_ferrata", "skatepark", "climbing", "swimming", "fitness_centre"]) {
      assert.ok(byId.sport!.categories!.includes(category as never), `Sport: ${category}`);
    }
    assert.ok(byId.sport!.layers.includes("waymarked-trails"));
  });
});
