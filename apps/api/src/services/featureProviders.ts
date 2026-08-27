/**
 * Server-side counterpart to the browser's layer registry: what `GET /layers/:layerId/features`
 * can serve.
 *
 * The route used to be a chain of `if (layerId === ...)`. A provider now declares itself here,
 * so adding a data layer is one entry rather than an edit to the route, the `/layers` listing
 * and whatever else had learnt the id.
 */

import type { Bbox, FeatureCollection, LayerKind } from "@mapos/layer-sdk";
import { getOsmPoiFeatures, getUserLayerFeatures } from "./layerService.js";
import { getPark4nightFeatures } from "./park4nightService.js";
import { getFusedPlaces } from "./poiFusionService.js";
import {
  parsePlaceSources,
  parsePoiCategories,
  placesToFeatureCollection
} from "./placesPresentation.js";
import { dataSourceProviders } from "./dataSources/index.js";

export interface FeatureRequest {
  bbox: Bbox;
  query: Record<string, string | undefined>;
  /** Resolved from the session cookie; undefined for anonymous callers. */
  userId?: string;
}

export interface FeatureProvider {
  id: string;
  name: string;
  kind: LayerKind;
  /** Layers that render from tiles or are client-only have no server endpoint. */
  features?(req: FeatureRequest): Promise<FeatureCollection>;
}

export const FEATURE_PROVIDERS: FeatureProvider[] = [
  {
    id: "osm-poi",
    name: "OSM POI",
    kind: "pins",
    async features({ bbox, query, userId }) {
      const sources = parsePlaceSources(query.sources);
      // A plain OSM request skips fusion entirely — no reason to pay for merging when there is
      // only one source to merge.
      if (sources.length === 1 && sources[0] === "osm") {
        return getOsmPoiFeatures(bbox, query.categories);
      }
      const fused = await getFusedPlaces({
        bbox,
        categories: parsePoiCategories(query.categories),
        sources,
        userId
      });
      return placesToFeatureCollection(fused);
    }
  },
  {
    id: "user-layers",
    name: "Moje vrstvy",
    kind: "pins",
    features: ({ bbox, query, userId }) =>
      getUserLayerFeatures(bbox, userId, query.tag, query.country)
  },
  {
    id: "park4night",
    name: "Park4Night",
    kind: "pins",
    features: ({ bbox }) => getPark4nightFeatures(bbox)
  },
  { id: "weather", name: "Počasí", kind: "raster" },
  { id: "game", name: "QuestLayer", kind: "custom-gl" },
  ...dataSourceProviders
];

const BY_ID = new Map(FEATURE_PROVIDERS.map((p) => [p.id, p]));

export function featureProvider(id: string): FeatureProvider | undefined {
  return BY_ID.get(id);
}

export function layerListing() {
  return FEATURE_PROVIDERS.map(({ id, name, kind }) => ({ id, name, kind }));
}
