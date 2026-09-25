/**
 * The Objevuj guide as a synthesis of many sources (§30.5).
 *
 * A Wikivoyage article is a good guide when it exists, which for most of the map it does not. So
 * collection and writing are separated here: every source is collected in parallel behind its own
 * timeout and its own citation, and only then is one of them — or the model reading all of them —
 * asked to produce the panel's text.
 *
 * Two rules make the result trustworthy:
 *
 * 1. **Every claim carries `sourceIds`.** The model writes from `<source>` blocks and submits its
 *    answer through a schema that requires them; ids it did not receive are dropped, and a
 *    highlight left with no id is dropped with them.
 * 2. **Something is always shown.** The fallback chain is synthesis → structured Wikivoyage →
 *    encyclopedia extract → an empty state that still offers an action. A source that times out
 *    is named in `degraded` rather than failing the panel.
 */

import type { Bbox, Guide } from "@mapos/layer-sdk";
import type { AiCitation } from "../ai/contracts.js";
import { aiModelRuntime, type AiModelRuntime } from "../ai/modelRuntime.js";
import { aiPrompt } from "../ai/prompts/index.js";

/** The area a guide is written about: whatever the region resolver knows, projected. */
export interface GuideAreaRef {
  selectedArea?: import("@mapos/layer-sdk").AreaSelection;
  regionId: string;
  name: string;
  level: string;
  lang: string;
  center: { longitude: number; latitude: number };
  bbox: Bbox;
  wikidataId?: string;
  nutsCode?: string;
}

export interface GuideEncyclopediaFact {
  sourceId: string;
  title: string;
  extract: string;
  url?: string;
}

export interface GuideFact {
  label: string;
  value: string;
  sourceId: string;
}

export interface GuidePlaceFact {
  id: string;
  title: string;
  category: string;
  categoryLabel?: string;
  longitude: number;
  latitude: number;
  layerId?: string;
  sourceId: string;
}

export interface GuideStatisticFact {
  id: string;
  label: string;
  value: number;
  unit: string;
  year: number | null;
  uncertaintyLabel?: string;
  sourceIds: string[];
}

export interface GuideEventFact {
  id: string;
  title: string;
  startsAt: string;
  sourceId: string;
  url?: string;
}

export interface GuideWeatherFact {
  summary: string;
  sourceId: string;
}

export interface GuideWebFact {
  title: string;
  url: string;
  excerpt: string;
}

/** What a collector hands back: its data and the citations for it, together. A collector that
 *  cannot cite what it found has found nothing usable. */
export interface GuideCollected<T> {
  value: T;
  sources?: AiCitation[];
}

export interface GuideCollectors {
  guide?(area: GuideAreaRef, signal: AbortSignal): Promise<GuideCollected<Guide | null>>;
  encyclopedia?(
    area: GuideAreaRef,
    signal: AbortSignal
  ): Promise<GuideCollected<GuideEncyclopediaFact[]>>;
  facts?(area: GuideAreaRef, signal: AbortSignal): Promise<GuideCollected<GuideFact[]>>;
  places?(area: GuideAreaRef, signal: AbortSignal): Promise<GuideCollected<GuidePlaceFact[]>>;
  statistics?(
    area: GuideAreaRef,
    signal: AbortSignal
  ): Promise<GuideCollected<GuideStatisticFact[]>>;
  events?(area: GuideAreaRef, signal: AbortSignal): Promise<GuideCollected<GuideEventFact[]>>;
  weather?(
    area: GuideAreaRef,
    signal: AbortSignal
  ): Promise<GuideCollected<GuideWeatherFact | null>>;
  web?(area: GuideAreaRef, signal: AbortSignal): Promise<GuideCollected<GuideWebFact[]>>;
}

export type GuideCollectorId = keyof GuideCollectors;

export interface GuideEvidence {
  area: GuideAreaRef;
  guide: Guide | null;
  encyclopedia: GuideEncyclopediaFact[];
  facts: GuideFact[];
  places: GuidePlaceFact[];
  statistics: GuideStatisticFact[];
  events: GuideEventFact[];
  weather: GuideWeatherFact | null;
  web: GuideWebFact[];
  sources: AiCitation[];
  /** Collectors that failed or ran out of time. Shown as "part of the picture is missing",
   *  never as an error — the rest of the guide is still true. */
  degraded: GuideCollectorId[];
}

