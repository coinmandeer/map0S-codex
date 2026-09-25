import { createHash } from "node:crypto";
import { OSM_POI_CATEGORIES, type Bbox, type OsmPoiCategoryId } from "@mapos/layer-sdk";
import { isoForBbox, langsForBbox } from "../../data/euCountries.js";
import { keywordsFor, labelMatchesCategory } from "../../data/mapyKeywords.js";
import { mapySuggest } from "../mapyService.js";
import type { AiPlaceSearchQuery } from "./placeSearch.js";
import type { AiNearestPoiRecord } from "./toolCatalog.js";

/** A few viewport-bounded requests, not the bulk category import. Coordinates come from Mapy. */
export function createMapyPlaceSearch(suggest = mapySuggest) {
  return async (
    query: AiPlaceSearchQuery,
    bbox: Bbox,
    categories: OsmPoiCategoryId[],
    signal: AbortSignal
  ): Promise<AiNearestPoiRecord[]> => {
    signal.throwIfAborted();
    const lang = langsForBbox(bbox, 1)[0] ?? "en";
    const iso = isoForBbox(bbox);
    const terms = query.query
      ? [query.query]
      : categories.slice(0, 2).flatMap((category) => keywordsFor(category, lang, iso).slice(0, 2));
    const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(5000)]);
    const results = await Promise.allSettled(
      [...new Set(terms)].map((term) =>
        suggest({
          query: term,
          lang,
          bbox,
          type: "poi",
          limit: 15,
          signal: boundedSignal,
          ...(query.near
            ? { preferNear: [query.near.longitude, query.near.latitude] as [number, number] }
            : {})
        })
      )
    );
    signal.throwIfAborted();
    const found = new Map<string, AiNearestPoiRecord>();
    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      for (const item of result.value) {
        const { lon: longitude, lat: latitude } = item.position;
        if (
          !item.name.trim() ||
          !Number.isFinite(longitude) ||
          !Number.isFinite(latitude) ||
          longitude < bbox[0] ||
          longitude > bbox[2] ||
          latitude < bbox[1] ||
          latitude > bbox[3]
        )
          continue;
        const category = categories.find((candidate) =>
          labelMatchesCategory(item.label, candidate, lang, iso)
        );
        if (categories.length && !category) continue;
        const key = createHash("sha256")
          .update(JSON.stringify([item.name, longitude, latitude]))
          .digest("hex")
          .slice(0, 24);
        found.set(key, {
          id: `mapy-poi:${key}`,
          layerId: "osm-poi",
          title: item.name.slice(0, 500),
          category: category ? `${OSM_POI_CATEGORIES[category].group}.${category}` : "poi",
          longitude,
          latitude,
          source: {
            sourceId: `mapy:${key}`,
            providerId: "mapy",
            label: "Mapy.com",
            retrievedAt: new Date().toISOString(),
            url: `https://mapy.com/?x=${longitude}&y=${latitude}&z=17`
          }
        });
      }
    }
    return [...found.values()];
  };
}
export const searchMapyPlaces = createMapyPlaceSearch();
