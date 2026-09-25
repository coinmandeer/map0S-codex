/**
 * The short "what's here" a place gets in its detail.
 *
 * The value is not in the model knowing anything — it is in the model reading what MapOS already
 * fetched and saying it in one breath. A castle pin surrounded by four restaurants, a viewpoint,
 * a car park and a Wikipedia article is a lot to piece together from tabs; two sentences is not.
 *
 * So the brief is grounded, deliberately and strictly: the prompt carries the place, its
 * Wikipedia opening if there is one, and what the fusion pipeline finds within a few hundred
 * metres. The model is told to work from that and nothing else, and the same facts are returned
 * beside the text so a reader can check it against the map. If the model is unreachable the
 * neighbours are still worth showing on their own.
 */

import type { OsmPoiCategoryId, PlaceSourceId } from "@mapos/layer-sdk";
import { OSM_POI_CATEGORIES, PLACE_SOURCE_BY_ID, defaultPlaceSources } from "@mapos/layer-sdk";
import { askCml } from "./cmlService.js";
import { aiPrompt } from "./ai/prompts/index.js";
import { reverseGeocodePlaceName } from "./discoverService.js";
import { getFusedPlaces } from "./poiFusionService.js";
import { getWikidataFacts, getWikipediaArticle } from "./infoService.js";
import { createOllamaWebTools, type AiWebSearchResult } from "./ai/webTools.js";

/** Roughly 400 m at Czech latitudes — walking distance, not "in the same town". */
const RADIUS_DEG_LAT = 0.0036;

/** What makes a useful neighbour: somewhere to go, something to see, something you might need. */
const NEIGHBOUR_CATEGORIES = [
  "castle",
  "viewpoint",
  "museum",
  "monument",
  "ruins",
  "restaurant",
  "cafe",
  "bar",
  "brewery",
  "parking",
  "drinking_water",
  "toilets"
] as const satisfies readonly OsmPoiCategoryId[];

export interface BriefNeighbour {
  name: string;
  category: string;
  categoryLabel: string;
  distanceM: number;
  sources: PlaceSourceId[];
}

export interface BriefCitation {
  sourceId: string;
  label: string;
  url?: string;
  license?: string;
}

export interface PlaceBrief {
  text: string | null;
  model: string | null;
  /** The facts the text was written from — shown under it, and the fallback when text is null. */
  nearby: BriefNeighbour[];
  attribution: string;
  citations: BriefCitation[];
  generation: {
    status: "succeeded" | "unavailable";
    profileId: string | null;
    templateVersion: "poi-brief.v1";
    cached: boolean;
  };
  freshness: { collectedAt: string };
}

export interface BriefQuery {
  lng: number;
  lat: number;
  name?: string;
  category?: string;
  /** Wikidata QID, when the place has one — the surest route to the right article. */
  qid?: string;
  /** Which layer the pin came from. A brief for a charging point and a brief for a castle at the
   *  same coordinates are different questions, and the layer is what says which one was asked. */
  layerId?: string;
  layerName?: string;
  /**
   * Facts the pin itself carries — charging power, observed species, a rating, opening hours.
   *
   * The summary used to be built from the coordinates alone, so two pins a few metres apart, one
   * a bakery and one a bike repair stand, produced the same paragraph about the neighbourhood.
   * These are what make it a summary of *this* pin.
   */
  facts?: Array<{ label: string; value: string }>;
  /** Look the place up on the web as well. Off by default: it costs a round trip, and most of
   *  what a reader needs is already in the data we fetched. */
  web?: boolean;
}

function distanceM(aLng: number, aLat: number, bLng: number, bLat: number): number {
  const R = 6_371_000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = (((bLng - aLng) * Math.PI) / 180) * Math.cos(((aLat + bLat) / 2 / 180) * Math.PI);
  return Math.round(Math.hypot(dLat, dLng) * R);
}

function categoryLabel(category: string): string {
  return OSM_POI_CATEGORIES[category as OsmPoiCategoryId]?.label ?? category;
}

