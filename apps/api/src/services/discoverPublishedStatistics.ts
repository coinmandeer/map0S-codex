import { STAT_DATASETS, statDataset } from "@mapos/adapter-sdk";
import type { AreaSelection } from "@mapos/layer-sdk";
import { sql } from "../db/index.js";
import type { DiscoverStatistic } from "./discoverService.js";

export function discoverStatisticsFromRows(
  rows: readonly Record<string, unknown>[]
): DiscoverStatistic[] {
  const chosen = new Map<string, { rank: number; statistic: DiscoverStatistic }>();
  for (const row of rows) {
    const d = statDataset(String(row.dataset_id)),
      value = Number(row.value);
    if (!d || row.value == null || !Number.isFinite(value)) continue;
    const same = row.same_entity === true;
    const rank =
      (same ? 100 : 0) +
      ((
        { lau: 6, nuts3: 5, nuts2: 4, adm1: 3, nuts1: 2, country: 1, nuts0: 1 } as Record<
          string,
          number
        >
      )[String(row.geo_level)] ?? 0);
    const key = d.themeId ?? d.id.replace(/-country$/, "");
    const statistic: DiscoverStatistic = {
      id: `published:${d.id}`,
      label:
        d.nameCs ??
        (
          {
            "eurostat-demo-r-pjanaggr3": "Populace",
            "worldbank-sp-pop-totl": "Populace"
          } as Record<string, string>
        )[d.id] ??
        d.name,
      value,
      unit: d.unit,
      scope: {
        regionId: `${row.geo_level}:${row.geo_code}`,
        regionName: String(row.name),
        geographicCode: String(row.geo_code),
        level:
          row.geo_level === "country" || row.geo_level === "nuts0"
            ? "country"
            : row.geo_level === "lau"
              ? "locality"
              : "admin1"
      },
      year: /^\d{4}/.test(String(row.period)) ? Number(String(row.period).slice(0, 4)) : null,
      uncertainty: same ? "selected-area" : "regional-aggregate",
      uncertaintyLabel: `${same ? "Vybraná oblast" : "Údaj za širší statistickou oblast"}: ${row.name} · ${String(row.geo_level).toUpperCase()}${row.flag ? ` · poznámka zdroje: ${row.flag}` : ""}`,
      sourceIds: [`published:${d.id}`]
    };
    if (!chosen.has(key) || rank > chosen.get(key)!.rank) chosen.set(key, { rank, statistic });
  }
  return [...chosen.values()]
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 12)
    .map((e) => e.statistic);
}

/** Exact source code + edition for local values; ST_Covers of the WHOLE polygon for context.
 * A point or overlap alone never makes a neighbour's observation belong to the selected area. */
export async function publishedDiscoverStatistics(
  lng: number,
  lat: number,
  signal?: AbortSignal,
  area?: AreaSelection
): Promise<DiscoverStatistic[]> {
  signal?.throwIfAborted();
  const ids = STAT_DATASETS.filter((d) => d.commercialUse !== false).map((d) => d.id);
  const query = sql`WITH selected AS MATERIALIZED (
    SELECT v.geom,v.source_id,v.level,v.code,v.edition FROM geo_unit_versions v
      JOIN geo_boundary_manifests m ON v.release_id=ANY(m.release_ids)
      WHERE m.revision=${area?.revision ?? ""} AND v.source_id=${area?.source ?? ""}
      AND v.country=${area?.country ?? ""} AND v.level=${area?.level ?? ""} AND v.code=${area?.code ?? ""}
  ), related AS MATERIALIZED (
    SELECT c.target_source_id,c.target_level,c.target_code,c.target_edition FROM selected a
    JOIN geo_unit_correspondences c ON c.source_id=a.source_id AND c.source_level=a.level AND c.source_code=a.code AND c.source_edition=a.edition
    WHERE c.relation='part_of'
  ), geography AS MATERIALIZED (
    SELECT g.source_id,g.level,g.code,g.edition,g.name, ${Boolean(area)} AND EXISTS(SELECT 1 FROM selected a WHERE a.source_id=g.source_id AND a.level=g.level AND a.code=g.code AND a.edition=g.edition) AS same_entity
    FROM geo_units g WHERE
      g.geom && COALESCE((SELECT geom FROM selected),ST_SetSRID(ST_Point(${lng},${lat}),4326))
      AND (${process.env.MAPOS_ALLOW_NONCOMMERCIAL_DATA === "1"} OR g.source_id='natural-earth'
        OR (g.source_id='gisco-nuts' AND g.edition='2024') OR (g.level='lau' AND g.source_id LIKE 'gisco-lau-%' AND g.edition LIKE '2024:%'))
      AND (CASE WHEN ${Boolean(area)} THEN EXISTS(SELECT 1 FROM selected a WHERE
        (a.source_id=g.source_id AND a.level=g.level AND a.code=g.code AND a.edition=g.edition)
        OR (g.level IN ('country','nuts1','nuts2','nuts3') AND g.geom && a.geom AND ST_Covers(g.geom,a.geom)))
      ELSE ST_Covers(g.geom,ST_SetSRID(ST_Point(${lng},${lat}),4326)) END)
    UNION
    SELECT g.source_id,g.level,g.code,g.edition,g.name,FALSE AS same_entity
    FROM related c JOIN geo_units g ON g.source_id=c.target_source_id AND g.level=c.target_level AND g.code=c.target_code AND g.edition=c.target_edition
    WHERE (g.source_id='gisco-nuts' AND g.edition='2024') OR ${process.env.MAPOS_ALLOW_NONCOMMERCIAL_DATA === "1"}
  ) SELECT DISTINCT ON(s.dataset_id) s.dataset_id,s.geo_code,s.geo_level,s.period,s.value,s.flag,g.name,g.same_entity
    FROM geography g JOIN stat_series s ON s.geo_level=g.level AND s.geo_code=g.code
    WHERE s.dataset_id=ANY(${ids}) AND s.value IS NOT NULL
      AND (s.boundary_edition IS NULL OR s.boundary_edition=g.edition)
    ORDER BY s.dataset_id,s.period DESC,g.same_entity DESC,g.edition DESC`;
  const cancel = () => void query.cancel();
  signal?.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(cancel, 2500);
  try {
    const rows = await query;
    signal?.throwIfAborted();
    return discoverStatisticsFromRows(rows);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", cancel);
  }
}
