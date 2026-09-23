/** Run against the built API modules; capabilities use the same guarded IO as the URL wizard.
 * Public NASA endpoint documented at https://nasa-gibs.github.io/gibs-api-docs/access-basics/ */
import assert from "node:assert/strict";
const root = process.env.MAPOS_DRILL_MODULE_ROOT ?? "/app/apps/api/dist";
const { probeSource, describeSource } = await import(`${root}/services/sourceService.js`);
const endpoint = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml";
const { probe } = await probeSource(endpoint);
const id = "MODIS_Terra_CorrectedReflectance_TrueColor";
assert.equal(probe.sublayers.find((s) => s.id === id)?.selectable, true);
const manifest = describeSource({ probe, sublayerIds: [id], layerId: "nasa-smoke" });
// Fixed trusted origin, never fetch an arbitrary probe-supplied URL outside the guarded client.
const tileUrl = manifest.source.tileTemplate
  .replace("{z}", "2")
  .replace("{x}", "2")
  .replace("{y}", "1");
assert.equal(new URL(tileUrl).origin, "https://gibs.earthdata.nasa.gov");
const response = await fetch(tileUrl, { signal: AbortSignal.timeout(20000) });
assert.equal(response.status, 200);
assert.match(response.headers.get("content-type") ?? "", /^image\/jpeg/);
const bytes = new Uint8Array(await response.arrayBuffer());
assert.equal(bytes[0], 255);
assert.equal(bytes[1], 216);
console.log(
  JSON.stringify({
    checkedAt: new Date().toISOString(),
    verified: true,
    guardedProbe: true,
    endpoint,
    selected: id,
    available: probe.sublayers.filter((s) => s.selectable).length,
    total: probe.sublayers.length,
    probeBytes: Buffer.byteLength(JSON.stringify(probe)),
    tileUrl,
    tileBytes: bytes.length,
    manifest
  })
);
