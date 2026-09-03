/**
 * The tool handlers behind the assistant (§30.3 "reálné handlery").
 *
 * Every handler is a thin adapter over a service the rest of the API already uses, so an answer
 * and the map cannot disagree about the data. Two rules hold here:
 *
 * - A tool with no provider is **not registered as available**, so it is never offered to the
 *   model. A tool the model can name but the server cannot run is an invitation to invent.
 * - `get_current_map_context` is bound per request, which is why the registry is built per turn.
 *   The projection is still what decides which of those layer ids survive.
 */

import type { Bbox } from "@mapos/layer-sdk";
import type { AiWebTools } from "./webTools.js";
import {
  createMapAiToolRegistry,
  type MapAiToolHandler,
  type MapAiToolHandlers
} from "./toolCatalog.js";
import { nearestPoiSourceFromSearch, type AiPlaceSearchSource } from "./placeSearch.js";
import type { AiToolExecutionContext, AiToolRegistry, AiToolTrace } from "./toolRegistry.js";

export interface AiChatLayerDescriptor {
  layerId: string;
  name: string;
  categories: readonly string[];
  access: "public" | "authenticated" | "entitled" | "owner" | "metadata-only";
}

export interface AiChatSourcedFeature {
  id: string;
  layerId: string;
  title: string;
  longitude: number;
  latitude: number;
  sourceId: string;
}

export interface AiChatCitation {
  sourceId: string;
  label: string;
  url?: string;
  providerId?: string;
  retrievedAt?: string;
}

/** Everything the assistant can be given access to. Optional members are optional on purpose:
 *  the offline server composes a subset and the model is told only about that subset. */
export interface AiChatToolProviders {
  placeSearch: AiPlaceSearchSource;
  layers(): readonly AiChatLayerDescriptor[];
  queryLayer?(
    input: {
      layerId: string;
      bbox: Bbox;
      filters?: { openNow?: boolean; minRating?: number; tags?: readonly string[] };
      limit: number;
    },
    context: AiToolExecutionContext
  ): Promise<{ features: AiChatSourcedFeature[]; sources: AiChatCitation[] }>;
  featureDetail?(
    input: { layerId: string; featureId: string; fields: readonly string[] },
    context: AiToolExecutionContext
  ): Promise<{
    feature: { id: string; layerId: string; fields: Record<string, unknown> };
    sources: AiChatCitation[];
  }>;
  savedPlaces?(
    input: { userId: string; query: string; limit: number },
    context: AiToolExecutionContext
  ): Promise<{ places: { id: string; title: string; longitude?: number; latitude?: number }[] }>;
  route?(
    input: {
      from: { longitude: number; latitude: number };
      to: { longitude: number; latitude: number };
      profile: "car" | "bike" | "foot";
    },
    context: AiToolExecutionContext
  ): Promise<{
    distanceMeters: number;
    durationSeconds: number;
    geometry: { longitude: number; latitude: number }[];
    source: AiChatCitation;
  }>;
  weather?(
    input: { point: { longitude: number; latitude: number }; at: string },
    context: AiToolExecutionContext
  ): Promise<{ at: string; summary: string; temperatureC: number; source: AiChatCitation }>;
  events?(
    input: { layerIds: readonly string[]; bbox: Bbox; from: string; to: string; limit: number },
    context: AiToolExecutionContext
  ): Promise<{
    events: { id: string; layerId: string; title: string; startsAt: string; sourceId: string }[];
    sources: AiChatCitation[];
  }>;
  regionContext?(
    input: { point: { longitude: number; latitude: number }; zoom?: number; lang?: string },
    context: AiToolExecutionContext
  ): Promise<{
    region: {
      name: string;
      level: string;
      hierarchy?: string[];
      countryCode?: string;
    };
    guide?: {
      lead: string;
      highlights: { title: string; text: string; sourceIds: string[] }[];
      practical?: { arrival?: string; bestTime?: string; warnings?: string[] };
    };
    sources: AiChatCitation[];
  }>;
  stats?(
    input: {
      point: { longitude: number; latitude: number };
      zoom?: number;
      metrics?: readonly string[];
    },
    context: AiToolExecutionContext
  ): Promise<{
    statistics: {
      id: string;
      label: string;
      value: number;
      unit: string;
      year?: number;
      uncertaintyLabel?: string;
      regionName?: string;
      sourceIds: string[];
    }[];
    sources: AiChatCitation[];
  }>;
  web?: AiWebTools;
}

export interface AiChatMapContext {
  center: { longitude: number; latitude: number };
  zoom: number;
  activeLayerIds: readonly string[];
}

const notComposed: MapAiToolHandler = async () => {
  throw new Error("AI tool has no provider in this composition");
};

