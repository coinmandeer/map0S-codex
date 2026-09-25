import { resolveChatLocation } from "./locationResolver.js";
import { searchMapyPlaces } from "./mapyPlaceSearch.js";
import { layerMapResult } from "./layerMapResult.js";
import { nightSkyConditions } from "../nightSkyService.js";
import { CATALOG_GROUPS, BASEMAPS, LAYER_ALIASES, CATALOG_DATA } from "@mapos/layer-sdk";
import { routeChatPlan, routeOverview } from "./tripRoute.js";
import { mapyRouteMatrix } from "../mapyService.js";
import { answerStatisticalQuestion } from "./statisticalQuestion.js";
import { sourcePlaceDetail } from "./sourceDetail.js";
/**
 * What the assistant is allowed to reach, in production and offline.
 *
 * The production composition wires the tools to the same services the map endpoints use; the
 * offline one wires them to the demo fixtures. Both go through the identical catalog, so a
 * regression in the offline profile is a real regression and not a difference between two
 * hand-written stubs.
 */

import { OSM_POI_CATEGORIES, type OsmPoiCategoryId } from "@mapos/layer-sdk";
import { capabilities } from "../../config.js";
import { providerCircuitBreaker } from "../../utils/upstream.js";
import { providerBudgets } from "../providerBudget/repository.js";
import { FEATURE_PROVIDERS } from "../featureProviders.js";
import type { AiConversationStore } from "./conversation.js";
import { AiChatService, type AiChatPlanEditor } from "./chatService.js";
import { createChatToolRegistry, type AiChatMapContext } from "./chatTools.js";
import type { AiToolTrace } from "./toolRegistry.js";
import { getFusedPlaces } from "../poiFusionService.js";
import { getPointForecast } from "../infoService.js";
import { fetchRoute } from "../routingService.js";
import type { SavedPlaceService } from "../savedPlaceService.js";
import type { EventService } from "../events/eventService.js";
import type { DiscoverContextService } from "../discoverService.js";
import type { AiChatLayerDescriptor, AiChatToolProviders } from "./chatTools.js";
import {
  createFusedPlaceSearchSource,
  createMemoryPlaceSearchSource,
  type MemoryPlaceFixture
} from "./placeSearch.js";
import { createFixtureWebTools, createOllamaWebTools } from "./webTools.js";

/** WMO codes as one short Czech sentence. Open-Meteo answers in codes; a tool result of `61` is
 *  something a model has to guess about, and it guesses confidently. */
const WEATHER_SUMMARIES: readonly (readonly [readonly number[], string])[] = [
  [[0], "Jasno"],
  [[1, 2], "Skoro jasno"],
  [[3], "Zataženo"],
  [[45, 48], "Mlha"],
  [[51, 53, 55, 56, 57], "Mrholení"],
  [[61, 63, 65, 66, 67], "Déšť"],
  [[71, 73, 75, 77, 85, 86], "Sněžení"],
  [[80, 81, 82], "Přeháňky"],
  [[95, 96, 99], "Bouřky"]
];

function weatherSummary(code: number | null): string {
  if (code === null) return "Bez dostupného popisu";
  return WEATHER_SUMMARIES.find(([codes]) => codes.includes(code))?.[1] ?? "Proměnlivo";
}

/** Layers as metadata, from the same registry that serves their features. POI layers advertise
 *  the categories they can be filtered by, which is how a model knows `nature.camp_site` exists. */
export function layerCatalog(): readonly AiChatLayerDescriptor[] {
  const privateIds = new Set(["user-layers", "my-saved-places"]);
  const entries: AiChatLayerDescriptor[] = CATALOG_GROUPS.flatMap((group) => group.items)
    .filter((item) => !privateIds.has(item.layer))
    .map((item) => ({
      layerId: item.id,
      name: `${item.cs} / ${item.en}`,
      categories: item.values ?? [],
      access: "public",
      sourceLayerId: item.layer,
      kind: "overlay",
      ...(CATALOG_DATA[item.layer]
        ? { description: CATALOG_DATA[item.layer]!.description, data: CATALOG_DATA[item.layer] }
        : {}),
      aliases: [...(LAYER_ALIASES[item.id] ?? LAYER_ALIASES[item.layer] ?? [])],
      ...(item.facet ? { facet: item.facet } : {})
    }));
  const known = new Set(entries.map((e) => e.layerId));
  for (const provider of FEATURE_PROVIDERS)
    if (!privateIds.has(provider.id) && !known.has(provider.id))
      entries.push({
        layerId: provider.id,
        name: provider.name,
        categories: provider.id === "osm-poi" ? Object.keys(OSM_POI_CATEGORIES) : [],
        access: "public",
        kind: "overlay"
      });
  for (const basemap of BASEMAPS)
    entries.push({
      layerId: basemap.id,
      name: basemap.label,
      categories: [],
      access: "public",
      kind: "basemap",
      description: basemap.hint,
      ...(basemap.requiresCapability ? { requiresCapability: basemap.requiresCapability } : {})
    });
  return entries;
}
export const PUBLIC_AI_CATALOG_IDS = new Set(layerCatalog().map((entry) => entry.layerId));

