import { selectDataset } from "./selectDataset.js";
import { sql } from "../db/index.js";
import { theme, THEMES } from "./themeRegistry.js";
import { statDataset } from "@mapos/adapter-sdk";
import { databaseQueries } from "./themeService.js";
import { createHash } from "node:crypto";

type Coverage = {
  available: boolean;
  coverageStatus: "none" | "partial" | "full" | "unknown";
  geoLevels: string[];
};
const catalogueCache = new Map<string, { until: number; value: Record<string, Coverage> }>();
/** One compact request for the drawer. No geometry or individual observations reach the client.
 * Coverage counts matching land territories, so coastlines don't turn complete data yellow. */
export async function catalogCoverage(bbox: [number, number, number, number] | null, zoom = 0) {
  const key = JSON.stringify([bbox, Math.floor(zoom), process.env.MAPOS_ALLOW_NONCOMMERCIAL_DATA]);
  const cached = catalogueCache.get(key);
  if (cached && cached.until > Date.now()) return cached.value;
  const [w, s, e, n] = bbox ?? [-180, -85, 180, 85];
  const rows = await sql`WITH geography AS MATERIALIZED (
    SELECT level,code,edition FROM geo_units g
    WHERE (${process.env.MAPOS_ALLOW_NONCOMMERCIAL_DATA === "1"} OR g.source_id='natural-earth' OR (g.source_id='gisco-nuts' AND g.edition='2024' AND g.level IN ('nuts1','nuts2','nuts3'))
      OR (g.level='lau' AND g.edition LIKE '2024:%' AND g.source_id LIKE 'gisco-lau-%'))
    AND (${bbox === null} OR (g.geom && ST_MakeEnvelope(${w},${s},${e},${n},4326)
    AND ST_Intersects(g.geom,ST_MakeEnvelope(${w},${s},${e},${n},4326))))
  ), totals AS (SELECT level,COUNT(*) AS total FROM geography GROUP BY level)
  SELECT ss.dataset_id,ss.geo_level,COUNT(DISTINCT ss.geo_code)::integer AS matched,MAX(t.total)::integer AS total
  FROM stat_series ss JOIN geography g ON g.level=ss.geo_level AND g.code=ss.geo_code
    AND (ss.boundary_edition IS NULL OR ss.boundary_edition=g.edition)
  JOIN totals t ON t.level=ss.geo_level WHERE ss.value IS NOT NULL
  GROUP BY ss.dataset_id,ss.geo_level`;
  const available = await databaseQueries.available!([
    ...new Set(THEMES.flatMap((t) => t.sources.map((s) => s.datasetId)))
  ]);
  const result: Record<string, Coverage> = {};
  for (const entry of THEMES) {
    const sources = entry.sources.filter((s) => available.includes(s.datasetId));
    const selected = selectDataset(sources, (s) => statDataset(s.datasetId), zoom);
    const matches = rows.filter((r) => r.dataset_id === selected?.datasetId);
    // The dot is conservative: a complete country source does not hide gaps in finer data.
    result[entry.id] = {
      available: matches.length > 0,
      coverageStatus: !matches.length
        ? "none"
        : !bbox
          ? "unknown"
          : matches.every((r) => Number(r.matched) >= Number(r.total))
            ? "full"
            : "partial",
      geoLevels: [
        ...new Set(
          rows
            .filter((r) => sources.some((s) => s.datasetId === r.dataset_id))
            .map((r) => String(r.geo_level))
        )
      ]
    };
  }
  if (catalogueCache.size >= 64) catalogueCache.delete(catalogueCache.keys().next().value!);
  catalogueCache.set(key, { until: Date.now() + 60000, value: result });
  return result;
}

