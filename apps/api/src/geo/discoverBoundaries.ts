import { sql } from "drizzle-orm";
import type { AreaSelection } from "@mapos/layer-sdk";
import { areaGeometry } from "./areaSelection.js";
import { db } from "../db/index.js";
import { createHash } from "node:crypto";
import { ClientError } from "../utils/clientError.js";

export const DISCOVER_BOUNDARY_LEVELS = ["country", "adm1", "adm2", "lau"] as const;
export type DiscoverBoundaryLevel = (typeof DISCOVER_BOUNDARY_LEVELS)[number];
export interface BoundaryCoverage {
  country: string;
  level: DiscoverBoundaryLevel;
  count: number;
  source: string;
  edition: string;
  license?: string;
  attribution?: string;
}
export interface BoundaryRepository {
  coverage(revision?: string): Promise<BoundaryCoverage[]>;
  manifest?(): Promise<string | null>;
  tile(
    level: DiscoverBoundaryLevel,
    z: number,
    x: number,
    y: number,
    revision?: string,
    scope?: AreaSelection | null
  ): Promise<Uint8Array>;
}

const editionLevels = new Map<string, Promise<Array<{ country: string; level: string }>>>();
async function availableLevels(revision: string) {
  let result = editionLevels.get(revision);
  if (!result) {
    result = db
      .execute(
        sql`SELECT DISTINCT v.country,v.level FROM geo_unit_versions v
      JOIN geo_boundary_manifests m ON v.release_id=ANY(m.release_ids) WHERE m.revision=${revision}
      AND v.level IN ('country','adm1','adm2','lau')`
      )
      .then((rows) => Array.from(rows) as Array<{ country: string; level: string }>);
    editionLevels.set(revision, result);
    result.catch(() => editionLevels.delete(revision));
    if (editionLevels.size > 8) editionLevels.delete(editionLevels.keys().next().value!);
  }
  return result;
}