/** Configuration is only an eligibility check; a source without a successful request is unchecked. */
async function availableLayerCatalog(): Promise<readonly AiChatLayerDescriptor[]> {
  const caps = capabilities();
  const health = new Map(providerCircuitBreaker.snapshots().map((s) => [s.provider, s]));
  const keyed: Record<string, [string, string]> = {
    "charging-stations": ["ocm", "openchargemap"],
    "active-fires": ["firms", "nasa-firms"],
    openaq: ["openaq", "openaq"],
    ebird: ["ebird", "ebird"],
    ticketmaster: ["ticketmaster", "ticketmaster"],
    europeana: ["europeana", "europeana"],
    ...Object.fromEntries(
      Object.keys(CATALOG_DATA)
        .filter((id) => id.startsWith("golemio-"))
        .map((id) => [id, ["golemio", "golemio"] as [string, string]])
    ),
    "sky-brightness": ["skyAtlas", "sky-atlas"]
  };
  const [googleBudget, mapyBudget] = await Promise.all([
    caps.googleTiles
      ? providerBudgets.available({
          product: "google-tiles",
          account: process.env.GOOGLE_BUDGET_ACCOUNT ?? "",
          operation: "tile"
        })
      : false,
    caps.mapy
      ? providerBudgets.available({
          product: "mapy-credits",
          account: process.env.MAPY_BUDGET_ACCOUNT ?? "",
          operation: "tile"
        })
      : false
  ]);
  return layerCatalog().map((entry) => {
    const [cap, provider] = keyed[entry.sourceLayerId ?? entry.layerId] ?? [
      entry.requiresCapability,
      undefined
    ];
    const source =
      provider ??
      CATALOG_DATA[entry.sourceLayerId ?? entry.layerId]?.providerId ??
      (cap?.startsWith("google") ? "google" : cap === "mapy" ? "mapy" : undefined);
    const status = source ? health.get(source === "google" ? "basemap-google" : source) : undefined;
    const reason =
      cap && !caps[cap]
        ? "Zdroj není nakonfigurován nebo povolen."
        : (source === "google" && !googleBudget) || (source === "mapy" && !mapyBudget)
          ? "Chybí volný ověřený rozpočet poskytovatele."
          : status?.state === "open"
            ? "Poskytovatel po opakovaných chybách dočasně neodpovídá."
            : undefined;
    return {
      ...entry,
      ...(cap ? { requiresCapability: cap } : {}),
      availability: reason
        ? "unavailable"
        : status?.lastSuccessAt && !status.consecutiveFailures
          ? "ready"
          : "unchecked",
      ...(reason ? { unavailableReason: reason } : {}),
      ...(status?.lastSuccessAt ? { checkedAt: status.lastSuccessAt } : {})
    };
  });
}

function resolveCategoryIds(raw: readonly string[]): OsmPoiCategoryId[] {
  const ids = new Set<OsmPoiCategoryId>();
  for (const entry of raw) {
    const bare = entry.includes(".") ? entry.slice(entry.indexOf(".") + 1) : entry;
    if (Object.hasOwn(OSM_POI_CATEGORIES, bare)) ids.add(bare as OsmPoiCategoryId);
  }
  return [...ids];
}

export interface ProductionChatToolOptions {
  savedPlaces?: SavedPlaceService;
  events?: EventService;
  eventLayerId?: string;
  /** The Objevuj context, reused so `get_region_context` and the panel cannot disagree about
   *  which region the map centre is in (§30.5). */
  discover?: Pick<DiscoverContextService, "get">;
}

