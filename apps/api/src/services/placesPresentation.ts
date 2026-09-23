/** Adapts fused `Place` records to the GeoJSON the map layers already speak.
 *
 *  Keeping this translation in one place means the fusion service can evolve its own DTO
 *  without every pin layer, popup and list having to learn about provenance chains. */

import type { FeatureCollection, PlaceSourceId, PlacesResponse } from "@mapos/layer-sdk";
import { OSM_POI_CATEGORIES, PLACE_SOURCE_BY_ID, encodeSourceRefs } from "@mapos/layer-sdk";

/** GeoJSON properties must stay flat and JSON-scalar for MapLibre's feature-state and
 *  data-driven styling to work, so provenance is flattened into `sourceRefs` — which keeps each
 *  source's native id, not just its name, so a clicked pin can still be looked up upstream. */
export function placesToFeatureCollection(response: PlacesResponse): FeatureCollection & {
  meta: PlacesResponse["meta"];
} {
  return {
    type: "FeatureCollection",
    meta: response.meta,
    ...(response.query ? { query: response.query } : {}),
    features: response.places.map((place) => {
      // Only sources with a canonical resolver can omit their detail fields. Mixed-source
      // records retain enrichment until all contributing detail resolvers can merge it.
      const compact =
        place.sources.length === 1 &&
        ["osm", "mapy", "park4night", "user", "wikidata"].includes(place.sources[0]!.source);
      return {
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [place.lng, place.lat] as [number, number]
        },
        properties: {
          id: place.id,
          name: place.name,
          category: place.category,
          layerId: "osm-poi",
          sources: place.sources.map((s) => s.source).join(","),
          sourceRefs: encodeSourceRefs(place.sources),
          primarySource: place.sources[0]?.source ?? "osm",
          ...(place.wikidata ? { wikidata: place.wikidata } : {}),
          ...(place.fsqId ? { fsqId: place.fsqId } : {}),
          ...(!compact && place.address ? { address: place.address } : {}),
          ...(place.photo ? { photo: place.photo } : {}),
          ...(place.rating !== undefined ? { rating: place.rating } : {}),
          ...(!compact && place.website ? { website: place.website } : {}),
          ...(!compact && place.phone ? { phone: place.phone } : {}),
          ...(!compact && place.openingHours ? { opening_hours: place.openingHours } : {}),
          ...(place.elevationM !== undefined ? { ele: place.elevationM } : {}),
          ...(place.tags?.length ? { tags: place.tags } : {})
        }
      };
    })
  };
}

export function parsePlaceSources(raw: string | undefined): PlaceSourceId[] {
  const ids = (raw ?? "osm").split(",").filter(Boolean);
  const valid = ids.filter((id): id is PlaceSourceId => id in PLACE_SOURCE_BY_ID);
  return valid.length ? valid : ["osm"];
}

export function parsePoiCategories(raw: string | undefined) {
  const ids = (raw ?? "restaurant,cafe,parking,viewpoint").split(",").filter(Boolean);
  return ids.filter((id): id is keyof typeof OSM_POI_CATEGORIES => id in OSM_POI_CATEGORIES);
}