async function neighbours(query: BriefQuery): Promise<BriefNeighbour[]> {
  const lngSpan = RADIUS_DEG_LAT / Math.max(0.2, Math.cos((query.lat * Math.PI) / 180));
  const sources = Object.entries(defaultPlaceSources())
    .filter(([, on]) => on)
    .map(([id]) => id as PlaceSourceId);

  try {
    const fused = await getFusedPlaces({
      bbox: [
        query.lng - lngSpan,
        query.lat - RADIUS_DEG_LAT,
        query.lng + lngSpan,
        query.lat + RADIUS_DEG_LAT
      ],
      categories: [...NEIGHBOUR_CATEGORIES],
      sources
    });
    return (
      fused.places
        // A pin nobody named tells a reader nothing and gives the model nothing to work with,
        // so it is dropped rather than listed as "Bez názvu".
        .filter((p) => p.name?.trim() && p.name !== "Bez názvu")
        .map((p) => ({
          name: p.name,
          category: p.category,
          categoryLabel: categoryLabel(p.category),
          distanceM: distanceM(query.lng, query.lat, p.lng, p.lat),
          sources: [...new Set(p.sources.map((source) => source.source))]
        }))
        // The place itself always turns up in its own neighbourhood.
        .filter((n) => n.distanceM > 15 || n.name !== query.name)
        .sort((a, b) => a.distanceM - b.distanceM)
        .slice(0, 12)
    );
  } catch {
    return [];
  }
}

export function buildBriefCitations(
  nearby: BriefNeighbour[],
  article: { lang: string; title: string; url: string } | null,
  entity: { qid: string; url: string } | null = null
): BriefCitation[] {
  const citations = new Map<string, BriefCitation>();
  for (const neighbour of nearby) {
    for (const sourceId of neighbour.sources) {
      const definition = PLACE_SOURCE_BY_ID[sourceId];
      citations.set(sourceId, {
        sourceId,
        label: definition.label,
        url: definition.url,
        license: definition.license
      });
    }
  }
  if (article) {
    citations.set(`wikipedia:${article.lang}:${article.title}`, {
      sourceId: `wikipedia:${article.lang}:${article.title}`,
      label: `Wikipedia (${article.lang})`,
      url: article.url,
      license: "CC-BY-SA-4.0"
    });
  }
  if (entity) {
    citations.set(`wikidata:${entity.qid}`, {
      sourceId: `wikidata:${entity.qid}`,
      label: "Wikidata",
      url: entity.url,
      license: "CC0-1.0"
    });
  }
  return [...citations.values()];
}

const BRIEF_TEMPLATE_VERSION = "poi-brief.v1";

function prompt(
  query: BriefQuery,
  locality: string | null,
  nearby: BriefNeighbour[],
  extract: string | null,
  facts: readonly { label: string; value: string }[],
  web: readonly AiWebSearchResult[] = []
): string {
  const lines: string[] = [];
  lines.push(
    `Místo: ${query.name ?? "bez názvu"}${query.category ? ` (${categoryLabel(query.category)})` : ""}`
  );
  if (query.layerName) lines.push(`Vrstva: ${query.layerName}`);
  // The pin's own fields, ahead of everything about the neighbourhood: this is the difference
  // between a summary of this place and a summary of this street corner.
  if (query.facts?.length) {
    lines.push("Údaje tohoto bodu:");
    for (const fact of query.facts.slice(0, 12)) lines.push(`- ${fact.label}: ${fact.value}`);
  }
  if (web.length) {
    lines.push("Z webu (uveď zdroj, pokud to použiješ):");
    for (const result of web) {
      lines.push(`- ${result.title} (${result.url}): ${result.excerpt.slice(0, 300)}`);
    }
  }
  if (locality) lines.push(`Obec: ${locality}`);
  if (extract) lines.push(`Z Wikipedie: ${extract.slice(0, 700)}`);
  // Dates, heights and architects come from Wikidata as typed values; a prose extract states them
  // only sometimes, and the model is not allowed to fill the gap from memory.
  if (facts.length) {
    lines.push("Z Wikidat:");
    for (const fact of facts) lines.push(`- ${fact.label}: ${fact.value}`);
  }
  if (nearby.length) {
    lines.push("V okolí do 400 m:");
    for (const n of nearby) lines.push(`- ${n.name} (${n.categoryLabel}, ${n.distanceM} m)`);
  } else {
    lines.push("V okolí do 400 m nemáme v datech nic dalšího.");
  }
  return lines.join("\n");
}