export function createProductionChatToolProviders(
  options: ProductionChatToolOptions = {}
): AiChatToolProviders {
  const web = createOllamaWebTools();
  const eventLayerId = options.eventLayerId ?? "events";

  const providers: AiChatToolProviders = {
    routePlan: routeChatPlan,
    nightSky: nightSkyConditions,
    routeMatrix: (stops, profile, signal) =>
      mapyRouteMatrix(
        stops.map((p) => [p.longitude, p.latitude]),
        profile === "foot" ? "foot_hiking" : profile === "bike" ? "bike_mountain" : "car_fast",
        signal
      ),
    resolveLocation: resolveChatLocation,
    statisticalAnswer: answerStatisticalQuestion,
    placeSearch: createFusedPlaceSearchSource((query) => getFusedPlaces(query), searchMapyPlaces),
    layers: availableLayerCatalog,
    async featureDetail(input, context) {
      const detail = await sourcePlaceDetail(input, context.signal);
      return {
        feature: {
          id: input.featureId,
          layerId: input.layerId,
          fields: Object.fromEntries(
            Object.entries(detail.fields).filter(([key]) => input.fields.includes(key))
          )
        },
        sources: [detail.source]
      };
    },

    async queryLayer(input, context) {
      context.signal.throwIfAborted();
      const provider = FEATURE_PROVIDERS.find((entry) => entry.id === input.layerId);
      if (!provider?.features) return { features: [], sources: [] };
      const collection = await provider.features({
        bbox: input.bbox,
        signal: context.signal,
        userId: context.actor.userId,
        query: {
          limit: String(input.limit),
          ...(input.area ? { areaId: input.area.id, boundaryRevision: input.area.revision } : {}),
          ...(input.filters?.openNow !== undefined
            ? { openNow: String(input.filters.openNow) }
            : {}),
          ...(input.filters?.minRating !== undefined
            ? { minRating: String(input.filters.minRating) }
            : {}),
          ...(input.filters?.tags ? { tags: input.filters.tags.join(",") } : {}),
          ...(input.filters?.categories ? { categories: input.filters.categories.join(",") } : {}),
          ...(input.filters?.sources ? { sources: input.filters.sources.join(",") } : {})
        }
      });
      const features = collection.features
        .filter((feature) => feature.geometry?.type === "Point")
        .slice(0, input.limit)
        .map((feature, index) => {
          const [longitude, latitude] = feature.geometry.coordinates as [number, number];
          const properties = (feature.properties ?? {}) as Record<string, unknown>;
          const id =
            typeof properties.id === "string" ? properties.id : `${input.layerId}:${index}`;
          const title =
            typeof properties.name === "string" && properties.name.trim()
              ? properties.name.trim().slice(0, 500)
              : id;
          return {
            id,
            layerId: input.layerId,
            title,
            longitude,
            latitude,
            sourceId: `layer:${input.layerId}`
          };
        });
      const mapResult = layerMapResult(input.layerId, collection.features, input.limit);
      return {
        features,
        ...(mapResult ? { mapResult } : {}),
        sources:
          features.length || mapResult
            ? [
                {
                  sourceId: `layer:${input.layerId}`,
                  label: `Vrstva ${provider.name}`,
                  providerId: input.layerId
                }
              ]
            : []
      };
    },

    async weather(input, context) {
      context.signal.throwIfAborted();
      const forecast = await getPointForecast(input.point.longitude, input.point.latitude);
      // The hour closest to the asked-for time; the forecast is hourly and the question rarely is.
      const wanted = Date.parse(input.at);
      const hour = Number.isFinite(wanted)
        ? forecast.hourly.reduce<(typeof forecast.hourly)[number] | null>((best, entry) => {
            const distance = Math.abs(Date.parse(entry.time) - wanted);
            const bestDistance = best ? Math.abs(Date.parse(best.time) - wanted) : Infinity;
            return distance < bestDistance ? entry : best;
          }, null)
        : null;
      const temperature = hour?.temperature ?? forecast.current?.temperature ?? null;
      if (temperature === null) throw new Error("weather has no temperature for this point");
      return {
        at: hour?.time ?? input.at,
        summary: weatherSummary(hour?.code ?? forecast.current?.code ?? null),
        temperatureC: temperature,
        source: {
          sourceId: forecast.source.id,
          label: `${forecast.source.label} (${forecast.source.license})`,
          url: forecast.source.url,
          providerId: forecast.source.id
        }
      };
    },

    async route(input, context) {
      context.signal.throwIfAborted();
      const route = await fetchRoute(
        `${input.from.longitude},${input.from.latitude}`,
        `${input.to.longitude},${input.to.latitude}`,
        input.profile,
        { signal: context.signal }
      );
      return {
        distanceMeters: Math.round(route.distanceM),
        durationSeconds: Math.round(route.durationS),
        // The schema allows 10 000 points; a plan-sized overview never needs more, and a model
        // reading 10 000 coordinates is paying for a shape it cannot see.
        geometry: routeOverview(route.coordinates).map(([longitude, latitude]) => ({
          longitude,
          latitude
        })),
        source: {
          sourceId: `routing:${route.provider}`,
          label: route.provider === "mapy" ? "Mapy.com routing" : "OSRM (OpenStreetMap)",
          providerId: `routing-${route.provider}`
        }
      };
    },

    ...(web ? { web } : {})
  };

  if (options.savedPlaces) {
    const service = options.savedPlaces;
    providers.savedPlaces = async (input, context) => {
      context.signal.throwIfAborted();
      if (!input.userId) return { places: [] };
      const listing = await service.list(input.userId, { q: input.query, limit: input.limit });
      return {
        places: listing.savedPlaces.map((place) => {
          const [longitude, latitude] = place.snapshot.position;
          return {
            id: place.id,
            title: place.snapshot.title.slice(0, 500),
            ...(typeof longitude === "number" ? { longitude } : {}),
            ...(typeof latitude === "number" ? { latitude } : {})
          };
        })
      };
    };
  }

  if (options.events) {
    const service = options.events;
    providers.events = async (input, context) => {
      context.signal.throwIfAborted();
      const listing = await service.list({
        bbox: input.bbox,
        from: input.from,
        to: input.to,
        limit: input.limit
      });
      // An event without provenance is not citable, so it is not offered to the model either.
      const rows = listing.events.filter((event) => event.sources[0]);
      const events = rows.map((event) => ({
        id: event.id,
        layerId: eventLayerId,
        title: event.title.slice(0, 500),
        startsAt: event.schedule.startsAt,
        sourceId: `events:${event.sources[0]!.providerId}`
      }));
      const sources = new Map(
        rows.map((event) => {
          const provenance = event.sources[0]!;
          return [
            `events:${provenance.providerId}`,
            {
              sourceId: `events:${provenance.providerId}`,
              label: provenance.attribution ?? provenance.providerId,
              ...(provenance.url ? { url: provenance.url } : {}),
              providerId: provenance.providerId
            }
          ];
        })
      );
      return { events, sources: [...sources.values()] };
    };
  }

  if (options.discover) attachDiscoverProviders(providers, options.discover);

  return providers;
}

