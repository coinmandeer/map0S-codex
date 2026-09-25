/**
 * Golden evals for the assistant (§30.9).
 *
 * Thirty questions in the language users actually type, each with the routing it must produce:
 * the intent the router assigns, the tools the composition has to offer for that question, the
 * submission tool the turn ends with, and — where it matters — the tool that must stay hidden.
 *
 * The offline harness proves the contract the model is given, not the model's taste: it runs the
 * real chat service over fixture providers with a scripted adapter, so a wrong intent, a tool
 * that silently stopped being composed, a permission gate that opened, or a prompt that stopped
 * reaching the provider all fail here without a network call. Whether a *real* model then picks
 * from those tools is what the optional live eval (`MAPOS_AI_LIVE_EVAL=1`) is for.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { AiChatIntent } from "../chatService.js";
import type { AiChatToolProviders } from "../chatTools.js";
import { createFixtureChatToolProviders } from "../chatComposition.js";
import { createOfflineDiscoverContextService } from "../../discoverService.js";
import { aiCategoryToolIds, inferAiCategories } from "../placeSearch.js";
import { MAP_AI_TOOL_NAMES } from "../toolCatalog.js";
import type { MemoryPlaceFixture } from "../placeSearch.js";

const SUBMISSION_TOOLS = [
  "submit_answer",
  "emit_layer",
  "submit_plan",
  "apply_plan_commands",
  "select_layers"
] as const;

const INTENTS: readonly AiChatIntent[] = [
  "place",
  "layer_query",
  "question",
  "plan",
  "edit_plan",
  "layer_create",
  "command"
];

export interface AiChatEvalCase {
  id: string;
  query: string;
  intent: AiChatIntent;
  /** Tools that must be offered to the model for this question, the first one being the tool the
   *  offline harness actually runs through the loop. */
  tools: readonly string[];
  submit: (typeof SUBMISSION_TOOLS)[number];
  /** Tools that must not be offered — the gate this question exists to guard. */
  forbidden?: readonly string[];
  /** The turn happens with a plan open and owned by the asker. */
  openPlan?: boolean;
}

const here = dirname(fileURLToPath(import.meta.url));
const DIRECTORIES = [here, resolve(here, "../../../../src/services/ai/evals")];

function readEvalFile(file: string): string {
  for (const directory of DIRECTORIES) {
    try {
      return readFileSync(resolve(directory, file), "utf8");
    } catch {
      // Try the next location; a genuinely missing file is reported below.
    }
  }
  throw new Error(`AI eval file ${file} is missing`);
}

function asStringArray(value: unknown, field: string, id: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`Eval case ${id} has an invalid ${field}`);
  }
  return value as string[];
}

/** A malformed row is a broken test suite, so parsing is strict: unknown tools and unknown
 *  intents fail at load time instead of turning into a passing assertion about nothing. */
function parseCase(line: string, index: number): AiChatEvalCase {
  const raw = JSON.parse(line) as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id : `line-${index + 1}`;
  if (typeof raw.query !== "string" || !raw.query.trim()) {
    throw new Error(`Eval case ${id} has no query`);
  }
  if (!INTENTS.includes(raw.intent as AiChatIntent)) {
    throw new Error(`Eval case ${id} has an unknown intent`);
  }
  if (!SUBMISSION_TOOLS.includes(raw.submit as (typeof SUBMISSION_TOOLS)[number])) {
    throw new Error(`Eval case ${id} has an unknown submission tool`);
  }
  const tools = asStringArray(raw.tools, "tools", id);
  const forbidden =
    raw.forbidden === undefined ? [] : asStringArray(raw.forbidden, "forbidden", id);
  for (const tool of tools) {
    if (!(MAP_AI_TOOL_NAMES as readonly string[]).includes(tool)) {
      throw new Error(`Eval case ${id} names a tool the catalog does not have: ${tool}`);
    }
  }
  // A forbidden tool may also be a submission tool — that is the gate `edit_plan` guards.
  const known = [...MAP_AI_TOOL_NAMES, ...SUBMISSION_TOOLS] as readonly string[];
  for (const tool of forbidden) {
    if (!known.includes(tool)) {
      throw new Error(`Eval case ${id} forbids a tool nothing can offer: ${tool}`);
    }
  }
  if (!tools.length) throw new Error(`Eval case ${id} expects no tool at all`);
  return {
    id,
    query: raw.query,
    intent: raw.intent as AiChatIntent,
    tools,
    submit: raw.submit as (typeof SUBMISSION_TOOLS)[number],
    ...(forbidden.length ? { forbidden } : {}),
    ...(raw.openPlan === true ? { openPlan: true } : {})
  };
}

