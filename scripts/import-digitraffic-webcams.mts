import { writeFile, rename, mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { mapDigitrafficWebcams } from "../apps/api/src/services/dataSources/digitrafficWebcams.js";
const source = "https://tie.digitraffic.fi/api/weathercam/v1/stations";
// Download this exact official endpoint with curl --compressed and pass the local JSON file.
const input = process.argv[2];
if (!input) throw new Error("Expected local Digitraffic station JSON");
const bytes = await readFile(input);
if (bytes.length > 4 * 1024 * 1024) throw new Error("Catalogue too large");
const raw = JSON.parse(bytes.toString()) as { features: unknown[] };
if (!Array.isArray(raw.features) || raw.features.length > 5000)
  throw new Error("Invalid station catalogue");
const features = mapDigitrafficWebcams(raw.features as Parameters<typeof mapDigitrafficWebcams>[0]);
if (!features.length) throw new Error("No collecting camera stations");
const hash = createHash("sha256").update(JSON.stringify(raw)).digest("hex");
const editionHash = createHash("sha256")
  .update(hash)
  .update(JSON.stringify(features))
  .digest("hex");
const payload = {
  revision: `digitraffic-${editionHash.slice(0, 16)}`,
  builtAt: new Date().toISOString(),
  source,
  sourceSha256: hash,
  license: "CC-BY-4.0",
  sourceRecords: raw.features.length,
  features
};
const dir = new URL("../apps/api/data/", import.meta.url);
await mkdir(dir, { recursive: true });
const tmp = new URL("digitraffic-webcams-catalog.json.tmp", dir);
await writeFile(tmp, JSON.stringify(payload));
await rename(tmp, new URL("digitraffic-webcams-catalog.json", dir));
console.log(
  JSON.stringify({
    stations: raw.features.length,
    cameras: features.length,
    revision: payload.revision
  })
);
