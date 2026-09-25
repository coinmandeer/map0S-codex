// Copy reviewed releases locally between databases, avoiding another public-provider download.
// Default is read-only; MAPOS_BOUNDARY_PUBLISH=1 enables per-source atomic publication.
const stageName = process.env.MAPOS_BOUNDARY_STAGE_DATABASE;
if (!stageName?.startsWith("mapos_opt_stage_"))
  throw new Error("Reviewed staging database required");
const stageUrl = new URL(process.env.DATABASE_URL);
if (stageUrl.pathname === `/${stageName}`)
  throw new Error("Staging must differ from the target database");
stageUrl.pathname = `/${stageName}`;
const { default: postgres } = await import("postgres");
const stage = postgres(stageUrl.toString(), { max: 1 });
const root = process.env.MAPOS_DRILL_MODULE_ROOT ?? "/app/apps/api/dist";
const { sql } = await import(`${root}/db/index.js`);
const { GEO_UNIT_SOURCES } = await import(`${root}/geo/geoUnitSources.js`);
const { createGeoUnitRelease, stageGeoUnitRows, publishGeoUnitRelease, failGeoUnitRelease } =
  await import(`${root}/geo/geoUnitReleases.js`);
try {
  const releases = await stage`SELECT DISTINCT ON (source_id) * FROM geo_unit_releases
    WHERE status='published' ORDER BY source_id,published_at DESC`;
  const requested = process.env.MAPOS_BOUNDARY_SOURCE_IDS?.split(",");
  if (requested?.some((id) => !releases.some((release) => release.source_id === id)))
    throw new Error("Requested release is absent from staging");
  for (const release of releases.filter(
    (release) => !requested || requested.includes(release.source_id)
  )) {
    let configured = GEO_UNIT_SOURCES.find((source) => source.id === release.source_id);
    if (!configured && /^gisco-lau-[a-z]{2}$/.test(release.source_id)) {
      const base = GEO_UNIT_SOURCES.find((source) => source.id === "gisco-lau");
      configured = { ...base, id: release.source_id, providerId: release.source_id };
      const country = release.source_id.slice(-2).toUpperCase();
      const invalid =
        await stage`SELECT 1 FROM geo_unit_versions WHERE release_id=${release.id} AND country IS DISTINCT FROM ${country} LIMIT 1`;
      if (invalid.length) throw new Error("LAU country publication contains another country");
    }
    if (
      !configured ||
      configured.providerId !== release.provider_id ||
      configured.level !== release.level
    ) {
      throw new Error("Staging source does not match the reviewed catalogue");
    }
    const [counts] =
      await stage`SELECT count(*)::int AS count FROM geo_unit_versions WHERE release_id=${release.id}`;
    if (counts.count !== release.feature_count || !counts.count)
      throw new Error("Staging count mismatch");
    if (process.env.MAPOS_BOUNDARY_PUBLISH !== "1") {
      console.log(
        JSON.stringify({
          source: release.source_id,
          count: counts.count,
          license: release.license,
          edition: release.edition,
          action: "preview"
        })
      );
      continue;
    }
    const source = {
      ...configured,
      edition: release.edition,
      license: release.license,
      attribution: release.attribution
    };
    const id = await createGeoUnitRelease(source);
    try {
      let copied = 0;
      for await (const batch of stage`SELECT level,code,name,parent_code,country,source_id,edition,
        ST_AsGeoJSON(geom)::json AS geometry,area_km2 FROM geo_unit_versions WHERE release_id=${release.id}`.cursor(
        200
      )) {
        await stageGeoUnitRows(
          id,
          batch.map((row) => ({
            level: row.level,
            code: row.code,
            name: row.name,
            parentCode: row.parent_code,
            country: row.country,
            sourceId: row.source_id,
            edition: row.edition,
            geometry: row.geometry,
            areaKm2: row.area_km2
          }))
        );
        copied += batch.length;
      }
      if (copied !== counts.count) throw new Error("Incomplete staged copy");
      await publishGeoUnitRelease(id);
      console.log(
        JSON.stringify({ source: source.id, count: copied, release: id, action: "published" })
      );
    } catch (error) {
      await failGeoUnitRelease(id);
      throw error;
    }
  }
  if (process.env.MAPOS_BOUNDARY_PUBLISH === "1") {
    // Published rows replace whole editions; refresh planner statistics before traffic hits them.
    const { analyzeTables } = await import(`${root}/db/analyze.js`);
    await analyzeTables(["geo_units", "geo_unit_versions", "geo_unit_releases"]);
  }
} finally {
  await stage.end();
  await sql.end();
}