/**
 * What the web says about this place, when the caller asked for it.
 *
 * One search, never a crawl: the model gets excerpts to quote and URLs to cite, and if the tools
 * are not configured the brief is simply built from our own data instead of claiming to have
 * looked anything up.
 */
async function webContext(query: BriefQuery): Promise<AiWebSearchResult[]> {
  if (!query.web || !query.name) return [];
  const tools = createOllamaWebTools();
  if (!tools) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const terms = [
      query.name,
      query.layerName,
      query.category ? categoryLabel(query.category) : null
    ]
      .filter(Boolean)
      .join(" ");
    const { results } = await tools.search(
      { query: terms, maxResults: 3 },
      {
        // A public place's name is the whole query, so this run needs no identity and grants no
        // access: the projection is empty and the search tool reads nothing of ours.
        actor: {
          authenticated: false,
          permissions: new Set<string>(),
          entitlementIds: new Set<string>()
        },
        projection: {
          allowedLayerIds: new Set<string>(),
          allowedPlanIds: new Set<string>(),
          allowedFeatureFieldsByLayer: new Map(),
          allowedDataClasses: new Set<never>(),
          allowPreciseLocation: false
        },
        signal: controller.signal
      }
    );
    return results;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export async function getPlaceBrief(query: BriefQuery): Promise<PlaceBrief> {
  const [nearby, article, locality, entity, web] = await Promise.all([
    neighbours(query),
    query.qid || query.name
      ? getWikipediaArticle({ qid: query.qid, title: query.name }).catch(() => null)
      : Promise.resolve(null),
    reverseGeocodePlaceName(query.lng, query.lat),
    query.qid ? getWikidataFacts(query.qid).catch(() => null) : Promise.resolve(null),
    webContext(query)
  ]);

  const extract = article?.extract?.trim() || null;
  const facts = (entity?.facts ?? []).slice(0, 6);
  const answer = await askCml({
    // The pin's identity is part of the key: without the layer and its own fields, a bakery and
    // the bike stand next to it shared one cached paragraph.
    cacheKey: [
      "brief",
      `${query.lng.toFixed(4)},${query.lat.toFixed(4)}`,
      query.layerId ?? "",
      query.name ?? "",
      (query.facts ?? []).map((fact) => `${fact.label}=${fact.value}`).join(";"),
      web.map((result) => result.url).join(";"),
      nearby.length,
      facts.length
    ].join("|"),
    system: aiPrompt(BRIEF_TEMPLATE_VERSION),
    prompt: prompt(query, locality, nearby, extract, facts, web),
    maxTokens: 2000,
    // Low: the job is to restate the facts it was handed, not to find a nicer way to say them.
    temperature: 0.2,
    // Neighbourhoods change slowly, but not never — a new café should show up within the week.
    ttlMs: 7 * 24 * 3600_000,
    // Everything in the prompt is public: fused POI fields, a Wikipedia extract and a reverse
    // geocode. Without saying so the gateway refuses the run and the summary is never generated.
    verifiedPublic: true
  }).catch(() => null);

  return {
    text: answer?.text ?? null,
    model: answer?.model ?? null,
    nearby,
    attribution: "Zdroje jsou uvedeny jednotlivě v citacích.",
    citations: [
      ...buildBriefCitations(
        nearby,
        article,
        entity && facts.length ? { qid: entity.qid, url: entity.url } : null
      ),
      // A web result that fed the text is cited like any other source, so the reader can check
      // the one part of the brief that did not come from our own pipeline.
      ...web.map((result) => ({
        sourceId: result.url,
        label: result.title,
        url: result.url
      }))
    ],
    generation: {
      status: answer ? "succeeded" : "unavailable",
      profileId: answer?.model ?? null,
      templateVersion: BRIEF_TEMPLATE_VERSION,
      cached: answer?.cached ?? false
    },
    freshness: { collectedAt: new Date().toISOString() }
  };
}