export interface GuideHighlight {
  title: string;
  text: string;
  sourceIds: string[];
  place?: { id: string; longitude: number; latitude: number; layerId?: string };
}

export interface GuidePractical {
  arrival?: string;
  bestTime?: string;
  warnings: string[];
}

export interface GuideSynthesis {
  kind: "model" | "structured" | "extract" | "none";
  label: string;
  lead: string;
  leadSourceIds?: string[];
  highlights: GuideHighlight[];
  practical: GuidePractical;
  statistics: GuideStatisticFact[];
  events: GuideEventFact[];
  weather: GuideWeatherFact | null;
  sources: AiCitation[];
  degraded: GuideCollectorId[];
  model?: string;
  /** Present when there is nothing to read yet; §30.5 forbids an empty state without an action. */
  action?: { id: "ask-ai-web"; label: string };
}

const COLLECT_TIMEOUT_MS = 4_000;
const MAX_HIGHLIGHTS = 6;
const MAX_EVENTS = 5;
const MAX_LEAD_CHARS = 400;
const MAX_HIGHLIGHT_TEXT_CHARS = 400;
const SUBMIT_GUIDE_TOOL = "submit_guide";

const GUIDE_TEMPLATE_VERSION = "guide-synthesis.v1";

const SUBMIT_GUIDE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["lead"],
  properties: {
    lead: { type: "string", minLength: 1, maxLength: MAX_LEAD_CHARS },
    highlights: {
      type: "array",
      maxItems: MAX_HIGHLIGHTS,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "text", "sourceIds"],
        properties: {
          title: { type: "string", minLength: 1, maxLength: 120 },
          text: { type: "string", minLength: 1, maxLength: MAX_HIGHLIGHT_TEXT_CHARS },
          sourceIds: { type: "array", maxItems: 6, items: { type: "string", maxLength: 128 } },
          placeId: { type: "string", maxLength: 128 }
        }
      }
    },
    practical: {
      type: "object",
      additionalProperties: false,
      properties: {
        arrival: { type: "string", maxLength: 240 },
        bestTime: { type: "string", maxLength: 240 },
        warnings: { type: "array", maxItems: 3, items: { type: "string", maxLength: 240 } }
      }
    }
  }
} as const;

function safeText(value: unknown, limit: number): string {
  if (typeof value !== "string") return "";
  let clean = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    clean += code <= 31 || code === 127 ? " " : value[index];
  }
  return clean.replace(/\s+/gu, " ").trim().slice(0, limit);
}

function sentences(value: string, count: number): string {
  const parts = value.split(/(?<=[.!?])\s+/u).filter(Boolean);
  return parts.slice(0, count).join(" ").trim();
}

