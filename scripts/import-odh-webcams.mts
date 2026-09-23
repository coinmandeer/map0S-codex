import { mkdir, writeFile, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fetchJson } from "../apps/api/src/utils/upstream.js";
import { mapOdhWebcams } from "../apps/api/src/services/dataSources/odhWebcams.js";
const items = [];
let total: number | undefined;
const hash = createHash("sha256");
for (let page = 1; page <= 20; page++) {
  const params = new URLSearchParams({
    pagesize: "500",
    pagenumber: String(page),
    active: "true",
    rawsort: "Id",
    fields: "Id,Shortname,Webcamname,GpsInfo,Webcamurl,LicenseInfo,Source,LastChange,Active"
  });
  const data = await fetchJson<{ TotalResults: number; TotalPages: number; Items: unknown[] }>(
    `https://tourism.api.opendatahub.com/v1/WebcamInfo?${params}`,
    {
      providerId: "odh-webcams-import",
      timeoutMs: 20000,
      maxResponseBytes: 4 * 1024 * 1024,
      retries: 0
    }
  );
  if (
    !Array.isArray(data.Items) ||
    data.TotalPages > 20 ||
    data.TotalResults > 10000 ||
    !Number.isInteger(data.TotalResults)
  )
    throw new Error("Invalid catalogue envelope");
  if (total !== undefined && total !== data.TotalResults)
    throw new Error("Catalogue changed during import; retry later");
  total = data.TotalResults;
  hash.update(JSON.stringify(data.Items));
  items.push(...data.Items);
  if (page >= data.TotalPages) break;
}
if (items.length !== total) throw new Error("Incomplete catalogue");
const mapped = mapOdhWebcams(items as Parameters<typeof mapOdhWebcams>[0]);
const features = [...new Map(mapped.features.map((f) => [f.properties.id, f])).values()];
if (!features.length) throw new Error("No explicitly open cameras in edition");
const sourceSha256 = hash.digest("hex");
const editionHash = createHash("sha256")
  .update(sourceSha256)
  .update(JSON.stringify(features))
  .digest("hex");
const payload = {
  revision: `odh-${editionHash.slice(0, 16)}`,
  builtAt: new Date().toISOString(),
  source: "https://tourism.api.opendatahub.com/v1/WebcamInfo",
  sourceSha256,
  sourceRecords: items.length,
  unverifiedLicense: mapped.unverifiedLicense,
  invalid: mapped.invalid,
  license: "Per feature metadataLicense; linked imagery excluded",
  features
};
const dir = new URL("../apps/api/data/", import.meta.url);
await mkdir(dir, { recursive: true });
const tmp = new URL("odh-webcams-catalog.json.tmp", dir);
await writeFile(tmp, JSON.stringify(payload));
await rename(tmp, new URL("odh-webcams-catalog.json", dir));
console.log(
  JSON.stringify({
    sourceRecords: items.length,
    cameras: features.length,
    unverifiedLicense: mapped.unverifiedLicense,
    invalid: mapped.invalid,
    revision: payload.revision
  })
);
