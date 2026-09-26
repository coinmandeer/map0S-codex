/**
 * `npm run stats:import -w @mapos/api -- [dataset-id …]`
 *
 * Run after the boundaries are in place — a series whose codes have no territory imports fine
 * and draws nothing. With no arguments it refreshes the whole catalogue.
 */

import { STAT_DATASETS } from "@mapos/adapter-sdk";
import { importAllStatDatasets } from "./statSeriesImport.js";
import { safeErrorLogFields } from "../utils/clientError.js";
import { analyzeTables } from "../db/analyze.js";

const requested = process.argv.slice(2).filter((argument) => !argument.startsWith("-"));
const unknown = requested.filter((id) => !STAT_DATASETS.some((dataset) => dataset.id === id));

if (unknown.length) {
  console.error(`Neznámý dataset: ${unknown.join(", ")}`);
  console.error(`Dostupné: ${STAT_DATASETS.map((dataset) => dataset.id).join(", ")}`);
  process.exit(1);
}

const ids = requested.length ? requested : STAT_DATASETS.map((dataset) => dataset.id);
console.log(`Importuji statistiky: ${ids.join(", ")}`);

try {
  for (const result of await importAllStatDatasets(ids)) {
    if (result.error) {
      console.error("Import datasetu se nepodařil", {
        datasetId: result.datasetId,
        ...safeErrorLogFields(result.error)
      });
      process.exitCode = 1;
      continue;
    }
    const range = result.periods.length
      ? `${result.periods[0]}–${result.periods[result.periods.length - 1]}`
      : "bez období";
    console.log(`${result.datasetId}: ${result.written} hodnot, ${range}`);
  }
  await analyzeTables(["stat_series", "stat_datasets", "stat_import_runs", "theme_coverage"]);
  process.exit(process.exitCode ?? 0);
} catch (error) {
  console.error("Import statistik se nepodařil", safeErrorLogFields(error));
  process.exit(1);
}
