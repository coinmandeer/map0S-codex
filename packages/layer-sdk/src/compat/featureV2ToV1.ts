import type { GeoFeature } from "../types.js";
import { assertMapOSFeatureV2 } from "../v2/validation.js";
import type { MapOSFeatureV2 } from "../v2/feature.js";

/** Narrows a validated v2 point for the current MapLibre point renderer during migration. */
export function featureV2ToV1(value: MapOSFeatureV2 | unknown): GeoFeature {
  assertMapOSFeatureV2(value);
  if (value.geometry.type !== "Point") {
    throw new TypeError(`Legacy renderer cannot display ${value.geometry.type} geometry.`);
  }
  const providerFields = Object.assign({}, ...Object.values(value.properties.providerFields ?? {}));
  const sourceUrl = value.properties.urls?.find((entry) => entry.kind === "source")?.url;
  return {
    type: "Feature",
    geometry: value.geometry,
    properties: {
      id: value.id,
      name: value.properties.title,
      category: value.properties.category,
      layerId: value.properties.layerIds[0]!,
      ...providerFields,
      ...(value.properties.temporal?.startsAt
        ? { occurredAt: value.properties.temporal.startsAt }
        : {}),
      ...(sourceUrl ? { website: sourceUrl } : {})
    }
  };
}
