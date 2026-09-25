import { STAT_DATASETS } from "@mapos/adapter-sdk";
import { sql } from "../db/index.js";
import { themeGroup, THEMES } from "./themeRegistry.js";

export async function statisticsReport() {
  const runs = await sql`SELECT * FROM stat_import_runs ORDER BY dataset_id`;
  const measured =
    await sql`SELECT dataset_id,COUNT(value)::integer AS values,COUNT(DISTINCT geo_code) FILTER(WHERE value IS NOT NULL)::integer AS territories,
   MIN(period) FILTER(WHERE value IS NOT NULL) AS first,MAX(period) FILTER(WHERE value IS NOT NULL) AS last FROM stat_series GROUP BY dataset_id`;
  const unmatched =
    await sql`SELECT DISTINCT s.dataset_id,s.geo_level,s.geo_code,s.boundary_edition FROM stat_series s
  LEFT JOIN geo_units g ON g.level=s.geo_level AND g.code=s.geo_code AND (s.boundary_edition IS NULL OR s.boundary_edition=g.edition)
  WHERE g.code IS NULL ORDER BY s.dataset_id,s.geo_code`;
  const datasets = STAT_DATASETS.map((d) => ({
    ...d,
    publication: runs.find((r) => r.dataset_id === d.id) ?? null,
    coverage: measured.find((r) => r.dataset_id === d.id) ?? null,
    unmappedCodes: unmatched.filter((r) => r.dataset_id === d.id).map((r) => r.geo_code)
  }));
  const available = THEMES.filter((t) =>
    t.sources.some((s) =>
      datasets.some((d) => d.id === s.datasetId && Number(d.coverage?.values) > 0)
    )
  );
  return {
    generatedAt: new Date().toISOString(),
    indicators: available.length,
    categories: [...new Set(available.map((t) => themeGroup(t.id)))],
    providers: [
      ...new Set(datasets.filter((d) => Number(d.coverage?.values) > 0).map((d) => d.providerId))
    ],
    geometryProfile: process.env.MAPOS_ALLOW_NONCOMMERCIAL_DATA === "1" ? "noncommercial" : "open",
    datasets
  };
}
if (process.argv[1]?.endsWith("statisticsReport.ts")) {
  try {
    console.log(JSON.stringify(await statisticsReport(), null, 2));
  } finally {
    await sql.end();
  }
}
