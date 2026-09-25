/** Offline, bounded, one-country-at-a-time importer. Requires explicit target database. */
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
const database = process.env.MAPOS_LAU_DATABASE;
if (!database || !/^mapos_opt_stage_/.test(database))
  throw new Error("Use a dedicated staging database");
const url = new URL(process.env.DATABASE_URL);
url.pathname = `/${database}`;
process.env.DATABASE_URL = url.toString();
const root = process.env.MAPOS_LAU_MODULE_ROOT ?? "/app/apps/api/dist";
const { sql } = await import(`${root}/db/index.js`);
const { GEO_UNIT_SOURCES } = await import(`${root}/geo/geoUnitSources.js`);
const { createGeoUnitRelease, stageGeoUnitRows, publishGeoUnitRelease, failGeoUnitRelease } =
  await import(`${root}/geo/geoUnitReleases.js`);
const directory = resolve(process.argv[2]);
const manifest = JSON.parse(await readFile(resolve(directory, "manifest.json"), "utf8"));
const base = GEO_UNIT_SOURCES.find((s) => s.id === "gisco-lau");
try {
  for (const [country, expected] of Object.entries(manifest.countries)) {
    if (!/^[A-Z]{2}$/.test(country) || !Number.isInteger(expected.count) || expected.count < 1)
      throw new Error("Invalid country manifest");
    const file = resolve(directory, `${country}.jsonl`);
    if ((await stat(file)).size > 128 * 1024 * 1024)
      throw new Error("Country input exceeds 128 MiB");
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    if (hash.digest("hex") !== expected.sha256) throw new Error("Country checksum mismatch");
    const source = {
      ...base,
      id: `gisco-lau-${country.toLowerCase()}`,
      providerId: `gisco-lau-${country.toLowerCase()}`,
      edition: `2024:${expected.sha256}`,
      attribution: `© EuroGeographics, Eurostat GISCO LAU 2024; generalized 1:1,000,000; ${manifest.sourceSha256}`
    };
    const release = await createGeoUnitRelease(source);
    let count = 0,
      batch = [];
    const seen = new Set();
    try {
      for await (const line of createInterface({
        input: createReadStream(file),
        crlfDelay: Infinity
      })) {
        if (Buffer.byteLength(line) > 8 * 1024 * 1024)
          throw new Error("Feature exceeds import budget");
        const row = base.normalize(JSON.parse(line), source);
        if (!row) throw new Error("Invalid LAU feature");
        row.country = { EL: "GR", UK: "GB" }[row.country] ?? row.country;
        if (row.country !== country || seen.has(row.code))
          throw new Error("Country or identity mismatch");
        seen.add(row.code);
        count++;
        batch.push(row);
        if (batch.length === 200) {
          await stageGeoUnitRows(release, batch);
          batch = [];
        }
      }
      if (batch.length) await stageGeoUnitRows(release, batch);
      if (count !== expected.count) throw new Error("Incomplete country import");
      await publishGeoUnitRelease(release);
      console.log(JSON.stringify({ country, count, release, sha256: expected.sha256 }));
    } catch (error) {
      await failGeoUnitRelease(release);
      throw error;
    }
  }
} finally {
  await sql.end();
}
