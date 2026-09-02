/**
 * Server-side counterpart to the browser's layer registry: what `GET /layers/:layerId/features`
 * can serve.
 *
 * The route used to be a chain of `if (layerId === ...)`. A provider now declares itself here,
 * so adding a data layer is one entry rather than an edit to the route, the `/layers` listing
 * and whatever else had learnt the id.
 */

import {
  normalizeFeatureLimit,
  VANLIFE_CATEGORIES,
  type Bbox,
  type FeatureCollection,
  type FeatureQueryResultV2,
  type LayerKind
} from "@mapos/layer-sdk";
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
  /** Canonical endpoint; available only for providers migrated and fixture-tested for v2. */
  featuresV2?(req: FeatureRequest): Promise<FeatureQueryResultV2>;
}

/**
 * Applies the public per-layer query budget at the provider boundary.
 *
 * Upstreams use different page sizes (some return 200 or 500 records) and individual route
 * handlers are too easy to forget when a new source is registered. Wrapping the registry makes
 * 100 a hard response ceiling for both legacy and v2 providers, including providers added later.
 */
export function withFeatureQueryBudget(provider: FeatureProvider): FeatureProvider {
  const legacy = provider.features;
  const v2 = provider.featuresV2;
  return {
    ...provider,
    ...(legacy
      ? {
          async features(request: FeatureRequest): Promise<FeatureCollection> {
            const result = await legacy(request);
            const limit = normalizeFeatureLimit(request.query.limit);
            return { ...result, features: result.features.slice(0, limit) };
          }
        }
      : {}),
    ...(v2
      ? {
          async featuresV2(request: FeatureRequest): Promise<FeatureQueryResultV2> {
            const result = await v2(request);
            const limit = normalizeFeatureLimit(request.query.limit);
            const features = result.data.features.slice(0, limit);
            const truncated =
              result.meta.truncated || result.data.features.length > features.length;
            return {
              ...result,
              data: { ...result.data, features },
              meta: {
                ...result.meta,
                limit,
                returned: features.length,
                truncated,
                nextCursor: truncated ? result.meta.nextCursor : null
              }
            };
          }
        }
      : {})
  };
}

const RAW_FEATURE_PROVIDERS: FeatureProvider[] = [
  {
    id: "osm-poi",
    name: "OSM POI",
    kind: "pins",
    async features({ bbox, query }) {
      const sources = parsePlaceSources(query.sources);
      // A plain OSM request skips fusion entirely — no reason to pay for merging when there is
      // only one source to merge.
      if (sources.length === 1 && sources[0] === "osm") {
        return getOsmPoiFeatures(bbox, query.categories);
      }
      const fused = await getFusedPlaces({
        bbox,
        categories: parsePoiCategories(query.categories),
        sources
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
  {
    // The open stand-in for Park4Night: same categories, ODbL, no one asking us to stop.
    id: "vanlife",
    name: "Karavany a kempy",
    kind: "pins",
    async features({ bbox, query }) {
      const categories = parsePoiCategories(query.categories);
      const wanted = categories.length ? categories : [...VANLIFE_CATEGORIES];
      const fused = await getFusedPlaces({
        bbox,
        categories: wanted,
        sources: parsePlaceSources(query.sources)
      });
      return placesToFeatureCollection(fused);
    }
  },
  { id: "weather", name: "Počasí", kind: "raster" },
  { id: "game", name: "QuestLayer", kind: "custom-gl" },
  ...dataSourceProviders
];

export const FEATURE_PROVIDERS: FeatureProvider[] =
  RAW_FEATURE_PROVIDERS.map(withFeatureQueryBudget);

const BY_ID = new Map(FEATURE_PROVIDERS.map((p) => [p.id, p]));

export function featureProvider(id: string): FeatureProvider | undefined {
  return BY_ID.get(id);
}

export function layerListing() {
  return FEATURE_PROVIDERS.map(({ id, name, kind }) => ({ id, name, kind }));
}