/** Runs one collector with its own deadline. A slow source is a missing source, not a slow panel. */
async function runCollector<T>(
  id: GuideCollectorId,
  collect: (signal: AbortSignal) => Promise<GuideCollected<T>>,
  fallback: T,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  degraded: GuideCollectorId[]
): Promise<GuideCollected<T>> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  try {
    return await collect(controller.signal);
  } catch {
    degraded.push(id);
    return { value: fallback };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

/** What a caller already has and must not be fetched twice. The Discover context resolves the
 *  Wikivoyage guide and the region statistics for its own sections; asking for them again here
 *  would double every upstream call the panel makes. */
export interface GuideEvidenceSeed {
  guide?: Guide | null;
  statistics?: GuideStatisticFact[];
  events?: GuideEventFact[];
  weather?: GuideWeatherFact | null;
  sources?: AiCitation[];
}

/** Collects every configured source in parallel. Unconfigured sources are absent, not empty:
 *  nothing here invents a placeholder for a source this deployment does not have. */
export async function collectGuideEvidence(
  area: GuideAreaRef,
  collectors: GuideCollectors,
  options: {
    signal?: AbortSignal;
    timeoutMs?: number;
    seed?: GuideEvidenceSeed;
    allowWeb?: boolean;
  } = {}
): Promise<GuideEvidence> {
  const timeoutMs = options.timeoutMs ?? COLLECT_TIMEOUT_MS;
  const seed = options.seed ?? {};
  const degraded: GuideCollectorId[] = [];
  const run = <T>(
    id: GuideCollectorId,
    collect: ((area: GuideAreaRef, signal: AbortSignal) => Promise<GuideCollected<T>>) | undefined,
    fallback: T,
    seeded?: T
  ): Promise<GuideCollected<T>> => {
    if (seeded !== undefined) return Promise.resolve({ value: seeded });
    return collect
      ? runCollector(
          id,
          (signal) => collect(area, signal),
          fallback,
          timeoutMs,
          options.signal,
          degraded
        )
      : Promise.resolve({ value: fallback });
  };

  const [guide, encyclopedia, facts, places, statistics, events, weather, web] = await Promise.all([
    run("guide", collectors.guide, null as Guide | null, seed.guide),
    run("encyclopedia", collectors.encyclopedia, [] as GuideEncyclopediaFact[]),
    run("facts", collectors.facts, [] as GuideFact[]),
    run("places", collectors.places, [] as GuidePlaceFact[]),
    run("statistics", collectors.statistics, [] as GuideStatisticFact[], seed.statistics),
    run("events", collectors.events, [] as GuideEventFact[], seed.events),
    run("weather", collectors.weather, null as GuideWeatherFact | null, seed.weather),
    run("web", options.allowWeb === false ? undefined : collectors.web, [] as GuideWebFact[])
  ]);

  const sources = new Map<string, AiCitation>();
  for (const citation of seed.sources ?? []) sources.set(citation.sourceId, { ...citation });
  for (const collected of [guide, encyclopedia, facts, places, statistics, events, weather, web]) {
    for (const citation of collected.sources ?? []) {
      if (!sources.has(citation.sourceId)) sources.set(citation.sourceId, { ...citation });
    }
  }

  return {
    area,
    guide: guide.value,
    encyclopedia: encyclopedia.value,
    facts: facts.value,
    places: places.value,
    statistics: statistics.value,
    events: events.value.slice(0, MAX_EVENTS),
    weather: weather.value,
    web: web.value,
    sources: [...sources.values()],
    degraded
  };
}

/** The `<source>` blocks the model reads. One block per source id, so a claim can name it. */
function sourceBlocks(evidence: GuideEvidence) {
  const blocks: { sourceId: string; label: string; content: string; dataClass: "public" }[] = [];
  const label = (sourceId: string) =>
    evidence.sources.find((source) => source.sourceId === sourceId)?.label ?? sourceId;

  if (evidence.guide) {
    const sourceId = `guide:${evidence.guide.sourceId}`;
    blocks.push({
      sourceId,
      label: label(sourceId),
      dataClass: "public",
      content: evidence.guide.sections
        .slice(0, 8)
        .map((section) =>
          [
            section.title,
            section.intro ? safeText(section.intro, 600) : "",
            ...section.items
              .slice(0, 8)
              .map((item) => `- ${item.name}: ${safeText(item.description ?? "", 200)}`)
          ]
            .filter(Boolean)
            .join("\n")
        )
        .join("\n\n")
    });
  }
  for (const entry of evidence.encyclopedia) {
    blocks.push({
      sourceId: entry.sourceId,
      label: label(entry.sourceId),
      dataClass: "public",
      content: `${entry.title}\n${safeText(entry.extract, 1_200)}`
    });
  }
  if (evidence.facts.length) {
    blocks.push({
      sourceId: "facts",
      label: "Ověřená čísla a fakta",
      dataClass: "public",
      content: evidence.facts
        .map((fact) => `${fact.label}: ${fact.value} [${fact.sourceId}]`)
        .join("\n")
    });
  }
  if (evidence.places.length) {
    blocks.push({
      sourceId: "places",
      label: "Významná místa v oblasti",
      dataClass: "public",
      content: evidence.places
        .slice(0, 20)
        .map(
          (place) =>
            `${place.id} | ${place.title} | ${place.categoryLabel ?? place.category} [${place.sourceId}]`
        )
        .join("\n")
    });
  }
  if (evidence.statistics.length) {
    blocks.push({
      sourceId: "statistics",
      label: "Statistiky oblasti",
      dataClass: "public",
      content: evidence.statistics
        .map(
          (statistic) =>
            `${statistic.label}: ${statistic.value} ${statistic.unit}${statistic.year ? ` (${statistic.year})` : ""} [${statistic.sourceIds.join(", ")}]`
        )
        .join("\n")
    });
  }
  if (evidence.events.length) {
    blocks.push({
      sourceId: "events",
      label: "Události",
      dataClass: "public",
      content: evidence.events
        .map((event) => `${event.title} — ${event.startsAt} [${event.sourceId}]`)
        .join("\n")
    });
  }
  if (evidence.weather) {
    blocks.push({
      sourceId: evidence.weather.sourceId,
      label: label(evidence.weather.sourceId),
      dataClass: "public",
      content: evidence.weather.summary
    });
  }
  for (const page of evidence.web) {
    blocks.push({
      sourceId: page.url,
      label: page.title,
      dataClass: "public",
      content: safeText(page.excerpt, 1_500)
    });
  }
  return blocks;
}

function knownSourceIds(evidence: GuideEvidence): Set<string> {
  const ids = new Set<string>(evidence.sources.map((source) => source.sourceId));
  if (evidence.guide) ids.add(`guide:${evidence.guide.sourceId}`);
  for (const entry of evidence.encyclopedia) ids.add(entry.sourceId);
  for (const statistic of evidence.statistics) statistic.sourceIds.forEach((id) => ids.add(id));
  for (const event of evidence.events) ids.add(event.sourceId);
  for (const place of evidence.places) ids.add(place.sourceId);
  for (const fact of evidence.facts) ids.add(fact.sourceId);
  for (const page of evidence.web) ids.add(page.url);
  if (evidence.weather) ids.add(evidence.weather.sourceId);
  return ids;
}

/** Turns a submission into highlights, keeping only what the evidence backs: an unknown source id
 *  is dropped, and a highlight that loses all of its ids is dropped with them. */
function highlightsFromSubmission(
  submission: Record<string, unknown>,
  evidence: GuideEvidence
): GuideHighlight[] {
  const allowed = knownSourceIds(evidence);
  const byId = new Map(evidence.places.map((place) => [place.id, place]));
  const rows = Array.isArray(submission.highlights) ? submission.highlights : [];
  const highlights: GuideHighlight[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const entry = row as Record<string, unknown>;
    const title = safeText(entry.title, 120);
    const text = safeText(entry.text, MAX_HIGHLIGHT_TEXT_CHARS);
    const sourceIds = (Array.isArray(entry.sourceIds) ? entry.sourceIds : [])
      .filter((id): id is string => typeof id === "string" && allowed.has(id))
      .slice(0, 6);
    if (!title || !text || !sourceIds.length) continue;
    const place = typeof entry.placeId === "string" ? byId.get(entry.placeId) : undefined;
    highlights.push({
      title,
      text,
      sourceIds,
      ...(place
        ? {
            place: {
              id: place.id,
              longitude: place.longitude,
              latitude: place.latitude,
              ...(place.layerId ? { layerId: place.layerId } : {})
            }
          }
        : {})
    });
    if (highlights.length >= MAX_HIGHLIGHTS) break;
  }
  return highlights;
}

function practicalFromSubmission(submission: Record<string, unknown>): GuidePractical {
  const raw =
    typeof submission.practical === "object" && submission.practical !== null
      ? (submission.practical as Record<string, unknown>)
      : {};
  const arrival = safeText(raw.arrival, 240);
  const bestTime = safeText(raw.bestTime, 240);
  const warnings = (Array.isArray(raw.warnings) ? raw.warnings : [])
    .map((entry) => safeText(entry, 240))
    .filter(Boolean)
    .slice(0, 3);
  return {
    ...(arrival ? { arrival } : {}),
    ...(bestTime ? { bestTime } : {}),
    warnings
  };
}

/** Asks the fast model to write the guide from the collected sources. Returns `null` whenever the
 *  model is unavailable, refuses or submits nothing usable — the caller then falls back. */
export async function synthesizeGuide(
  evidence: GuideEvidence,
  options: { runtime?: AiModelRuntime; signal?: AbortSignal } = {}
): Promise<GuideSynthesis | null> {
  const runtime = options.runtime ?? aiModelRuntime();
  if (!runtime.enabled) return null;
  const blocks = sourceBlocks(evidence);
  if (!blocks.length) return null;

  for (const profile of runtime.profiles("fast")) {
    const outcome = await runtime.gateway.turn({
      taskId: "guide-synthesis",
      templateVersion: GUIDE_TEMPLATE_VERSION,
      system: aiPrompt(GUIDE_TEMPLATE_VERSION, { submitTool: SUBMIT_GUIDE_TOOL }),
      prompt: [
        `Oblast: ${evidence.area.name} (${evidence.area.level})`,
        "Napiš úvodní větu (lead), nejvýše šest highlightů a praktické informace.",
        "Highlight bez zdroje nepiš."
      ].join("\n"),
      profile,
      permissionPartition: `guide:${evidence.area.regionId}`,
      sourceBlocks: blocks,
      tools: [
        {
          name: SUBMIT_GUIDE_TOOL,
          description: "Odevzdej průvodce oblastí.",
          parameters: SUBMIT_GUIDE_SCHEMA as unknown as Record<string, unknown>
        }
      ],
      toolChoice: { name: SUBMIT_GUIDE_TOOL },
      temperature: 0.2,
      ...(options.signal ? { signal: options.signal } : {})
    });
    if (outcome.status !== "succeeded") continue;
    const submission = outcome.toolCalls.find((call) => call.name === SUBMIT_GUIDE_TOOL);
    if (!submission) continue;
    const lead = safeText(submission.arguments.lead, MAX_LEAD_CHARS);
    if (!lead) continue;
    const highlights = highlightsFromSubmission(submission.arguments, evidence);
    return {
      kind: "model",
      label: "Souhrn ze zdrojů",
      lead,
      highlights,
      practical: practicalFromSubmission(submission.arguments),
      statistics: evidence.statistics,
      events: evidence.events,
      weather: evidence.weather,
      sources: evidence.sources,
      degraded: evidence.degraded,
      model: profile.model
    };
  }
  return null;
}

/** Wikivoyage without a model: its lead is the lead, its listings are the highlights. Every
 *  claim then cites the article it was copied from, which is exactly what it is. */
function structuredGuide(evidence: GuideEvidence): GuideSynthesis | null {
  const guide = evidence.guide;
  if (!guide) return null;
  const sourceId = `guide:${guide.sourceId}`;
  const understand = guide.sections.find((section) => section.id === "understand");
  const lead = safeText(
    understand?.intro ?? understand?.items[0]?.description ?? "",
    MAX_LEAD_CHARS
  );
  const highlights = guide.sections
    .filter((section) => section.id !== "understand")
    .flatMap((section) =>
      section.items.map((item) => ({
        title: safeText(item.name, 120),
        text:
          safeText(item.description ?? section.title, MAX_HIGHLIGHT_TEXT_CHARS) || section.title,
        sourceIds: [sourceId],
        ...(typeof item.lng === "number" && typeof item.lat === "number"
          ? { place: { id: item.sourceRef, longitude: item.lng, latitude: item.lat } }
          : {})
      }))
    )
    .filter((highlight) => highlight.title)
    .slice(0, MAX_HIGHLIGHTS);
  if (!lead && !highlights.length) return null;
  return {
    kind: "structured",
    label: `Průvodce ${guide.attribution}`,
    lead: lead || `${evidence.area.name}: ${highlights.length} tipů z průvodce.`,
    leadSourceIds: [sourceId],
    highlights,
    practical: { warnings: [] },
    statistics: evidence.statistics,
    events: evidence.events,
    weather: evidence.weather,
    sources: evidence.sources,
    degraded: evidence.degraded
  };
}

/** Last thing that still says something: an encyclopedia opening plus whatever notable places the
 *  map already knows about. */
function extractGuide(evidence: GuideEvidence): GuideSynthesis | null {
  const entry = evidence.encyclopedia.find((candidate) => candidate.extract.trim());
  if (!entry) return null;
  return {
    kind: "extract",
    label: "Z encyklopedie",
    lead: sentences(safeText(entry.extract, 1_200), 2).slice(0, MAX_LEAD_CHARS),
    leadSourceIds: [entry.sourceId],
    highlights: evidence.places.slice(0, MAX_HIGHLIGHTS).map((place) => ({
      title: place.title,
      text: place.categoryLabel ?? place.category,
      sourceIds: [place.sourceId],
      place: {
        id: place.id,
        longitude: place.longitude,
        latitude: place.latitude,
        ...(place.layerId ? { layerId: place.layerId } : {})
      }
    })),
    practical: { warnings: [] },
    statistics: evidence.statistics,
    events: evidence.events,
    weather: evidence.weather,
    sources: evidence.sources,
    degraded: evidence.degraded
  };
}

function emptyGuide(evidence: GuideEvidence): GuideSynthesis {
  return {
    kind: "none",
    label: "Bez podkladů",
    lead: "",
    highlights: [],
    practical: { warnings: [] },
    statistics: evidence.statistics,
    events: evidence.events,
    weather: evidence.weather,
    sources: evidence.sources,
    degraded: evidence.degraded,
    action: { id: "ask-ai-web", label: "Zeptat se AI (web)" }
  };
}

/** The fallback chain of §30.5, in one place so the panel never has to know which link answered. */
export async function buildGuideSynthesis(
  evidence: GuideEvidence,
  options: { runtime?: AiModelRuntime; allowModel?: boolean; signal?: AbortSignal } = {}
): Promise<GuideSynthesis> {
  if (options.allowModel !== false) {
    const synthesis = await synthesizeGuide(evidence, options).catch(() => null);
    if (synthesis) return synthesis;
  }
  return structuredGuide(evidence) ?? extractGuide(evidence) ?? emptyGuide(evidence);
}

export interface GuideAggregator {
  get(
    area: GuideAreaRef,
    options?: { allowModel?: boolean; signal?: AbortSignal; seed?: GuideEvidenceSeed }
  ): Promise<GuideSynthesis>;
  clear(): void;
}

const MAX_CACHE_ENTRIES = 128;

/** Cache key of §30.5: the same region, in the same language, in the same month. Events and
 *  weather move faster than that, which is why the panel keeps its own live sections. */
export function guideCacheKey(area: GuideAreaRef, allowModel: boolean, now: number): string {
  const month = new Date(now).toISOString().slice(0, 7);
  return [area.regionId, area.lang, month, allowModel ? "model" : "structured"].join("|");
}

/** The written parts of a guide keep for a day; numbers, events and weather do not. A cache hit
 *  therefore takes the live sections from the current request instead of the stored ones. */
function withSeed(synthesis: GuideSynthesis, seed: GuideEvidenceSeed | undefined): GuideSynthesis {
  if (!seed) return synthesis;
  return {
    ...synthesis,
    ...(seed.statistics ? { statistics: seed.statistics } : {}),
    ...(seed.events ? { events: seed.events.slice(0, MAX_EVENTS) } : {}),
    ...(seed.weather === undefined ? {} : { weather: seed.weather })
  };
}

export function createGuideAggregator(options: {
  collectors: GuideCollectors;
  runtime?: AiModelRuntime;
  now?: () => number;
  ttlMs?: number;
  timeoutMs?: number;
}): GuideAggregator {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? 24 * 3_600_000;
  const cache = new Map<string, { expiresAt: number; value: GuideSynthesis }>();
  const pending = new Map<string, Promise<GuideSynthesis>>();

  return {
    async get(area, callOptions = {}) {
      const allowModel = callOptions.allowModel !== false;
      const key = guideCacheKey(area, allowModel, now());
      const cached = cache.get(key);
      if (cached && cached.expiresAt > now()) return withSeed(cached.value, callOptions.seed);
      const existing = pending.get(key);
      if (existing) return existing;

      const work = (async () => {
        const evidence = await collectGuideEvidence(area, options.collectors, {
          allowWeb: allowModel,
          ...(callOptions.signal ? { signal: callOptions.signal } : {}),
          ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
          ...(callOptions.seed ? { seed: callOptions.seed } : {})
        });
        const synthesis = await buildGuideSynthesis(evidence, {
          allowModel,
          ...(options.runtime ? { runtime: options.runtime } : {}),
          ...(callOptions.signal ? { signal: callOptions.signal } : {})
        });
        // An empty guide is not worth a day of cache: the sources it lacked may come back.
        if (synthesis.kind !== "none") {
          if (cache.size >= MAX_CACHE_ENTRIES) {
            const oldest = cache.keys().next().value;
            if (oldest) cache.delete(oldest);
          }
          cache.set(key, { expiresAt: now() + ttlMs, value: synthesis });
        }
        return synthesis;
      })().finally(() => pending.delete(key));

      pending.set(key, work);
      return work;
    },
    clear() {
      cache.clear();
      pending.clear();
    }
  };
}
