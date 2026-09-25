// Run with node --import tsx scripts/wms-time-source-smoke.mjs.
import { writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { wmsAdapter } from "../packages/adapter-sdk/src/wms/wmsAdapter.ts";
import { upstreamAdapterIo } from "../apps/api/src/services/sourceService.ts";
import { fetchBytes } from "../apps/api/src/utils/upstream.ts";

const probe = await wmsAdapter.probe(
  new URL(
    "https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi?service=WMS&request=GetCapabilities"
  ),
  upstreamAdapterIo
);
const layer = probe.sublayers.find(
  (item) => item.id === "MODIS_Terra_CorrectedReflectance_TrueColor"
);
if (!layer) throw new Error("GIBS verification layer is unavailable");
const manifest = wmsAdapter.describe({
  probe,
  layerId: "gibs-time-smoke",
  sublayerIds: [layer.id]
});
const facet = manifest.filters?.find((item) => item.id === "wmsTime");
const dates = facet?.options?.slice(-5, -3).map((option) => option.id);
if (dates?.length !== 2) throw new Error("Two advertised time samples are required");
const tiles = [];
for (const date of dates) {
  const url = new URL(
    manifest.source.tileTemplate.replace("{bbox-epsg-3857}", "1565430,6418267,1721973,6574810")
  );
  url.searchParams.set("time", date);
  const started = performance.now();
  const response = await fetchBytes(url.href, {
    providerId: "wms-time-tile-smoke",
    acceptedContentTypes: ["image/png"],
    maxResponseBytes: 1024 * 1024,
    timeoutMs: 20000
  });
  const bytes = Buffer.from(response.body);
  if (bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a")
    throw new Error("Expected PNG tile");
  tiles.push({
    date,
    bytes: bytes.length,
    ms: Math.round(performance.now() - started),
    sha256: createHash("sha256").update(bytes).digest("hex")
  });
}
mkdirSync("output/performance", { recursive: true });
writeFileSync(
  "output/performance/wms-time-gibs-smoke.json",
  JSON.stringify(
    {
      endpoint: probe.endpoint,
      layer: layer.id,
      time: layer.time,
      filter: { count: facet.options.length, default: facet.default },
      tiles
    },
    null,
    2
  )
);
console.log(JSON.stringify({ layer: layer.id, tiles }));
