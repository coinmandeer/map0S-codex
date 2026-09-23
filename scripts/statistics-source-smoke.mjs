// Run with node --import tsx scripts/statistics-source-smoke.mjs
import { fetchStatDataset } from "../apps/api/src/themes/statSeriesImport.ts";
import { STAT_DATASETS, parseStatDataset } from "../packages/adapter-sdk/dist/index.js";
import { mkdir, writeFile } from "node:fs/promises";
const report = [];
await mkdir("output/statistics", { recursive: true });
for (const d of STAT_DATASETS) {
  try {
    const url = new URL(d.endpoint);
    if (d.providerId === "eurostat") {
      url.searchParams.set("sinceTimePeriod", "2020");
    }
    const payload = await fetchStatDataset({ ...d, endpoint: url.toString() });
    const parsed = parseStatDataset(d, payload);
    const measured = parsed.observations.filter((r) => r.value !== null);
    if (!measured.length) throw Error("No measured observations");
    await writeFile(`output/statistics/${d.id}.json`, JSON.stringify(payload));
    report.push({
      id: d.id,
      provider: d.providerId,
      theme: d.themeId ?? d.id,
      observations: measured.length,
      territories: new Set(measured.map((r) => r.geoCode)).size,
      periods: parsed.periods,
      status: "ready",
      source: d.documentationUrl
    });
    console.log(`${d.id}: ${measured.length}`);
  } catch (e) {
    report.push({ id: d.id, status: "failed", error: e.message });
    console.log(`${d.id}: ${e.message}`);
  }
  await writeFile(
    "output/statistics/source-report.json",
    JSON.stringify({ checkedAt: new Date().toISOString(), datasets: report }, null, 2)
  );
}
