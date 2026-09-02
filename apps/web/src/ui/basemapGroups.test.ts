import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BasemapDefinition } from "@mapos/layer-sdk";
import { groupBasemaps } from "./basemapGroups.js";

function basemap(id: string, group: BasemapDefinition["group"]): BasemapDefinition {
  return {
    id,
    label: id,
    group,
    hint: id,
    kind: "vector",
    styleUrl: `https://example.invalid/${id}`,
    attribution: []
  };
}

describe("basemap manifest groups", () => {
  it("derives accordion membership from each manifest and keeps canonical group order", () => {
    const result = groupBasemaps([
      basemap("satellite-a", "satellite"),
      basemap("street-a", "street"),
      basemap("terrain-a", "terrain"),
      basemap("street-b", "street")
    ]);
    assert.deepEqual(
      result.map(({ group, items }) => ({ group, ids: items.map(({ id }) => id) })),
      [
        { group: "street", ids: ["street-a", "street-b"] },
        { group: "satellite", ids: ["satellite-a"] },
        { group: "terrain", ids: ["terrain-a"] }
      ]
    );
  });
});
