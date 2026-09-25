/** Run with node --import tsx scripts/import-webcams-catalog.mts RAW_JSON COMMIT_SHA.
 * Obtain raw.json from that exact WebcamMap revision; never download images or enrich addresses.
 */
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import { mapWebcams } from "../apps/api/src/services/dataSources/webcams.js";
const [input, revision] = process.argv.slice(2);
if (!input || !revision || !/^[a-f0-9]{40}$/.test(revision))
  throw new Error("Expected raw.json path and pinned commit");
const raw = await readFile(input);
if (raw.length > 10_000_000) throw new Error("Catalogue too large");
const records = JSON.parse(raw.toString());
if (!Array.isArray(records) || records.length > 20000) throw new Error("Invalid catalogue");
const features = [];
for (let i = 0; i < records.length; i += 300)
  features.push(...mapWebcams(records.slice(i, i + 300), [-180, -90, 180, 90]).features);
const unique = [...new Map(features.map((f) => [f.properties.id, f])).values()];
if (!unique.length) throw new Error("Refusing empty edition");
const payload = {
  revision,
  builtAt: new Date().toISOString(),
  source: "https://github.com/wvanderp/WebcamMap",
  sourceFile: `https://raw.githubusercontent.com/wvanderp/WebcamMap/${revision}/data/raw.json`,
  sourceSha256: createHash("sha256").update(raw).digest("hex"),
  license: "ODbL-1.0",
  attribution: "© OpenStreetMap contributors; catalogue supplied by CartoCams / WebcamMap",
  modifications:
    "Filtered explicit contact:webcam links; removed private/indoor entries, unsafe URLs and unrelated tags. Way/relation centers are approximate. Image rights not included.",
  features: unique
};
const dir = new URL("../apps/api/data/", import.meta.url);
await mkdir(dir, { recursive: true });
const path = new URL("webcams-catalog.json", dir),
  temp = new URL("webcams-catalog.json.tmp", dir);
await writeFile(temp, JSON.stringify(payload));
await rename(temp, path);
console.log(
  JSON.stringify({
    sourceRecords: records.length,
    cameras: unique.length,
    bytes: Buffer.byteLength(JSON.stringify(payload)),
    revision
  })
);
