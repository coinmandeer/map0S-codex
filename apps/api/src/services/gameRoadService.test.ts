import assert from "node:assert/strict";
import test from "node:test";
import { permitsFoot, walkableRoads } from "./gameRoadService.js";
test("walkable roads reject private, conditional, motorways and unknown cycleway permission", () => {
  assert.equal(permitsFoot({ highway: "footway" }), true);
  const denied: Record<string, string>[] = [
    { highway: "motorway", foot: "yes" },
    { highway: "footway", access: "private" },
    { highway: "path", "foot:conditional": "yes @ summer" },
    { highway: "cycleway" },
    { highway: "construction", foot: "yes" }
  ];
  for (const tags of denied) assert.equal(permitsFoot(tags), false);
  assert.equal(permitsFoot({ highway: "cycleway", foot: "designated" }), true);
});
test("barriers split ways and grade-separated crossings retain distinct original node IDs", () => {
  const geometry = Array.from({ length: 5 }, (_, i) => ({ lon: 14 + i * 0.001, lat: 50 }));
  const roads = walkableRoads([
    {
      type: "way",
      id: 1,
      nodes: [1, 2, 3, 4, 5],
      tags: { highway: "footway", bridge: "yes", layer: "1" },
      geometry
    },
    { type: "node", id: 3, tags: { barrier: "gate" } },
    {
      type: "way",
      id: 2,
      nodes: [11, 12],
      tags: { highway: "footway", tunnel: "yes", layer: "-1" },
      geometry: geometry.slice(0, 2)
    }
  ]);
  assert.deepEqual(
    roads.map((r) => r.nodeIds),
    [
      [1, 2],
      [4, 5],
      [11, 12]
    ]
  );
  assert.equal(roads[0]!.tags!.bridge, "yes");
  assert.equal(roads[2]!.tags!.layer, "-1");
});