export async function explorerInventory(id: string, excluded: string[] = [], period = "latest") {
  const ids =
    theme(id)
      ?.sources.map((s) => s.datasetId)
      .filter((id) => !excluded.includes(id)) ?? [];
  const runs =
    await sql`SELECT dataset_id,revision,status,published_at,observations,territories,unmatched,error FROM stat_import_runs WHERE dataset_id=ANY(${ids})`;
  const extent =
    await sql`SELECT ST_XMin(ST_Extent(g.geom)) AS west,ST_YMin(ST_Extent(g.geom)) AS south,
   ST_XMax(ST_Extent(g.geom)) AS east,ST_YMax(ST_Extent(g.geom)) AS north,COUNT(DISTINCT(s.geo_level,s.geo_code))::integer AS n
   FROM stat_series s JOIN geo_units g ON g.level=s.geo_level AND g.code=s.geo_code
   WHERE s.dataset_id=ANY(${ids}) AND s.value IS NOT NULL AND (${period}='latest' OR s.period=${period})
     AND (s.boundary_edition IS NULL OR s.boundary_edition=g.edition)
     AND (${process.env.MAPOS_ALLOW_NONCOMMERCIAL_DATA === "1"} OR g.source_id='natural-earth' OR (g.source_id='gisco-nuts' AND g.edition='2024' AND g.level IN ('nuts1','nuts2','nuts3')) OR (g.level='lau' AND g.edition LIKE '2024:%' AND g.source_id LIKE 'gisco-lau-%'))`;
  const e = extent[0];
  return {
    revision: createHash("sha256").update(JSON.stringify(runs)).digest("hex"),
    observations: runs.reduce((sum, r) => sum + Number(r.observations), 0),
    ready: Number(e?.n) > 0,
    coverageBbox:
      e?.west != null ? [Number(e.west), Number(e.south), Number(e.east), Number(e.north)] : null,
    dataStatus: runs.length
      ? runs.every((r) => r.status === "failed")
        ? "stale"
        : "ready"
      : "not-imported",
    imports: runs,
    geometryProfile: process.env.MAPOS_ALLOW_NONCOMMERCIAL_DATA === "1" ? "noncommercial" : "open"
  };
}
export async function explorerRows(
  id: string,
  period: string,
  excluded: string[],
  offset: number,
  limit: number,
  datasetId?: string,
  bbox?: [number, number, number, number]
) {
  const sources = (theme(id)?.sources ?? []).filter((s) => !excluded.includes(s.datasetId));
  // Use one resolution in a comparison table; combining parent and child rows would double count.
  const datasets = sources.map((s) => statDataset(s.datasetId)).filter((d) => d !== undefined);
  const selected = datasets.find((d) => d.id === datasetId) ?? selectDataset(datasets, (d) => d);
  if (!selected) return { rows: [], total: 0 };
  const [w, s, e, n] = bbox ?? [-180, -85, 180, 85];
  const rows = await sql`WITH chosen AS (
   SELECT DISTINCT ON (geo_code) geo_code,geo_level,period,value,flag,boundary_edition FROM stat_series
   WHERE dataset_id=${selected.id} AND ((${period}='latest' AND value IS NOT NULL) OR period=${period}) ORDER BY geo_code,period DESC
 ) SELECT s.geo_code AS code,s.geo_level AS level,COALESCE(g.name,s.geo_code) AS name,
   s.period,s.value,s.flag,${selected.name}::text AS source,${selected.documentationUrl}::text AS "sourceUrl",
   ${selected.unit}::text AS unit,COUNT(*) OVER()::integer AS total
   FROM chosen s JOIN geo_units g ON g.level=s.geo_level AND g.code=s.geo_code
     AND (s.boundary_edition IS NULL OR s.boundary_edition=g.edition)
   WHERE (${!bbox} OR (g.geom && ST_MakeEnvelope(${w},${s},${e},${n},4326)
     AND ST_Intersects(g.geom,ST_MakeEnvelope(${w},${s},${e},${n},4326))))
   ORDER BY s.value DESC NULLS LAST,s.geo_code LIMIT ${limit} OFFSET ${offset}`;
  return { rows: rows.map(({ total: _total, ...row }) => row), total: Number(rows[0]?.total ?? 0) };
}