function asObject(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

/**
 * Builds the registry for one chat turn and reports which tools may be offered to the model.
 *
 * Registration is all-or-nothing (the catalog is the audit boundary), so unavailable tools are
 * registered with a handler that refuses and are simply left out of `available`.
 */
export function createChatToolRegistry(options: {
  providers: AiChatToolProviders;
  mapContext: AiChatMapContext;
  onTrace?: (trace: AiToolTrace) => void;
}): { registry: AiToolRegistry; available: ReadonlySet<string> } {
  const { providers, mapContext } = options;
  const available = new Set<string>([
    "get_current_map_context",
    "list_available_layers",
    "search_places",
    "find_nearest_poi"
  ]);

  const handlers: MapAiToolHandlers = {
    get_current_map_context: async () => ({
      center: { ...mapContext.center },
      zoom: mapContext.zoom,
      activeLayerIds: [...mapContext.activeLayerIds]
    }),
    list_available_layers: async () => ({
      layers: providers.layers().map((layer) => ({
        layerId: layer.layerId,
        name: layer.name,
        categories: [...layer.categories],
        access: layer.access
      }))
    }),
    search_places: async (input, context) =>
      providers.placeSearch.search(
        {
          ...(typeof input.query === "string" ? { query: input.query } : {}),
          ...(Array.isArray(input.categories) ? { categories: input.categories as string[] } : {}),
          ...(input.near ? { near: input.near as { longitude: number; latitude: number } } : {}),
          ...(Array.isArray(input.bbox) ? { bbox: input.bbox as Bbox } : {}),
          ...(typeof input.radiusMeters === "number" ? { radiusMeters: input.radiusMeters } : {}),
          ...(input.filters ? { filters: asObject(input.filters) } : {}),
          limit: Number(input.limit)
        },
        context
      ),
    query_layer: providers.queryLayer
      ? async (input, context) =>
          providers.queryLayer!(
            {
              layerId: String(input.layerId),
              bbox: input.bbox as Bbox,
              ...(input.filters ? { filters: asObject(input.filters) } : {}),
              limit: Number(input.limit)
            },
            context
          )
      : notComposed,
    get_feature_detail: providers.featureDetail
      ? async (input, context) =>
          providers.featureDetail!(
            {
              layerId: String(input.layerId),
              featureId: String(input.featureId),
              fields: (input.fields as string[]) ?? []
            },
            context
          )
      : notComposed,
    query_saved_places: providers.savedPlaces
      ? async (input, context) =>
          providers.savedPlaces!(
            {
              userId: context.actor.userId ?? "",
              query: String(input.query),
              limit: Number(input.limit)
            },
            context
          )
      : notComposed,
    route_segment: providers.route
      ? async (input, context) =>
          providers.route!(
            {
              from: input.from as { longitude: number; latitude: number },
              to: input.to as { longitude: number; latitude: number },
              profile: input.profile as "car" | "bike" | "foot"
            },
            context
          )
      : notComposed,
    get_weather: providers.weather
      ? async (input, context) =>
          providers.weather!(
            {
              point: input.point as { longitude: number; latitude: number },
              at: String(input.at)
            },
            context
          )
      : notComposed,
    search_events: providers.events
      ? async (input, context) =>
          providers.events!(
            {
              layerIds: (input.layerIds as string[]) ?? [],
              bbox: input.bbox as Bbox,
              from: String(input.from),
              to: String(input.to),
              limit: Number(input.limit)
            },
            context
          )
      : notComposed,
    get_region_context: providers.regionContext
      ? async (input, context) =>
          providers.regionContext!(
            {
              point: input.point as { longitude: number; latitude: number },
              ...(typeof input.zoom === "number" ? { zoom: input.zoom } : {}),
              ...(typeof input.lang === "string" ? { lang: input.lang } : {})
            },
            context
          )
      : notComposed,
    get_stats: providers.stats
      ? async (input, context) =>
          providers.stats!(
            {
              point: input.point as { longitude: number; latitude: number },
              ...(typeof input.zoom === "number" ? { zoom: input.zoom } : {}),
              ...(Array.isArray(input.metrics) ? { metrics: input.metrics as string[] } : {})
            },
            context
          )
      : notComposed,
    web_search: providers.web
      ? async (input, context) =>
          providers.web!.search(
            {
              query: String(input.query),
              ...(typeof input.maxResults === "number" ? { maxResults: input.maxResults } : {})
            },
            context
          )
      : notComposed,
    web_fetch: providers.web
      ? async (input, context) => providers.web!.fetch({ url: String(input.url) }, context)
      : notComposed,
    // Drafts that write into a plan or a layer selection are AI-3; until then the assistant
    // proposes them as cards the user applies, and the tools stay uncomposed.
    set_layer_selection_draft: notComposed,
    create_plan_draft: notComposed
  };

  if (providers.queryLayer) available.add("query_layer");
  if (providers.featureDetail) available.add("get_feature_detail");
  if (providers.savedPlaces) available.add("query_saved_places");
  if (providers.route) available.add("route_segment");
  if (providers.weather) available.add("get_weather");
  if (providers.events) available.add("search_events");
  if (providers.regionContext) available.add("get_region_context");
  if (providers.stats) available.add("get_stats");
  if (providers.web) {
    available.add("web_search");
    available.add("web_fetch");
  }

  const registry = createMapAiToolRegistry({
    handlers,
    nearestPoiSource: nearestPoiSourceFromSearch(providers.placeSearch),
    ...(options.onTrace ? { onTrace: options.onTrace } : {})
  });
  return { registry, available };
}