export function loadAiChatEvalCases(file = "chat-tools.jsonl"): AiChatEvalCase[] {
  const cases = readEvalFile(file)
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseCase);
  const ids = new Set(cases.map((entry) => entry.id));
  if (ids.size !== cases.length) throw new Error(`AI eval file ${file} has duplicate ids`);
  return cases;
}

export const EVAL_MAP_CENTER = { longitude: 13.3775, latitude: 49.7475 } as const;
export const EVAL_LAYER_IDS = ["osm-poi", "events"] as const;

/** Fixtures covering the categories the questions name, in one small town so distances stay
 *  short and every answer is reproducible. */
export const EVAL_PLACE_FIXTURES: readonly MemoryPlaceFixture[] = [
  { osmId: "node/1", category: "camp_site", name: "Kemp U Řeky", lng: 13.379, lat: 49.749 },
  { osmId: "node/2", category: "camp_site", name: "Kemp Na Kopci", lng: 13.4, lat: 49.76 },
  { osmId: "node/3", category: "caravan_site", name: "Autokemp Borek", lng: 13.371, lat: 49.744 },
  { osmId: "node/4", category: "bar", name: "Bar U Mostu", lng: 13.378, lat: 49.748 },
  { osmId: "node/5", category: "cafe", name: "Kavárna Na Náměstí", lng: 13.3762, lat: 49.7478 },
  { osmId: "node/6", category: "brewery", name: "Pivovar Na Hrázi", lng: 13.3801, lat: 49.7503 },
  { osmId: "node/7", category: "viewpoint", name: "Vyhlídka Na Skále", lng: 13.39, lat: 49.755 },
  {
    osmId: "node/8",
    category: "observation_tower",
    name: "Rozhledna Chlum",
    lng: 13.41,
    lat: 49.765
  },
  { osmId: "node/9", category: "castle", name: "Hrad Radyně", lng: 13.4, lat: 49.7 },
  { osmId: "node/10", category: "museum", name: "Muzeum města", lng: 13.3766, lat: 49.7471 },
  { osmId: "node/11", category: "fuel", name: "Čerpací stanice Jižní", lng: 13.374, lat: 49.741 },
  {
    osmId: "node/12",
    category: "drinking_water",
    name: "Pitná voda U Parku",
    lng: 13.377,
    lat: 49.746
  },
  { osmId: "node/13", category: "lake", name: "Přehrada České údolí", lng: 13.36, lat: 49.71 },
  {
    osmId: "node/14",
    category: "parking",
    name: "Parkoviště U Stadionu",
    lng: 13.3822,
    lat: 49.7461
  }
];

/**
 * Everything an eval question can reach, all in memory.
 *
 * The fixture composition covers places, layers and the web; weather, routing, events and saved
 * places are stubbed here in the same shapes the production providers return, so a question about
 * rain or driving time can be routed and executed without a provider or a network call.
 */