/** `get_region_context` and `get_stats`, both read from the Objevuj context service. */
function attachDiscoverProviders(
  providers: AiChatToolProviders,
  discover: Pick<DiscoverContextService, "get">
): void {
  {
    // One context lookup answers both tools; the service caches it, so asking for the region and
    // then for its numbers costs one round of upstreams.
    const context = (
      input: { point: { longitude: number; latitude: number }; zoom?: number; lang?: string },
      signal: AbortSignal
    ) =>
      discover.get(
        {
          lng: input.point.longitude,
          lat: input.point.latitude,
          zoom: input.zoom ?? 12,
          ...(input.lang ? { lang: input.lang } : {})
        },
        signal
      );

    providers.regionContext = async (input, execution) => {
      execution.signal.throwIfAborted();
      const resolved = await context(input, execution.signal);
      if (!resolved.region) throw new Error("region is not resolvable for this point");
      const guide = resolved.guideSynthesis;
      return {
        region: {
          name: resolved.region.name,
          level: resolved.region.level,
          hierarchy: resolved.region.hierarchy.map((item) => item.name).slice(0, 8),
          ...(resolved.region.countryCode ? { countryCode: resolved.region.countryCode } : {})
        },
        ...(guide && (guide.lead || guide.highlights.length)
          ? {
              guide: {
                lead: guide.lead,
                highlights: guide.highlights.slice(0, 6).map((highlight) => ({
                  title: highlight.title,
                  text: highlight.text,
                  sourceIds: highlight.sourceIds
                })),
                ...(guide.practical.arrival ||
                guide.practical.bestTime ||
                guide.practical.warnings.length
                  ? { practical: guide.practical }
                  : {})
              }
            }
          : {}),
        sources: resolved.sources.map((source) => ({
          sourceId: source.id,
          label: source.label,
          ...(source.url ? { url: source.url } : {})
        }))
      };
    };

    providers.stats = async (input, execution) => {
      execution.signal.throwIfAborted();
      const resolved = await context(input, execution.signal);
      const wanted = new Set(input.metrics ?? []);
      const statistics = resolved.statistics
        .filter((statistic) => !wanted.size || wanted.has(statistic.id))
        .map((statistic) => ({
          id: statistic.id,
          label: statistic.label,
          value: statistic.value,
          unit: statistic.unit,
          ...(statistic.year === null ? {} : { year: statistic.year }),
          uncertaintyLabel: statistic.uncertaintyLabel,
          regionName: statistic.scope.regionName,
          sourceIds: statistic.sourceIds
        }));
      const cited = new Set(statistics.flatMap((statistic) => statistic.sourceIds));
      return {
        statistics,
        sources: resolved.sources
          .filter((source) => cited.has(source.id))
          .map((source) => ({
            sourceId: source.id,
            label: source.label,
            ...(source.url ? { url: source.url } : {})
          }))
      };
    };
  }
}

