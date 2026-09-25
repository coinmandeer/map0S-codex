import type { AreaSelection, Bbox, FeatureCollection } from "@mapos/layer-sdk";
import { getOsmPoiFeatures } from "./layerService.js";

export type WeedType = "dispensary" | "shop" | "both" | "unknown";

const affirmative = (value: unknown) => value === "yes" || value === "only";

/** OSM identifies the kind of sale, not a universal legal licence or Weedmaps listing. */
export function classifyCannabisPlace(medical: unknown, recreational: unknown): WeedType {
  const med = affirmative(medical);
  const rec = affirmative(recreational);
  if (med && rec) return "both";
  if (med) return "dispensary";
  if (rec) return "shop";
  return "unknown";
}

export function parseWeedTypes(raw: string | undefined): Set<WeedType> {
  const valid: WeedType[] = ["dispensary", "shop", "both", "unknown"];
  if (raw === undefined) return new Set(valid);
  return new Set(
    raw.split(",").filter((value): value is WeedType => valid.includes(value as WeedType))
  );
}

export async function getWeedFeatures(
  bbox: Bbox,
  typesRaw: string | undefined,
  area?: AreaSelection | null
): Promise<FeatureCollection> {
  const types = parseWeedTypes(typesRaw);
  if (!types.size) return { type: "FeatureCollection", features: [] };
  // Reuse MapOS's worldwide, viewport-based OSM ingestion and its seven-day cell cache.
  const collection = await getOsmPoiFeatures(bbox, "cannabis", area);
  return presentWeedCollection(collection, types);
}

export function presentWeedCollection(
  collection: FeatureCollection,
  types: ReadonlySet<WeedType>
): FeatureCollection {
  return {
    ...collection,
    features: collection.features.flatMap((feature) => {
      const p = feature.properties;
      // Never relabel a feature from another provider (for example, a fire) as a weed shop.
      if (p.category !== "cannabis" || !/^osm:(node|way|relation):\d+$/.test(p.id)) return [];
      const type = classifyCannabisPlace(p.cannabisMedical, p.cannabisRecreational);
      if (!types.has(type)) return [];
      const typeLabel = {
        dispensary: "Léčebná výdejna",
        shop: "Rekreační prodejna",
        both: "Léčebná i rekreační prodejna",
        unknown: "Typ prodeje neuveden"
      }[type];
      return [
        {
          ...feature,
          properties: {
            ...p,
            layerId: "weed",
            category: `weed-${type}`,
            weedType: type,
            tags: [typeLabel],
            sourceRefs: `osm:${p.osmId}`
          }
        }
      ];
    })
  };
}
