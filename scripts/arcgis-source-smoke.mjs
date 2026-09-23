import assert from "node:assert/strict";
const root = process.env.MAPOS_DRILL_MODULE_ROOT ?? "/app/apps/api/dist";
const { probeSource, describeSource, upstreamAdapterIo } = await import(
  `${root}/services/sourceService.js`
);
const { querySourceFeatures } = await import(`${root}/services/sourceFeatures.js`);
const endpoint =
  "https://sampleserver6.arcgisonline.com/arcgis/rest/services/Wildfire/FeatureServer";
const { probe } = await probeSource(endpoint);
const manifest = describeSource({ probe, sublayerIds: ["0"], layerId: "arcgis-smoke" });
// The provider's editable sample may move. Discover one point, then query only its local viewport.
const sample = await upstreamAdapterIo.json(
  `${endpoint}/0/query?where=1%3D1&outFields=OBJECTID&returnGeometry=true&outSR=4326&resultRecordCount=1&f=json`,
  { timeoutMs: 15000 }
);
const point = sample.features?.find(
  (feature) => Number.isFinite(feature.geometry?.x) && Number.isFinite(feature.geometry?.y)
)?.geometry;
assert.ok(point, "The sample provider has no point to verify");
const bbox = [
  Math.max(-180, point.x - 0.1),
  Math.max(-90, point.y - 0.1),
  Math.min(180, point.x + 0.1),
  Math.min(90, point.y + 0.1)
];
const result = await querySourceFeatures(
  manifest,
  "arcgis-smoke",
  bbox,
  AbortSignal.timeout(20000)
);
assert.ok(result.features.length > 0 && result.features.length <= 4000);
assert.ok(result.features.every((feature) => feature.properties.layerId === "arcgis-smoke"));
console.log(
  JSON.stringify({
    checkedAt: new Date().toISOString(),
    verified: true,
    guardedTransport: true,
    endpoint,
    features: result.features.length,
    bytes: Buffer.byteLength(JSON.stringify(result)),
    query: result.query,
    sampleOnly: true,
    note: "Esri editable sample service, not a production wildfire dataset."
  })
);
