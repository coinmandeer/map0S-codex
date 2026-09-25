import assert from "node:assert/strict";
const target = process.env.MAPOS_DRILL_DATABASE;
if (!target?.startsWith("mapos_opt_drill_")) throw new Error("Isolated drill database required");
const url = new URL(process.env.DATABASE_URL);
url.pathname = `/${target}`;
process.env.DATABASE_URL = url.toString();
const root = process.env.MAPOS_DRILL_MODULE_ROOT;
const { sql } = await import(`${root}/db/index.js`);
const { createGeoUnitRelease, stageGeoUnitRows, publishGeoUnitRelease } = await import(
  `${root}/geo/geoUnitReleases.js`
);
const { boundaryRepository } = await import(`${root}/geo/discoverBoundaries.js`);
const { resolveAreaSelection, filterAreaFeatures } = await import(`${root}/geo/areaSelection.js`);
const source = {
  id: "area-test",
  providerId: "area-test",
  level: "lau",
  edition: "test",
  license: "fixture",
  attribution: "fixture"
};
const geometry = {
  type: "MultiPolygon",
  coordinates: [
    [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0]
      ],
      [
        [1, 1],
        [1, 3],
        [3, 3],
        [3, 1],
        [1, 1]
      ]
    ],
    [
      [
        [12, 0],
        [13, 0],
        [13, 1],
        [12, 1],
        [12, 0]
      ]
    ]
  ]
};
try {
  const release = await createGeoUnitRelease(source);
  await stageGeoUnitRows(release, [
    {
      level: "lau",
      code: "TEST_AREA",
      name: "Area with hole and island",
      parentCode: null,
      country: "XX",
      sourceId: source.providerId,
      edition: "test",
      geometry,
      areaKm2: null
    }
  ]);
  await publishGeoUnitRelease(release);
  const revision = await boundaryRepository.manifest();
  const area = await resolveAreaSelection({
    areaId: JSON.stringify(["area-test", "XX", "lau", "TEST_AREA"]),
    boundaryRevision: revision
  });
  assert.equal(area.name, "Area with hole and island");
  assert.deepEqual(area.bbox, [0, 0, 13, 10]);
  const point = (id, x, y) => ({
    type: "Feature",
    properties: { id, name: id, layerId: "test" },
    geometry: { type: "Point", coordinates: [x, y] }
  });
  const input = {
    type: "FeatureCollection",
    features: [
      point("inside", 5, 5),
      point("hole", 2, 2),
      point("island", 12.5, 0.5),
      point("edge", 0, 0),
      point("outside", 15, 15),
      {
        type: "Feature",
        properties: { id: "crossing", name: "Crossing", layerId: "test" },
        geometry: {
          type: "LineString",
          coordinates: [
            [-1, 5],
            [11, 5]
          ]
        }
      }
    ]
  };
  const filtered = await filterAreaFeatures(input, area);
  assert.deepEqual(
    filtered.features.map((f) => f.properties.id),
    ["inside", "island", "edge", "crossing"]
  );
  await assert.rejects(resolveAreaSelection({ areaId: area.id, boundaryRevision: "f".repeat(64) }));
  console.log(
    JSON.stringify({
      polygonHole: true,
      island: true,
      boundaryPoint: true,
      crossingRoute: true,
      missingRevisionRejected: true,
      bbox: area.bbox
    })
  );
} finally {
  await sql.end();
}