export function createEvalChatProviders(): AiChatToolProviders {
  const providers = createFixtureChatToolProviders({
    fixtures: () => EVAL_PLACE_FIXTURES,
    layerIds: EVAL_LAYER_IDS,
    discover: createOfflineDiscoverContextService()
  });

  providers.queryLayer = async (input) => ({
    features: [
      {
        id: `${input.layerId}-1`,
        layerId: input.layerId,
        title: "Prvek z fixture vrstvy",
        longitude: EVAL_MAP_CENTER.longitude,
        latitude: EVAL_MAP_CENTER.latitude,
        sourceId: `layer:${input.layerId}`
      }
    ],
    sources: [
      {
        sourceId: `layer:${input.layerId}`,
        label: `Vrstva ${input.layerId} (fixture)`,
        providerId: "fixture"
      }
    ]
  });

  providers.featureDetail = async (input) => ({
    feature: {
      id: input.featureId,
      layerId: input.layerId,
      fields: { name: "Prvek z fixture vrstvy", category: "camp_site" }
    },
    sources: [{ sourceId: `layer:${input.layerId}`, label: `Vrstva ${input.layerId} (fixture)` }]
  });

  providers.savedPlaces = async () => ({
    places: [
      {
        id: "saved-1",
        title: "Uložené místo (fixture)",
        longitude: EVAL_MAP_CENTER.longitude,
        latitude: EVAL_MAP_CENTER.latitude
      }
    ]
  });

  providers.weather = async (input) => ({
    at: input.at,
    summary: "Skoro jasno",
    temperatureC: 18,
    source: { sourceId: "weather:fixture", label: "Fixture předpověď", providerId: "fixture" }
  });

  providers.route = async (input) => ({
    distanceMeters: 42_000,
    durationSeconds: 2_700,
    geometry: [input.from, input.to],
    source: { sourceId: "routing:fixture", label: "Fixture routing", providerId: "fixture" }
  });

  providers.events = async () => ({
    events: [
      {
        id: "event-1",
        layerId: "events",
        title: "Fixture koncert",
        startsAt: "2026-09-05T18:00:00.000Z",
        sourceId: "events:fixture"
      }
    ],
    sources: [{ sourceId: "events:fixture", label: "Fixture kalendář akcí", providerId: "fixture" }]
  });

  return providers;
}

/**
 * Arguments for the tool an eval case runs, derived from the question and the fixed map centre.
 *
 * They exist so the harness can drive the real loop: the scripted adapter names the tool, these
 * arguments make the call schema-valid, and the registry then executes the production handler.
 */
export function evalToolArguments(tool: string, query: string): Record<string, unknown> {
  const categories = inferAiCategories(query);
  const category = categories[0] ?? aiCategoryToolIds()[0]!;
  const near = { longitude: EVAL_MAP_CENTER.longitude, latitude: EVAL_MAP_CENTER.latitude };
  const bbox = [13.2, 49.6, 13.6, 49.9];

  switch (tool) {
    case "get_current_map_context":
    case "list_available_layers":
      return {};
    case "search_places":
      return {
        categories: categories.length ? [...categories] : [category],
        near,
        radiusMeters: 15_000,
        limit: 5
      };
    case "find_nearest_poi":
      return {
        reference: { source: "map-center", ...near },
        layerIds: ["osm-poi"],
        category,
        activeFilters: {},
        radiusMeters: 15_000,
        limit: 5
      };
    case "query_layer":
      return { layerId: "osm-poi", bbox, limit: 5 };
    case "get_feature_detail":
      return { layerId: "osm-poi", featureId: "osm-poi-1", fields: ["name", "category"] };
    case "query_saved_places":
      return { query: "kemp", limit: 5 };
    case "route_segment":
      return { from: near, to: { longitude: 13.2, latitude: 49.6 }, profile: "car" };
    case "get_weather":
      return { point: near, at: "2026-09-03T12:00:00.000Z" };
    case "search_events":
      return {
        layerIds: ["events"],
        bbox,
        from: "2026-09-02T00:00:00.000Z",
        to: "2026-09-09T00:00:00.000Z",
        limit: 5
      };
    case "get_region_context":
      return { point: near, zoom: 12 };
    case "get_stats":
      return { point: near, zoom: 12 };
    case "web_search":
      return { query, maxResults: 3 };
    case "web_fetch":
      return { url: "https://fixture.test/kempy" };
    default:
      throw new Error(`No eval arguments for tool ${tool}`);
  }
}