export const boundaryRepository: BoundaryRepository = {
  async manifest() {
    const rows = await db.execute(sql`SELECT id FROM (SELECT DISTINCT ON (provider_id,level)
      id,provider_id,level FROM geo_unit_releases WHERE status='published'
      AND level IN ('country','adm1','adm2','lau')
      ORDER BY provider_id,level,published_at DESC,id DESC) active ORDER BY id`);
    const ids = Array.from(rows).map((row) => String(row.id));
    if (!ids.length) return null;
    const revision = createHash("sha256")
      .update(JSON.stringify({ format: 2, ids }))
      .digest("hex");
    // The released geometry rows are retained for rollback, so every URL remains reproducible.
    await db.execute(sql`INSERT INTO geo_boundary_manifests(revision,release_ids)
      VALUES (${revision},${"{" + ids.join(",") + "}"}::uuid[]) ON CONFLICT DO NOTHING`);
    return revision;
  },
  async coverage(revision) {
    if (revision) {
      const rows = await db.execute(sql`SELECT v.country,v.level,count(*)::int AS count,
        v.source_id AS source,v.edition,r.license,r.attribution
        FROM geo_unit_versions v JOIN geo_unit_releases r ON r.id=v.release_id
        JOIN geo_boundary_manifests m ON v.release_id=ANY(m.release_ids)
        WHERE m.revision=${revision}
        GROUP BY v.country,v.level,v.source_id,v.edition,r.license,r.attribution ORDER BY v.country,v.level`);
      return Array.from(rows) as unknown as BoundaryCoverage[];
    }
    const rows =
      await db.execute(sql`SELECT coverage.*, rights.license, rights.attribution FROM (SELECT country, level, count(*)::int AS count,
      source_id AS source, edition FROM geo_units
      WHERE level IN ('country','adm1','adm2','lau')
      GROUP BY country, level, source_id, edition) coverage
      LEFT JOIN LATERAL (SELECT license,attribution FROM geo_unit_releases
        WHERE provider_id=coverage.source AND edition=coverage.edition AND status='published'
        ORDER BY published_at DESC LIMIT 1) rights ON true ORDER BY country,level`);
    return Array.from(rows) as unknown as BoundaryCoverage[];
  },
  async tile(level, z, x, y, revision, scope) {
    let modern = !revision;
    if (revision) {
      const found = await db.execute(
        sql`SELECT release_ids FROM geo_boundary_manifests WHERE revision=${revision}`
      );
      if (!Array.from(found).length) throw new ClientError("Boundary edition is unavailable", 404);
      const ids = (Array.from(found)[0]!.release_ids as string[]).slice().sort();
      modern =
        createHash("sha256")
          .update(JSON.stringify({ format: 2, ids }))
          .digest("hex") === revision;
    }
    const catalogue = revision
      ? sql`SELECT v.* FROM geo_unit_versions v JOIN geo_boundary_manifests m ON v.release_id=ANY(m.release_ids) WHERE m.revision=${revision}`
      : sql`SELECT * FROM geo_units`;
    // Availability is edition-wide metadata, not a 100k-row aggregation for every tile.
    const available = revision ? await availableLevels(revision) : null;
    const choices = new Map<string, number>();
    for (const item of available ?? []) {
      const depth = DISCOVER_BOUNDARY_LEVELS.indexOf(item.level as DiscoverBoundaryLevel);
      if (depth >= 0 && depth <= DISCOVER_BOUNDARY_LEVELS.indexOf(level))
        choices.set(item.country, Math.max(choices.get(item.country) ?? -1, depth));
    }
    const chosen = available
      ? choices.size
        ? sql`SELECT * FROM (VALUES ${sql.join(
            [...choices].map(([country, depth]) => sql`(${country}::text,${depth}::int)`),
            sql`,`
          )}) AS choices(country,depth)`
        : sql`SELECT NULL::text AS country, -1 AS depth WHERE false`
      : sql`SELECT country, max(CASE level WHEN 'country' THEN 0 WHEN 'adm1' THEN 1 WHEN 'adm2' THEN 2 ELSE 3 END) AS depth
        FROM catalogue WHERE level IN ('country','adm1','adm2','lau')
        AND CASE level WHEN 'country' THEN 0 WHEN 'adm1' THEN 1 WHEN 'adm2' THEN 2 ELSE 3 END <= ${DISCOVER_BOUNDARY_LEVELS.indexOf(level)} GROUP BY country`;
    const rows =
      await db.execute(sql`WITH catalogue AS NOT MATERIALIZED (${catalogue}), bounds AS (SELECT ST_TileEnvelope(${z},${x},${y}) AS envelope),
      visible AS (
        SELECT g.*, CASE g.level WHEN 'country' THEN 0 WHEN 'adm1' THEN 1 WHEN 'adm2' THEN 2 ELSE 3 END AS depth
        FROM catalogue g, bounds WHERE g.level IN ('country','adm1','adm2','lau')
          AND ${
            scope
              ? sql`g.country = ${scope.country} AND
            CASE g.level WHEN 'country' THEN 0 WHEN 'adm1' THEN 1 WHEN 'adm2' THEN 2 ELSE 3 END > ${DISCOVER_BOUNDARY_LEVELS.indexOf(scope.level)} AND
            g.geom && ${areaGeometry(scope)} AND ST_Covers(${areaGeometry(scope)}, g.centroid::geometry)`
              : sql`true`
          }
          AND g.geom && ST_Transform(ST_Expand(bounds.envelope, (ST_XMax(bounds.envelope)-ST_XMin(bounds.envelope))/64),4326)
      ), chosen AS (${chosen})
      SELECT ST_AsMVT(features, 'boundaries',4096,'geom') AS tile FROM (
        SELECT ${
          modern
            ? sql`jsonb_build_array(g.source_id, g.country, g.level, g.code)::text AS id,
          ST_XMin(g.geom) AS west, ST_YMin(g.geom) AS south, ST_XMax(g.geom) AS east, ST_YMax(g.geom) AS north,
          g.parent_code AS parent,`
            : sql`g.level || ':' || g.code AS id,`
        } g.code, g.name, g.level, g.country,
          g.source_id AS source, g.edition, 'candidate' AS kind,
          ST_X(g.centroid::geometry) AS lng, ST_Y(g.centroid::geometry) AS lat,
          g.level <> ${level} AS fallback,
          ST_AsMVTGeom(ST_Transform(g.geom,3857), bounds.envelope,4096,64,true) AS geom
        FROM visible g JOIN chosen c ON c.country IS NOT DISTINCT FROM g.country AND c.depth=g.depth CROSS JOIN bounds
      ) features`);
    const tile = (Array.from(rows)[0] as { tile?: Uint8Array } | undefined)?.tile;
    return tile ? new Uint8Array(tile) : new Uint8Array();
  }
};
