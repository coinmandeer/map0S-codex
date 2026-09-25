import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyCannabisPlace, parseWeedTypes, presentWeedCollection } from "./weedService.js";

describe("weed classification", () => {
  it("distinguishes medical, recreational, mixed and unmarked shops", () => {
    assert.equal(classifyCannabisPlace("yes", "no"), "dispensary");
    assert.equal(classifyCannabisPlace("no", "only"), "shop");
    assert.equal(classifyCannabisPlace("yes", "yes"), "both");
    assert.equal(classifyCannabisPlace(undefined, undefined), "unknown");
  });

  it("keeps an explicit empty filter empty", () => {
    assert.equal(parseWeedTypes(undefined).size, 4);
    assert.equal(parseWeedTypes("").size, 0);
    assert.deepEqual([...parseWeedTypes("shop,unknown,invalid")], ["shop", "unknown"]);
  });

  it("keeps the OSM identity and details while filtering and relabeling pins", () => {
    const result = presentWeedCollection(
      {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [-118.25, 34.05] },
            properties: {
              id: "osm:node:42",
              osmId: "node:42",
              name: "Example",
              category: "cannabis",
              layerId: "osm-poi",
              cannabisMedical: "yes",
              website: "https://example.org"
            }
          },
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [-118.24, 34.06] },
            properties: {
              id: "fire:42",
              name: "Wildfire",
              category: "fire",
              layerId: "active-fires"
            }
          }
        ]
      },
      new Set(["dispensary"])
    );
    assert.equal(result.features[0]?.properties.id, "osm:node:42");
    assert.equal(result.features[0]?.properties.layerId, "weed");
    assert.equal(result.features[0]?.properties.category, "weed-dispensary");
    assert.equal(result.features[0]?.properties.sourceRefs, "osm:node:42");
    assert.equal(result.features[0]?.properties.website, "https://example.org");
    assert.equal(result.features.length, 1);
    assert.equal(presentWeedCollection(result, new Set(["shop"])).features.length, 0);
  });
});
