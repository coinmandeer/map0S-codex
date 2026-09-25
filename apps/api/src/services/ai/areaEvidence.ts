import { overviewCategory, overviewUnit, evidenceKey } from "./overviewFormatting.js";
import { statDataset } from "@mapos/adapter-sdk";
import { publishedDiscoverStatistics } from "../discoverPublishedStatistics.js";
import { resolveAreaSelection } from "../../geo/areaSelection.js";
import type { EvidenceItem } from "@mapos/layer-sdk";
import { parseAreaReference } from "../../geo/areaSelection.js";
import { sql } from "../../db/index.js";
/** Count in the exact immutable polygon before limiting category groups. This is explicitly the
 * local index, whose completeness is unknown, not an invented total number of POIs in a town. */
export async function localAreaEvidence(
  areaId: string,
  boundaryRevision: string,
  signal: AbortSignal
): Promise<EvidenceItem[]> {
  const area = parseAreaReference({ areaId, boundaryRevision });
  if (!area) return [];
  signal.throwIfAborted();
  const query = sql`WITH area AS (SELECT v.geom FROM geo_unit_versions v JOIN geo_boundary_manifests m ON v.release_id=ANY(m.release_ids)
    WHERE m.revision=${area.revision} AND v.source_id=${area.source} AND v.country=${area.country} AND v.level=${area.level} AND v.code=${area.code}),
    inside AS (SELECT p.osm_id,p.category,p.fetched_at FROM osm_pois p CROSS JOIN area a
      WHERE p.geog && a.geom::geography
      AND ST_Covers(a.geom, ST_SetSRID(ST_MakePoint(p.lng,p.lat),4326)))
    SELECT category, COUNT(DISTINCT osm_id)::int AS count, MIN(fetched_at) AS oldest, MAX(fetched_at) AS newest
    FROM inside GROUP BY category ORDER BY count DESC, category LIMIT 8`;
  const cancel = () => void query.cancel();
  const timer = setTimeout(cancel, 2500);
  signal.addEventListener("abort", cancel, { once: true });
  let rows;
  try {
    rows = await query;
    signal.throwIfAborted();
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
  }
  return rows.map((row) => ({
    id: evidenceKey("area-index", [areaId, boundaryRevision, row.category]),
    sourceRecordId: `${areaId}:${boundaryRevision}`,
    providerId: "mapos-osm-index",
    label: "Lokální index OpenStreetMap",
    url: "https://www.openstreetmap.org/copyright",
    relation: "within_area",
    topic: "local-index",
    kind: "fact",
    text: `${overviewCategory(row.category)}: ${row.count} různých míst uvnitř přesné hranice v lokálním indexu. Pokrytí indexu není úplné; nejde o celkový počet v oblasti.`,
    retrievedAt: new Date().toISOString(),
    cacheUntil: new Date(Date.now() + 3600000).toISOString(),
    originGroup: "osm",
    access: "public"
  }));
}

/** Named highlights from the same public local index, spatially filtered before LIMIT. */
export async function localAreaPlaces(
  areaId: string,
  boundaryRevision: string,
  signal?: AbortSignal
) {
  const area = parseAreaReference({ areaId, boundaryRevision });
  if (!area) return [];
  signal?.throwIfAborted();
  const query = sql`WITH area AS (SELECT v.geom FROM geo_unit_versions v JOIN geo_boundary_manifests m ON v.release_id=ANY(m.release_ids)
    WHERE m.revision=${area.revision} AND v.source_id=${area.source} AND v.country=${area.country} AND v.level=${area.level} AND v.code=${area.code})
    SELECT DISTINCT ON (p.osm_id) p.id,p.osm_id,p.name,p.category,p.lng,p.lat FROM osm_pois p CROSS JOIN area a
    WHERE p.name IS NOT NULL AND length(trim(p.name))>0 AND p.geog && a.geom::geography
    AND ST_Covers(a.geom,p.geog::geometry)
    AND p.category IN ('castle','museum','monument','viewpoint','attraction','heritage','nature_reserve','gallery','ruins','cave')
    ORDER BY p.osm_id LIMIT 32`;
  const cancel = () => void query.cancel();
  const timer = setTimeout(cancel, 2500);
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    const rows = await query;
    signal?.throwIfAborted();
    return rows.map((r) => ({
      id: String(r.id),
      title: String(r.name),
      category: String(r.category),
      longitude: Number(r.lng),
      latitude: Number(r.lat)
    }));
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}

export async function areaStatisticsEvidence(
  areaId: string,
  boundaryRevision: string,
  signal: AbortSignal
): Promise<EvidenceItem[]> {
  const area = await resolveAreaSelection({ areaId, boundaryRevision });
  if (!area) return [];
  const statistics = await publishedDiscoverStatistics(0, 0, signal, area);
  return statistics.map((stat) => {
    const descriptor = statDataset(stat.id.slice(10))!;
    return {
      id: evidenceKey("area-stat", [
        areaId,
        boundaryRevision,
        stat.id,
        stat.year,
        stat.scope.geographicCode
      ]),
      sourceRecordId: `${descriptor.id}:${stat.scope.geographicCode}:${stat.year}`,
      providerId: descriptor.providerId,
      label: stat.label,
      url: descriptor.documentationUrl,
      relation: stat.uncertainty === "selected-area" ? "same_entity" : "part_of",
      topic: "statistics",
      kind: "fact",
      statistic: {
        datasetId: descriptor.id,
        geoCode: stat.scope.geographicCode ?? "",
        geoLevel: descriptor.geoLevel,
        period: String(stat.year ?? ""),
        value: stat.value,
        unit: stat.unit
      },
      text: `${stat.label}: ${stat.value.toLocaleString("cs-CZ", { maximumFractionDigits: 2 })} ${overviewUnit(stat.unit)}${stat.year ? ` (${stat.year})` : ""}. ${stat.uncertaintyLabel}.`,
      retrievedAt: new Date().toISOString(),
      cacheUntil: new Date(Date.now() + 3600000).toISOString(),
      originGroup: descriptor.id,
      access: "public"
    } satisfies EvidenceItem;
  });
}
