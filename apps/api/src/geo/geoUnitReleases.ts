import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import type { GeoUnitSource } from "./geoUnitSources.js";
import type { GeoUnitRow } from "./geoUnitsImport.js";

/** Stage rows durably in small batches. Only the final transaction changes the live catalogue. */
export async function createGeoUnitRelease(source: GeoUnitSource) {
  const id = randomUUID();
  await db.execute(sql`INSERT INTO geo_unit_releases
    (id,source_id,provider_id,level,edition,license,attribution,status)
    VALUES (${id},${source.id},${source.providerId},${source.level},${source.edition},${source.license},${source.attribution},'staging')`);
  return id;
}

export async function stageGeoUnitRows(id: string, rows: readonly GeoUnitRow[]) {
  await db.transaction(async (tx) => {
    const release = await tx.execute(
      sql`SELECT status FROM geo_unit_releases WHERE id=${id} FOR UPDATE`
    );
    if (Array.from(release)[0]?.status !== "staging")
      throw new Error("Published boundary geometry is immutable");
    for (const row of rows) {
      await tx.execute(sql`INSERT INTO geo_unit_versions
        (release_id,level,code,name,parent_code,country,source_id,edition,geom,centroid,area_km2)
        SELECT ${id},${row.level},${row.code},${row.name},${row.parentCode},${row.country},${row.sourceId},${row.edition},
          geom,ST_PointOnSurface(geom)::geography,${row.areaKm2}
        FROM (SELECT ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_GeomFromGeoJSON(${JSON.stringify(row.geometry)})),3)) AS geom) shape
        ON CONFLICT (release_id,level,code) DO UPDATE SET name=excluded.name,parent_code=excluded.parent_code,
          country=excluded.country,
          geom=ST_Multi(ST_Union(geo_unit_versions.geom,excluded.geom)),
          centroid=ST_PointOnSurface(ST_Union(geo_unit_versions.geom,excluded.geom))::geography,
          area_km2=excluded.area_km2`);
    }
  });
}

export async function failGeoUnitRelease(id: string) {
  await db.execute(
    sql`UPDATE geo_unit_releases SET status='failed' WHERE id=${id} AND status='staging'`
  );
}

export async function updateGeoUnitReleaseMetadata(id: string, source: GeoUnitSource) {
  await db.execute(sql`UPDATE geo_unit_releases SET edition=${source.edition},license=${source.license},
    attribution=${source.attribution} WHERE id=${id} AND status='staging'`);
}

/** Re-publishing a previous complete release is the rollback operation. Stored versions remain. */
export async function publishGeoUnitRelease(id: string) {
  await db.transaction(async (tx) => {
    const releases = await tx.execute(
      sql`SELECT * FROM geo_unit_releases WHERE id=${id} FOR UPDATE`
    );
    const release = Array.from(releases)[0] as
      { source_id: string; provider_id: string; level: string; status: string } | undefined;
    if (!release || release.status === "failed")
      throw new Error("Boundary release is not publishable");
    // Different providers share the level/code namespace. Serialize publication at level scope
    // so a conflicting provider cannot slip between the collision check and the insertion.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${"geo-unit-level:" + release.level}))`
    );
    const check = await tx.execute(sql`SELECT count(*)::int AS count,
      count(*) FILTER (WHERE ST_IsEmpty(geom) OR NOT ST_IsValid(geom) OR ST_SRID(geom)<>4326)::int AS invalid
      FROM geo_unit_versions WHERE release_id=${id}`);
    const { count, invalid } = Array.from(check)[0] as { count: number; invalid: number };
    if (!count || invalid)
      throw new Error("Boundary release is empty or contains invalid geometry");
    const collisions = await tx.execute(sql`SELECT 1 FROM geo_unit_versions v JOIN geo_units g
      ON g.level=v.level AND g.code=v.code
      WHERE v.release_id=${id} AND g.source_id<>${release.provider_id} LIMIT 1`);
    if (Array.from(collisions).length)
      throw new Error("Boundary identity conflicts with another provider");
    // Preserve the original unversioned catalogue before the first replacement too.
    const backupId = randomUUID();
    await tx.execute(sql`INSERT INTO geo_unit_releases(id,source_id,provider_id,level,edition,license,attribution,status)
      SELECT ${backupId},${release.source_id},${release.provider_id},${release.level},'legacy-snapshot','See original source','Preserved catalogue','ready'
      WHERE EXISTS (SELECT 1 FROM geo_units WHERE source_id=${release.provider_id} AND level=${release.level})
      AND NOT EXISTS (SELECT 1 FROM geo_unit_releases WHERE source_id=${release.source_id} AND status='published')`);
    await tx.execute(sql`INSERT INTO geo_unit_versions
      SELECT ${backupId},level,code,name,parent_code,country,source_id,edition,geom,centroid,area_km2
      FROM geo_units WHERE source_id=${release.provider_id} AND level=${release.level}
      AND EXISTS (SELECT 1 FROM geo_unit_releases WHERE id=${backupId})`);
    await tx.execute(
      sql`DELETE FROM geo_units WHERE source_id=${release.provider_id} AND level=${release.level}`
    );
    await tx.execute(sql`INSERT INTO geo_units(level,code,name,parent_code,country,source_id,edition,geom,centroid,area_km2)
      SELECT level,code,name,parent_code,country,source_id,edition,geom,centroid,area_km2
      FROM geo_unit_versions WHERE release_id=${id}
      ON CONFLICT (level,code) DO UPDATE SET name=excluded.name,parent_code=excluded.parent_code,country=excluded.country,
        source_id=excluded.source_id,edition=excluded.edition,geom=excluded.geom,centroid=excluded.centroid,
        area_km2=excluded.area_km2,imported_at=now()`);
    await tx.execute(
      sql`UPDATE geo_unit_releases SET status='published',published_at=now(),feature_count=${count} WHERE id=${id}`
    );
  });
}