/** Offline: the demo POI fixtures and one labelled web page, so every tool the offline profile
 *  offers answers without touching the network. */
export function createFixtureChatToolProviders(options: {
  fixtures: () => readonly MemoryPlaceFixture[];
  layerIds?: readonly string[];
  discover?: Pick<DiscoverContextService, "get">;
}): AiChatToolProviders {
  const layerIds = options.layerIds ?? ["osm-poi"];
  const providers: AiChatToolProviders = {
    placeSearch: createMemoryPlaceSearchSource(options.fixtures),
    layers: () =>
      layerIds.map((layerId) => ({
        layerId,
        name: layerId === "osm-poi" ? "OSM POI (fixture)" : layerId,
        categories: [
          ...new Set(
            resolveCategoryIds(options.fixtures().map((fixture) => fixture.category)).map(
              (id) => `${OSM_POI_CATEGORIES[id].group}.${id}`
            )
          )
        ],
        access: "public" as const
      })),
    web: createFixtureWebTools([
      {
        url: "https://fixture.test/kempy",
        title: "Kempy v okolí (fixture)",
        text: "Deterministická fixture stránka pro offline profil. Popisuje kempy u vody."
      }
    ])
  };
  if (options.discover) attachDiscoverProviders(providers, options.discover);
  return providers;
}

export type AiChatTurnFactory = (mapContext: AiChatMapContext) => AiChatService;

/**
 * One chat service per turn.
 *
 * The registry is rebuilt for each request because `get_current_map_context` answers from that
 * request's viewport, and a viewport captured at boot would quietly answer every later question
 * about the wrong place. Registration is cheap; a stale context is not.
 */
export function createAiChatTurnFactory(options: {
  conversations: AiConversationStore;
  persistence?: import("./conversationPersistence.js").ConversationPersistence;
  overview?: import("./overviewService.js").OverviewService;
  providers: AiChatToolProviders;
  onToolTrace?: (trace: AiToolTrace) => void;
  /** Where an `edit_plan` turn sends its proposals; absent means the chat only talks about plans. */
  planEditor?: AiChatPlanEditor;
}): AiChatTurnFactory {
  return (mapContext) => {
    const { registry, available } = createChatToolRegistry({
      providers: options.providers,
      mapContext,
      ...(options.onToolTrace ? { onTrace: options.onToolTrace } : {})
    });
    return new AiChatService({
      registry,
      onLocationResolved: (center, bbox) => {
        mapContext.center = center;
        mapContext.bbox = bbox;
        mapContext.area = null;
      },
      routePlan: options.providers.routePlan,
      routeMatrix: options.providers.routeMatrix,
      statistics: options.providers.statisticalAnswer,
      conversations: options.conversations,
      persistence: options.persistence,
      overview: options.overview,
      availableTools: available,
      ...(options.planEditor ? { planEditor: options.planEditor } : {})
    });
  };
}
