/**
 * Wiring for the guide aggregator (§30.5).
 *
 * The aggregator itself knows nothing about upstreams; this is where its collectors are bound to
 * the services the rest of the API already uses, so the panel, the assistant and the guide all
 * quote the same data. Each collector returns its own citations, because a source that cannot be
 * named cannot be shown.
 *
 * The Discover context resolves the Wikivoyage article and the region statistics for its own
 * sections and passes them in as a seed, so wiring a guide here costs no extra upstream call.
 */

import { areaWikidataId } from "../ai/areaIdentity.js";
import { localAreaPlaces } from "../ai/areaEvidence.js";
import type { Bbox, EventDocumentV2 } from "@mapos/layer-sdk";
import type { AiCitation } from "../ai/contracts.js";
import type { AiWebTools } from "../ai/webTools.js";
import type { AiToolExecutionContext } from "../ai/toolRegistry.js";
import {
  PRODUCTION_DISCOVER_DEPENDENCIES,
  createDiscoverContextService,
  loadWikipediaPois,
  type DiscoverContextService
} from "../discoverService.js";
import { getPointForecast, getWikidataFacts, getWikipediaArticle } from "../infoService.js";
import {
  createGuideAggregator,
  type GuideAggregator,
  type GuideAreaRef,
  type GuideCollectors,
  type GuideEncyclopediaFact,
  type GuideEventFact,
  type GuideFact,
  type GuidePlaceFact,
  type GuideWeatherFact,
  type GuideWebFact
} from "./guideAggregator.js";

function boundsOf(bbox: Bbox): { west: number; south: number; east: number; north: number } {
  const [west, south, east, north] = bbox;
  return { west, south, east, north };
}

/** A read-only execution context for the web tools, which are written for the AI tool registry.
 *  Nothing here can reach account-private data: the projection is empty on purpose. */
function publicToolContext(signal: AbortSignal): AiToolExecutionContext {
  return {
    actor: {
      authenticated: false,
      permissions: new Set(["web:read"]),
      entitlementIds: new Set()
    },
    projection: {
      allowedLayerIds: new Set(),
      allowedPlanIds: new Set(),
      allowedFeatureFieldsByLayer: new Map(),
      allowedDataClasses: new Set(["public"]),
      allowPreciseLocation: false
    },
    signal
  };
}

function weatherSummary(
  forecast: Awaited<ReturnType<typeof getPointForecast>>
): GuideWeatherFact | null {
  const days = forecast.daily.slice(0, 7).filter((day) => day.max !== null || day.min !== null);
  if (!days.length) return null;
  const line = days
    .map(
      (day) =>
        `${day.date}: ${day.min ?? "?"}–${day.max ?? "?"} °C${
          day.precipitation ? `, ${day.precipitation} mm` : ""
        }`
    )
    .join("; ");
  return { summary: `Předpověď na ${days.length} dní — ${line}`, sourceId: forecast.source.id };
}

/** The collectors a deployment with network access can run. `web` is composed only when the
 *  deployment has the key for it, which keeps "hledala jsem na webu" honest. */
export function createProductionGuideCollectors(
  options: { web?: AiWebTools | null } = {}
): GuideCollectors {
  const collectors: GuideCollectors = {
    async encyclopedia(area, signal) {
      const qid =
        area.wikidataId ??
        (area.selectedArea ? await areaWikidataId(area.selectedArea, signal) : undefined);
      // A common district name is not an encyclopedia identity (e.g. Eixample).
      if (!qid) return { value: [] };
      const article = await getWikipediaArticle({
        qid,
        lang: area.lang,
        signal
      });
      if (!article?.extract.trim()) return { value: [] };
      const sourceId = `wikipedia:${article.lang}:${article.title}`;
      const value: GuideEncyclopediaFact[] = [
        { sourceId, title: article.title, extract: article.extract, url: article.url }
      ];
      return {
        value,
        sources: [
          {
            sourceId,
            label: `Wikipedia (${article.lang})`,
            url: article.url,
            providerId: "wikipedia"
          }
        ]
      };
    },

    async facts(area) {
      if (!area.wikidataId) return { value: [] };
      const entity = await getWikidataFacts(area.wikidataId);
      if (!entity?.facts.length) return { value: [] };
      const sourceId = `wikidata:${entity.qid}`;
      const value: GuideFact[] = entity.facts
        .slice(0, 8)
        .map((fact) => ({ label: fact.label, value: fact.value, sourceId }));
      return {
        value,
        sources: [{ sourceId, label: "Wikidata", url: entity.url, providerId: "wikidata" }]
      };
    },

    async places(area, signal) {
      if (area.selectedArea) {
        const places = await localAreaPlaces(
          area.selectedArea.id,
          area.selectedArea.revision,
          signal
        );
        return {
          value: places.map((p) => ({ ...p, sourceId: "mapos-osm-index" })),
          sources: [
            {
              sourceId: "mapos-osm-index",
              label: "Výběr z neúplného lokálního indexu OpenStreetMap",
              url: "https://www.openstreetmap.org/copyright",
              providerId: "osm"
            }
          ]
        };
      }
      const pois = await loadWikipediaPois(boundsOf(area.bbox));
      if (!pois.length) return { value: [] };
      const value: GuidePlaceFact[] = pois.slice(0, 12).map((poi) => ({
        id: `wikipedia:${poi.pageId}`,
        title: poi.title,
        category: "attraction",
        categoryLabel: "Zajímavost",
        longitude: poi.lng,
        latitude: poi.lat,
        sourceId: "wikipedia-geosearch"
      }));
      return {
        value,
        sources: [
          {
            sourceId: "wikipedia-geosearch",
            label: "Wikipedia (místa v okolí)",
            url: "https://www.wikipedia.org",
            providerId: "wikipedia"
          }
        ]
      };
    },

    async weather(area) {
      if (area.selectedArea) return { value: null };
      const forecast = await getPointForecast(area.center.longitude, area.center.latitude);
      const value = weatherSummary(forecast);
      if (!value) return { value: null };
      return {
        value,
        sources: [
          {
            sourceId: forecast.source.id,
            label: forecast.source.label,
            ...(forecast.source.url ? { url: forecast.source.url } : {}),
            providerId: forecast.source.id
          }
        ]
      };
    }
  };

  const web = options.web;
  if (web) {
    collectors.web = async (area, signal) => {
      const context = publicToolContext(signal);
      const { results } = await web.search(
        { query: `${area.name} co vidět`, maxResults: 5 },
        context
      );
      const value: GuideWebFact[] = [];
      // Two pages read in full is the §30.5 budget: enough for one paragraph of context, small
      // enough that a slow site cannot hold up the panel.
      for (const result of results.slice(0, 2)) {
        try {
          const page = await web.fetch({ url: result.url }, context);
          value.push({
            title: page.title ?? result.title,
            url: page.url,
            excerpt: page.text.slice(0, 1_500)
          });
        } catch {
          value.push(result);
        }
      }
      for (const result of results.slice(2)) value.push(result);
      return {
        value,
        sources: value.map((entry) => ({
          sourceId: entry.url,
          label: entry.title,
          url: entry.url,
          providerId: "web"
        }))
      };
    };
  }

  return collectors;
}

