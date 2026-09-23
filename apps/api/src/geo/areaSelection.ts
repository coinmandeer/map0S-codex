import { sql, type SQL } from "drizzle-orm";
import { db } from "../db/index.js";
import { ClientError } from "../utils/clientError.js";
import type { AreaSelection, FeatureCollection } from "@mapos/layer-sdk";

export function parseAreaReference(query: Record<string, string | undefined>) {
  if (!query.areaId && !query.boundaryRevision) return null;
  if (
    !query.areaId ||
    query.areaId.length > 1024 ||
    !/^[a-f0-9]{64}$/.test(query.boundaryRevision ?? "")
  )
    throw new ClientError("Neplatná oblast nebo vydání hranic", 400);
  let parts: unknown;
  try {
    parts = JSON.parse(query.areaId);
  } catch {
    throw new ClientError("Neplatná identita oblasti", 400);
  }
  if (
    !Array.isArray(parts) ||
    parts.length !== 4 ||
    !parts.every((p) => typeof p === "string" && p.length > 0) ||
    !["country", "adm1", "adm2", "lau"].includes(parts[2])
  )
    throw new ClientError("Neplatná identita oblasti", 400);
  const [source, country, level, code] = parts as [string, string, AreaSelection["level"], string];
  return { id: query.areaId, revision: query.boundaryRevision!, source, country, level, code };
}
export function areaGeometry(
  area: Pick<AreaSelection, "revision" | "source" | "country" | "level" | "code">
): SQL {
  return sql`(SELECT v.geom FROM geo_unit_versions v JOIN geo_boundary_manifests m ON v.release_id=ANY(m.release_ids)
    WHERE m.revision=${area.revision} AND v.source_id=${area.source} AND v.country=${area.country}
    AND v.level=${area.level} AND v.code=${area.code})`;
}
export async function resolveAreaSelection(
  query: Record<string, string | undefined>
): Promise<AreaSelection | null> {
  const ref = parseAreaReference(query);
  if (!ref) return null;
  const rows = await db.execute(sql`SELECT name, ST_XMin(geom) AS west, ST_YMin(geom) AS south,
    ST_XMax(geom) AS east, ST_YMax(geom) AS north FROM geo_unit_versions v
    JOIN geo_boundary_manifests m ON v.release_id=ANY(m.release_ids)
    WHERE m.revision=${ref.revision} AND v.source_id=${ref.source} AND v.country=${ref.country}
    AND v.level=${ref.level} AND v.code=${ref.code}`);
  if (rows.length !== 1)
    throw new ClientError(
      "Oblast nebo její vydání není dostupné. Obnovte výběr nebo jej zrušte.",
      409
    );
  const r = rows[0]!;
  return {
    ...ref,
    name: String(r.name),
    bbox: [Number(r.west), Number(r.south), Number(r.east), Number(r.north)]
  };
}
export function areaPredicate(
  area: AreaSelection | null | undefined,
  geometry: SQL,
  points = false
): SQL | undefined {
  if (!area) return undefined;
  const shape = areaGeometry(area);
  return points
    ? sql`${geometry} && ${shape} AND ST_Covers(${shape},${geometry})`
    : sql`${geometry} && ${shape} AND ST_Intersects(${shape},${geometry})`;
}
/** External providers remain partial when their upstream response was bounded. Filter before
 * the public response pager; local SQL providers additionally filter before their SQL limit. */
export async function filterAreaFeatures(
  data: FeatureCollection,
  area: AreaSelection
): Promise<FeatureCollection> {
  if (!data.features.length) return data;
  const rows = await db.execute(sql`WITH features AS (
    SELECT ordinality, ST_SetSRID(ST_GeomFromGeoJSON((feature->'geometry')::text),4326) geom
    FROM jsonb_array_elements(${JSON.stringify(data.features)}::jsonb) WITH ORDINALITY AS f(feature,ordinality)
  ) SELECT ordinality FROM features WHERE ${areaPredicate(area, sql`geom`)} ORDER BY ordinality`);
  const indices = new Set(Array.from(rows).map((r) => Number(r.ordinality) - 1));
  return { ...data, features: data.features.filter((_, index) => indices.has(index)) };
}

export async function selectedAreaGeometry(area: AreaSelection) {
  const tolerance = Math.max(area.bbox[2] - area.bbox[0], area.bbox[3] - area.bbox[1]) / 4096;
  const rows = await db.execute(
    sql`SELECT ST_AsGeoJSON(ST_SimplifyPreserveTopology(${areaGeometry(area)},${tolerance}),6) AS geometry`
  );
  const encoded = String(rows[0]?.geometry ?? "null");
  if (Buffer.byteLength(encoded) > 1024 * 1024)
    throw new ClientError("Obrys oblasti je příliš podrobný pro přehled", 413);
  return JSON.parse(encoded);
}
