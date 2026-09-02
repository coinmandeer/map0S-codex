import {
  featureQueryResult,
  featureV1ToV2,
  type Bbox,
  type FeatureQueryResultV2,
  type GeoFeature
} from "@mapos/layer-sdk";
import { point, withinBbox } from "./types.js";

export const EARTHQUAKE_FIXTURE_RETRIEVED_AT = "2026-09-01T08:00:00.000Z";

/** Deterministic offline provider used by the memory server and v2 contract tests. */
export function earthquakeFixtureFeatures(count = 120): GeoFeature[] {
  return Array.from({ length: count }, (_, index) => {
    const magnitude = 1 + (index % 61) / 10;
    return point(
      `usgs:fixture-${String(index + 1).padStart(3, "0")}`,
      `M${magnitude.toFixed(1)} — testovací otřes ${index + 1}`,
      14.35 + (index % 12) * 0.01,
      50.03 + Math.floor(index / 12) * 0.01,
      "earthquakes",
      {
        category: "earthquake",
        magnitude,
        depthKm: 2 + (index % 20),
        occurredAt: `2026-08-${String(31 - (index % 28)).padStart(2, "0")}T08:00:00.000Z`,
        website: `https://earthquake.usgs.gov/earthquakes/eventpage/fixture-${index + 1}`
      }
    );
  });
}

export function earthquakeFixtureResult(
  bbox: Bbox,
  query: Record<string, string | undefined>
): FeatureQueryResultV2 {
  const minMagnitude = Number(query.minMagnitude) || 0;
  const matching = earthquakeFixtureFeatures().filter((feature) => {
    const [lng, lat] = feature.geometry.coordinates;
    return withinBbox(bbox, lng, lat) && Number(feature.properties.magnitude) >= minMagnitude;
  });
  return featureQueryResult({
    features: matching.map((feature) =>
      featureV1ToV2(feature, {
        providerId: "usgs",
        attribution: "USGS Earthquake Hazards Program (offline fixture)",
        retrievedAt: EARTHQUAKE_FIXTURE_RETRIEVED_AT,
        license: "public domain",
        rights: "open",
        confidence: 1,
        kind: "event"
      })
    ),
    availableCount: matching.length,
    requestedLimit: query.limit,
    sources: [{ providerId: "usgs", state: "ready" }]
  });
}
