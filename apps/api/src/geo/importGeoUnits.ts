/**
 * `npm run geo:units -w @mapos/api -- [source-id …]`
 *
 * Run once per boundary edition, not on a schedule. With no arguments it imports the everyday
 * catalogue; with ids it imports only those, which is how a single NUTS level gets refreshed
 * without re-downloading Europe — and how the optional municipality set is asked for, since it
 * is a hundred-odd megabytes and nobody should get it by typing nothing.
 */

import { defaultGeoUnitSourceIds, GEO_UNIT_SOURCES } from "./geoUnitSources.js";
import { importAllGeoUnits } from "./geoUnitsImport.js";
import { safeErrorLogFields } from "../utils/clientError.js";
import { publishGeoUnitRelease } from "./geoUnitReleases.js";
import { analyzeTables } from "../db/analyze.js";

const GEO_UNIT_TABLES = ["geo_units", "geo_unit_versions", "geo_unit_releases"];

if (process.argv[2] === "--publish-release") {
  const id = process.argv[3];
  if (!id || !/^[a-f0-9-]{36}$/i.test(id)) throw new Error("A boundary release UUID is required");
  await publishGeoUnitRelease(id);
  console.log(`Zveřejněno vydání hranic ${id}`);
  await analyzeTables(GEO_UNIT_TABLES);
  process.exit(0);
}

const requested = process.argv.slice(2).filter((argument) => !argument.startsWith("-"));
const unknown = requested.filter((id) => !GEO_UNIT_SOURCES.some((source) => source.id === id));

if (unknown.length) {
  console.error(`Neznámý zdroj: ${unknown.join(", ")}`);
  console.error(`Dostupné: ${GEO_UNIT_SOURCES.map((source) => source.id).join(", ")}`);
  process.exit(1);
}

const ids = requested.length ? requested : defaultGeoUnitSourceIds();
console.log(`Importuji území: ${ids.join(", ")}`);

try {
  for (const result of await importAllGeoUnits(ids)) {
    console.log(
      `${result.sourceId}: ${result.written} uloženo, ${result.skipped} přeskočeno` +
        (result.duplicates ? `, ${result.duplicates} duplicitních kódů` : "")
    );
  }
  await analyzeTables(GEO_UNIT_TABLES);
  process.exit(0);
} catch (error) {
  console.error("Import území se nepodařil", safeErrorLogFields(error));
  process.exit(1);
}
