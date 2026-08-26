/** Adapts fused `Place` records to the GeoJSON the map layers already speak.
 *
 *  Keeping this translation in one place means the fusion service can evolve its own DTO
 *  without every pin layer, popup and list having to learn about provenance chains. */

import type { FeatureCollection, PlaceSourceId, PlacesResponse } from "@mapos/layer-sdk";
import { OSM_POI_CATEGORIES, PLACE_SOURCE_BY_ID } from "@mapos/layer-sdk";

/** GeoJSON properties must stay flat and JSON-scalar for MapLibre's feature-state and
 *  data-driven styling to work, so provenance is flattened to a comma-separated source list
 *  plus the primary source. */
export function placesToFeatureCollection(response: PlacesResponse): FeatureCollection & {
  meta: PlacesResponse["meta"];
} {
  return {
    type: "FeatureCollection",
    meta: response.meta,
    features: response.places.map((place) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [place.lng, place.lat] as [number, number] },
      properties: {
        id: place.id,
        name: place.name,
        category: place.category,
        layerId: "osm-poi",
        sources: place.sources.map((s) => s.source).join(","),
        primarySource: place.sources[0]?.source ?? "osm",
        ...(place.wikidata ? { wikidata: place.wikidata } : {}),
        ...(place.address ? { address: place.address } : {}),
        ...(place.photo ? { photo: place.photo } : {}),
        ...(place.rating !== undefined ? { rating: place.rating } : {}),
        ...(place.website ? { website: place.website } : {}),
        ...(place.phone ? { phone: place.phone } : {}),
        ...(place.openingHours ? { opening_hours: place.openingHours } : {}),
        ...(place.elevationM !== undefined ? { ele: place.elevationM } : {}),
        ...(place.tags?.length ? { tags: place.tags } : {})
      }
    }))
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