export function createProductionGuideAggregator(
  options: { web?: AiWebTools | null } = {}
): GuideAggregator {
  return createGuideAggregator({ collectors: createProductionGuideCollectors(options) });
}

/** What is on in the area right now. Events are read per request and passed in as a seed rather
 *  than collected, because the written guide is cached for a day and an event is not: a cached
 *  sentence about last weekend's festival is worse than no sentence. */
export interface GuideEventLister {
  (
    area: GuideAreaRef,
    signal?: AbortSignal
  ): Promise<{ events: GuideEventFact[]; sources: AiCitation[] }>;
}

export function createEventServiceGuideLister(service: {
  list(input: {
    bbox: Bbox;
    from: string;
    to: string;
    limit: number;
  }): Promise<{ events: EventDocumentV2[] }>;
}): GuideEventLister {
  return async (area) => {
    const from = new Date();
    const to = new Date(from.getTime() + 14 * 24 * 3_600_000);
    const listing = await service.list({
      bbox: area.bbox,
      from: from.toISOString(),
      to: to.toISOString(),
      limit: 5
    });
    const rows = listing.events.filter((event) => event.sources[0]);
    return {
      events: rows.map((event) => {
        const provenance = event.sources[0]!;
        return {
          id: event.id,
          title: event.title,
          startsAt: event.schedule.startsAt,
          sourceId: `events:${provenance.providerId}`,
          ...(provenance.url ? { url: provenance.url } : {})
        };
      }),
      sources: [
        ...new Map(
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
        ).values()
      ]
    };
  };
}

/**
 * The Discover context with a guide in it.
 *
 * The dependency goes this way — composition knows about the context service, not the other way
 * round — so that `discoverService` keeps its only tie to the guide at the type level and the
 * upstreams a guide reads stay in one file.
 */
export function createGuidedDiscoverContextService(
  options: {
    web?: AiWebTools | null;
    aggregator?: GuideAggregator;
    events?: GuideEventLister | null;
  } = {}
): DiscoverContextService {
  const aggregator = options.aggregator ?? createProductionGuideAggregator(options);
  const listEvents = options.events;
  return createDiscoverContextService({
    ...PRODUCTION_DISCOVER_DEPENDENCIES,
    resolveGuideSynthesis: async (area, seed, callOptions) => {
      // A failing events upstream is one missing section, not a missing guide.
      const events = listEvents
        ? await listEvents(area, callOptions.signal).catch(() => null)
        : null;
      return aggregator.get(area, {
        allowModel: callOptions.allowModel,
        ...(callOptions.signal ? { signal: callOptions.signal } : {}),
        seed: {
          guide: seed.guide,
          ...(events ? { events: events.events } : {}),
          statistics: seed.statistics.map((statistic) => ({
            id: statistic.id,
            label: statistic.label,
            value: statistic.value,
            unit: statistic.unit,
            year: statistic.year,
            uncertaintyLabel: statistic.uncertaintyLabel,
            sourceIds: statistic.sourceIds
          })),
          sources: [
            ...seed.sources.map((source) => ({
              sourceId: source.id,
              label: source.label,
              ...(source.url ? { url: source.url } : {})
            })),
            ...(events?.sources ?? [])
          ]
        }
      });
    }
  });
}
