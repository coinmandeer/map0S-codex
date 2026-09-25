/** Offline preparation: GISCO GeoJSON, INE table 68065 (tip=AM), published LAU manifest, output.
 * The geometry stays in the boundary store. Runtime API limits remain unchanged. */
import { readFile, writeFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
const [giscoFile, ineFile, manifestFile, output] = process.argv.slice(2);
if (!output)
  throw Error("Usage: node scripts/prepare-municipal-statistics.mjs GISCO INE MANIFEST OUTPUT");
async function read(path, max) {
  if ((await stat(path)).size > max) throw Error("Source exceeds offline input budget");
  return readFile(path);
}
const raw = await read(giscoFile, 256 * 1024 * 1024);
const manifest = JSON.parse(await read(manifestFile, 1024 * 1024));
const sourceSha256 = createHash("sha256").update(raw).digest("hex");
if (sourceSha256 !== manifest.sourceSha256)
  throw Error("GISCO file does not match the published boundary manifest");
const gisco = JSON.parse(raw);
if (
  gisco.features.length !== Object.values(manifest.countries).reduce((sum, c) => sum + c.count, 0)
)
  throw Error("Incomplete GISCO input");
const ine = JSON.parse(await read(ineFile, 32 * 1024 * 1024));
const payload = {
  sourceSha256,
  ineSha256: createHash("sha256").update(JSON.stringify(ine)).digest("hex"),
  boundaryEditions: Object.fromEntries(
    Object.entries(manifest.countries).map(([c, v]) => [c, `2024:${v.sha256}`])
  ),
  gisco: { features: gisco.features.map(({ properties }) => ({ properties })) },
  ine
};
await writeFile(output, JSON.stringify(payload));
console.log(
  JSON.stringify({
    sourceSha256,
    features: gisco.features.length,
    ineSeries: ine.length,
    bytes: (await stat(output)).size
  })
);
