import { writeFileSync } from "node:fs";
import { placesToFeatureCollection } from "../apps/api/src/services/placesPresentation.ts";
const places = Array.from({ length: 500 }, (_, i) => ({
  id: `mapy:base:${i}`,
  name: `Místo ${i}`,
  lng: 14 + i / 10000,
  lat: 50,
  category: "viewpoint",
  address: `Ulice ${i}, 110 00 Praha, Česká republika`,
  sources: [
    { source: "mapy", sourceRef: `base:${i}`, confidence: 0.8, refreshedAt: "2026-09-05T00:00:00Z" }
  ]
}));
const after = placesToFeatureCollection({ places, meta: { sources: [], merged: 0 } });
// Same features and identity fields; restore only the address field omitted by this change.
const before = {
  ...after,
  features: after.features.map((feature, index) => ({
    ...feature,
    properties: { ...feature.properties, address: places[index].address }
  }))
};
const bytes = (value) => Buffer.byteLength(JSON.stringify(value));
const report = {
  kind: "deterministic Mapy-shaped fixture, not live-provider measurement",
  features: places.length,
  beforeBytes: bytes(before),
  afterBytes: bytes(after),
  savedBytes: bytes(before) - bytes(after),
  savedPercent: (1 - bytes(after) / bytes(before)) * 100
};
writeFileSync("output/performance/area-poi-summary.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report));
