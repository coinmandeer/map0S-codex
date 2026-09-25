// Import real provider data into a dedicated staging database, never the production DB.
const target = process.env.MAPOS_BOUNDARY_STAGE_DATABASE;
if (!target?.startsWith("mapos_opt_stage_")) throw new Error("A staging database is required");
const url = new URL(process.env.DATABASE_URL);
url.pathname = `/${target}`;
process.env.DATABASE_URL = url.toString();
const root = process.env.MAPOS_DRILL_MODULE_ROOT;
const { sql } = await import(`${root}/db/index.js`);
const { geoUnitsStatSeriesMigration } = await import(
  `${root}/db/migrations/0014GeoUnitsStatSeries.js`
);
const { geoUnitReleasesMigration } = await import(`${root}/db/migrations/0018GeoUnitReleases.js`);
const { importAllGeoUnits } = await import(`${root}/geo/geoUnitsImport.js`);
const { boundaryRepository } = await import(`${root}/geo/discoverBoundaries.js`);
const ids = (
  process.env.MAPOS_BOUNDARY_SOURCE_IDS ?? "natural-earth-countries,gb-cz-adm1,gb-cz-adm2"
).split(",");
try {
  await sql`CREATE EXTENSION IF NOT EXISTS postgis`;
  for (const migration of [geoUnitsStatSeriesMigration, geoUnitReleasesMigration]) {
    for (const step of migration.steps) await sql.unsafe(step.sql);
  }
  for (const id of ids) {
    const start = Date.now();
    try {
      const [result] = await importAllGeoUnits([id]);
      console.log(
        JSON.stringify({ source: id, status: "imported", elapsedMs: Date.now() - start, ...result })
      );
    } catch (error) {
      console.log(
        JSON.stringify({
          source: id,
          status: "failed",
          errorName: error.name,
          reason: error.name === "UpstreamError" ? error.message : undefined,
          elapsedMs: Date.now() - start
        })
      );
    }
  }
  const coverage = await boundaryRepository.coverage();
  console.log(JSON.stringify({ coverage }));
  const tile = await boundaryRepository.tile("adm2", 6, 34, 21);
  console.log(JSON.stringify({ tileBytes: tile.byteLength }));
} finally {
  await sql.end();
}
