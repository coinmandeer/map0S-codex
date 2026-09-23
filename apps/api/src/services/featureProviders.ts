import { resolveAreaSelection, filterAreaFeatures } from "../geo/areaSelection.js";
import type { AreaSelection } from "@mapos/layer-sdk";
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
import { getPark4nightFeatures, parsePark4nightFilters } from "./park4nightService.js";
import { getFusedPlaces } from "./poiFusionService.js";
import {
  parsePlaceSources,
  parsePoiCategories,
  placesToFeatureCollection
} from "./placesPresentation.js";
import { dataSourceProviders } from "./dataSources/index.js";
import { questAnchorFeatures } from "../game/questAnchorCache.js";
import { featurePage, featurePageV2 } from "./featurePages.js";

export interface FeatureRequest {
  signal?: AbortSignal;
  bbox: Bbox;
  area?: AreaSelection | null;
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
            const limit = normalizeFeatureLimit(request.query.limit);
            const area = await resolveAreaSelection(request.query);
            if (area && !["osm-poi", "user-layers"].includes(provider.id))
              throw new Error("Layer does not support area filtering");
            const bbox: Bbox = area
              ? [
                  Math.max(request.bbox[0], area.bbox[0]),
                  Math.max(request.bbox[1], area.bbox[1]),
                  Math.min(request.bbox[2], area.bbox[2]),
                  Math.min(request.bbox[3], area.bbox[3])
                ]
              : request.bbox;
            if (bbox[0] > bbox[2] || bbox[1] > bbox[3])
              return { type: "FeatureCollection", features: [] };
            const scoped = { ...request, bbox, area };
            return featurePage(provider.id, request, limit, async () => {
              const data = await legacy(scoped);
              return area ? filterAreaFeatures(data, area) : data;
            });
          }
        }
      : {}),
    ...(v2
      ? {
          async featuresV2(request: FeatureRequest): Promise<FeatureQueryResultV2> {
            const limit = normalizeFeatureLimit(request.query.limit);
            return featurePageV2(provider.id, request, limit, () => v2(request));
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
    async features({ bbox, query, area }) {
      const sources = parsePlaceSources(query.sources);
      // A plain OSM request skips fusion entirely — no reason to pay for merging when there is
      // only one source to merge.
      if (sources.length === 1 && sources[0] === "osm") {
        return getOsmPoiFeatures(bbox, query.categories, area);
      }
      const fused = await getFusedPlaces(
        {
          bbox,
          area,
          categories: parsePoiCategories(query.categories),
          sources
        },
        { progressive: true }
      );
      const collection = placesToFeatureCollection(fused);
      if (area)
        collection.query = { ...collection.query, status: "partial", bbox, truncated: true };
      return collection;
    }
  },
  {
    id: "user-layers",
    name: "Moje vrstvy",
    kind: "pins",
    features: ({ bbox, query, userId, area }) =>
      getUserLayerFeatures(bbox, userId, query.tag, query.country, area)
  },
  {
    id: "park4night",
    name: "Park4Night",
    kind: "pins",
    features: ({ bbox, query }) => getPark4nightFeatures(bbox, parsePark4nightFilters(query))
  },
  {
    // The open stand-in for Park4Night: same categories, ODbL, no one asking us to stop.
    id: "vanlife",
    name: "Karavany a kempy",
    kind: "pins",
    async features({ bbox, query }) {
      const categories = parsePoiCategories(query.categories);
      const wanted = categories.length ? categories : [...VANLIFE_CATEGORIES];
      const fused = await getFusedPlaces(
        {
          bbox,
          categories: wanted,
          sources: parsePlaceSources(query.sources)
        },
        { progressive: true }
      );
      return placesToFeatureCollection(fused);
    }
  },
  { id: "weather", name: "Počasí", kind: "raster" },
  { id: "game", name: "QuestLayer", kind: "custom-gl" },
  {
    // Quest anchors as ordinary pins, so objectives can be turned on beside a hiking map
    // without entering the 3D game mode — the caches, notes and monuments behind them are
    // worth seeing whether or not you are playing.
    id: "game-quests",
    name: "Herní questy",
    kind: "pins",
    features: ({ bbox, query }) => questAnchorFeatures(bbox, query.sources)
  },
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
