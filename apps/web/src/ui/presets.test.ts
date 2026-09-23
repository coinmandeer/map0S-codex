import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { basemapById } from "@mapos/layer-sdk";
import { MAP_PRESETS } from "./presets.js";

describe("canonical map presets", () => {
  it("exposes the seven use cases in navigation order", () => {
    assert.deepEqual(
      MAP_PRESETS.map(({ id, name }) => ({ id, name })),
      [
        { id: "day-trip", name: "Výlet" },
        { id: "city", name: "Město" },
        { id: "travel", name: "Cestování" },
        { id: "sport", name: "Sport" },
        { id: "planet", name: "Planeta" },
        { id: "game", name: "Hra" },
        { id: "data", name: "Data" }
      ]
    );
  });

  it("keeps every preset declarative, unique and bounded to registered layer ids", () => {
    assert.equal(new Set(MAP_PRESETS.map((preset) => preset.id)).size, MAP_PRESETS.length);
    for (const preset of MAP_PRESETS) {
      assert.ok(
        preset.layers.length > 0 || preset.openStatistics,
        `${preset.id} must activate a layer or open the statistics explorer`
      );
      assert.equal(
        new Set(preset.layers).size,
        preset.layers.length,
        `${preset.id} repeats a layer`
      );
      for (const layerId of Object.keys(preset.filters ?? {})) {
        assert.ok(
          preset.layers.includes(layerId),
          `${preset.id} declares filters for a layer it does not activate: ${layerId}`
        );
      }
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

  it("the Planet preset carries the shared event-pipeline layers, not viewport data", () => {
    const planet = MAP_PRESETS.find((preset) => preset.id === "planet")!;
    assert.ok(planet.layers.includes("weather-radar"));
    assert.ok(planet.layers.includes("eonet"));
    assert.deepEqual(planet.filters?.eonet?.category, [
      "wildfires",
      "volcanoes",
      "earthquakes",
      "severeStorms"
    ]);
    assert.equal(planet.basemap, "gibs-viirs");
  });

  it("every declared basemap exists and is keyless, so a preset never strands the user on a broken background", () => {
    for (const preset of MAP_PRESETS) {
      if (!preset.basemap) continue;
      const basemap = basemapById(preset.basemap);
      assert.ok(basemap, `${preset.id} basemap ${preset.basemap} must exist`);
      assert.ok(!basemap?.requiresCapability, `${preset.id} basemap must be keyless`);
    }
  });
});
