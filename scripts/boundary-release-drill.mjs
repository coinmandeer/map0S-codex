// Run only in an isolated database. MODULE_ROOT points to compiled apps/api/dist.
import assert from "node:assert/strict";
const target = process.env.MAPOS_DRILL_DATABASE;
if (!target?.startsWith("mapos_opt_drill_"))
  throw new Error("An isolated drill database is required");
const url = new URL(process.env.DATABASE_URL);
url.pathname = `/${target}`;
process.env.DATABASE_URL = url.toString();
const root = process.env.MAPOS_DRILL_MODULE_ROOT;
const { sql } = await import(`${root}/db/index.js`);
const { geoUnitsStatSeriesMigration } = await import(
  `${root}/db/migrations/0014GeoUnitsStatSeries.js`
);
const { geoUnitReleasesMigration } = await import(`${root}/db/migrations/0018GeoUnitReleases.js`);
const { boundaryManifestsMigration } = await import(
  `${root}/db/migrations/0019BoundaryManifests.js`
);
const { createGeoUnitRelease, stageGeoUnitRows, publishGeoUnitRelease } = await import(
  `${root}/geo/geoUnitReleases.js`
);
const { boundaryRepository } = await import(`${root}/geo/discoverBoundaries.js`);
const source = {
  id: "drill-countries",
  providerId: "drill",
  level: "country",
  edition: "one",
  license: "fixture",
  attribution: "fixture"
};
const polygon = {
  type: "Polygon",
  coordinates: [
    [
      [13, 49],
      [15, 49],
      [15, 51],
      [13, 51],
      [13, 49]
    ]
  ]
};
const row = {
  level: "country",
  code: "CZ",
  name: "Old country",
  parentCode: null,
  country: "CZ",
  sourceId: "drill",
  edition: "one",
  geometry: polygon,
  areaKm2: null
};
try {
  await sql`CREATE EXTENSION IF NOT EXISTS postgis`;
  for (const migration of [
    geoUnitsStatSeriesMigration,
    geoUnitReleasesMigration,
    boundaryManifestsMigration
  ]) {
    for (const step of migration.steps) await sql.unsafe(step.sql);
  }
  const old = await createGeoUnitRelease(source);
  const island = {
    ...row,
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [16, 49],
          [17, 49],
          [17, 50],
          [16, 50],
          [16, 49]
        ]
      ]
    }
  };
  await stageGeoUnitRows(old, [row, island]);
  assert.equal((await boundaryRepository.coverage()).length, 0, "staging is invisible");
  await publishGeoUnitRelease(old);
  assert.equal(
    Number((await sql`SELECT ST_Area(geom) AS area FROM geo_units WHERE code='CZ'`)[0].area),
    5,
    "duplicate country parts retain both mainland and island"
  );
  assert.equal((await boundaryRepository.coverage())[0].count, 1);
  const oldManifest = await boundaryRepository.manifest();
  const oldTile = await boundaryRepository.tile("country", 4, 8, 5, oldManifest);
  await assert.rejects(
    stageGeoUnitRows(old, [{ ...row, name: "Mutated published geometry" }]),
    /immutable/
  );
  const next = await createGeoUnitRelease({ ...source, edition: "two" });
  await stageGeoUnitRows(next, [{ ...row, name: "New country", edition: "two" }]);
  assert.equal((await sql`SELECT name FROM geo_units`)[0].name, "Old country");
  await publishGeoUnitRelease(next);
  const newManifest = await boundaryRepository.manifest();
  assert.notEqual(newManifest, oldManifest);
  assert.deepEqual(
    await boundaryRepository.tile("country", 4, 8, 5, oldManifest),
    oldTile,
    "old tile URL never changes after publication"
  );
  assert.notDeepEqual(await boundaryRepository.tile("country", 4, 8, 5, newManifest), oldTile);
  assert.equal((await sql`SELECT name FROM geo_units`)[0].name, "New country");
  const empty = await createGeoUnitRelease(source);
  await assert.rejects(publishGeoUnitRelease(empty), /empty/);
  assert.equal((await sql`SELECT name FROM geo_units`)[0].name, "New country");
  const tile = await boundaryRepository.tile("lau", 4, 8, 5);
  assert.ok(tile.byteLength > 0, "missing LAU falls back to country MVT");
  await publishGeoUnitRelease(old);
  assert.equal(
    await boundaryRepository.manifest(),
    oldManifest,
    "rollback restores the identical snapshot URL"
  );
  assert.equal((await sql`SELECT name FROM geo_units`)[0].name, "Old country");
  const conflicting = await createGeoUnitRelease({
    ...source,
    id: "other-source",
    providerId: "other-source"
  });
  await stageGeoUnitRows(conflicting, [
    { ...row, sourceId: "other-source", name: "Wrong replacement" }
  ]);
  await assert.rejects(publishGeoUnitRelease(conflicting), /conflicts/);
  assert.equal((await sql`SELECT name FROM geo_units`)[0].name, "Old country");
  const admin = await createGeoUnitRelease({
    ...source,
    id: "drill-admin",
    providerId: "drill-admin",
    level: "adm1"
  });
  await stageGeoUnitRows(
    admin,
    Array.from({ length: 25 }, (_, i) => {
      const x = 13 + (i % 5) * 0.2,
        y = 49 + Math.floor(i / 5) * 0.2;
      return {
        ...row,
        sourceId: "drill-admin",
        level: "adm1",
        code: `CZ-${i}`,
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [x, y],
              [x + 0.2, y],
              [x + 0.2, y + 0.2],
              [x, y + 0.2],
              [x, y]
            ]
          ]
        }
      };
    })
  );
  await publishGeoUnitRelease(admin);
  const many = await boundaryRepository.tile("lau", 4, 8, 5);
  console.log(
    JSON.stringify({
      stagingInvisible: true,
      atomicPublication: true,
      emptyRejected: true,
      rollback: true,
      immutableManifest: true,
      providerCollisionRejected: true,
      mvtBytes: tile.byteLength,
      multiRegionTile: Buffer.from(many).toString("base64")
    })
  );
} finally {
  await sql.end();
}
