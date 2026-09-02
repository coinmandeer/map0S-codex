import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { activeLayerSummary, compactBasemapLabel } from "./modeBarPresentation.js";

describe("ModeBar presentation", () => {
  it("counts visible POI and thematic layers while excluding structural overlays", () => {
    const result = activeLayerSummary(
      {
        "osm-poi": { visible: true },
        weather: { visible: true },
        earthquakes: { visible: true },
        events: { visible: true },
        trails: { visible: true },
        hidden: { visible: false },
        foreign: { visible: true }
      },
      [
        { id: "osm-poi", kind: "pins", category: "travel" },
        { id: "weather", kind: "raster", category: "weather" },
        { id: "earthquakes", kind: "pins", category: "environment" },
        { id: "events", kind: "pins", category: "events" },
        { id: "trails", kind: "raster", category: "outdoor" },
        { id: "hidden", kind: "pins", category: "community" },
        {
          id: "foreign",
          kind: "pins",
          category: "travel",
          experienceIds: ["another-world"]
        }
      ],
      "default",
      (id) => id === "trails"
    );
    assert.deepEqual(result, { poi: 1, thematic: 3, total: 4 });
  });

  it("shortens long labels by Unicode code points and keeps the full short label", () => {
    assert.equal(compactBasemapLabel("CARTO Voyager"), "CARTO Voyager");
    assert.equal(compactBasemapLabel("OpenFreeMap Positron"), "OpenFreeMap Posit…");
    assert.equal(compactBasemapLabel("Žluťoučký podklad", 9), "Žluťoučk…");
  });
});
