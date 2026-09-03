/**
 * `POST /v2/ai/chat` behind one service (§30.3, §30.4).
 *
 * The shape of a turn: a heuristic router decides whether a question needs the map, the tools or
 * neither; a bounded tool loop lets the fast model ask the server for data it is allowed to see;
 * the answer comes back as a forced `submit_answer` tool call, so it always has text, cards and the
 * sources those cards came from. Nothing here writes: every card is a proposal the user applies.
 *
 * Two properties are deliberate and load-bearing:
 *
 * 1. **The deterministic path is not a stub.** With no model key, no consent or a provider outage,
 *    the same categories are inferred from the question, the same `search_places` tool runs and the
 *    answer is a template over real sourced places. The offline e2e profile takes this path.
 * 2. **Only the registry talks to data.** The loop never reads a repository directly, so a tool the
 *    model was not allowed to call cannot be reached by asking nicely.
 */

import { randomUUID } from "node:crypto";
import type { Bbox, LayerManifestV2 } from "@mapos/layer-sdk";
import type { AiChatTurn, AiCitation, AiDataClass, AiToolSpec } from "./contracts.js";
import {
  AiConversationStore,
  ConversationNotFoundError,
  ConversationRevisionError,
  type AiConversation,
  type AiConversationScope
} from "./conversation.js";
import { aiModelRuntime, type AiModelRuntime } from "./modelRuntime.js";
import { aiCategoryLabel, bboxAround, inferAiCategories } from "./placeSearch.js";
import type { AiPlaceSearchOutput, AiPlaceSearchRecord } from "./placeSearch.js";
import { buildInlineLayerManifest, inlineLayerFeatureCount } from "./inlineLayer.js";
import { aiPrompt } from "./prompts/index.js";
import type { AiPlanDiff } from "./planProposal.js";
import type {
  AiToolActor,
  AiToolPermissionProjection,
  AiToolRegistry,
  AiToolStatus
} from "./toolRegistry.js";

const MAX_MESSAGE_CHARS = 2_000;
const MAX_TOOL_ROUNDS = 6;
const MAX_TOOL_CALLS_PER_ROUND = 3;
const MAX_TOOL_RESULT_CHARS = 6_000;
const MAX_PLACE_CARD_ITEMS = 8;
const SUBMIT_ANSWER_TOOL = "submit_answer";
const EMIT_LAYER_TOOL = "emit_layer";
const SUBMIT_PLAN_TOOL = "submit_plan";
const APPLY_PLAN_COMMANDS_TOOL = "apply_plan_commands";
const SELECT_LAYERS_TOOL = "select_layers";

/** What the browser knows about the current view. The server re-derives everything it acts on:
 *  a layer id here is a request, and the projection decides whether it is granted. */
export interface AiChatContext {
  mapCenter: { longitude: number; latitude: number };
  bbox?: Bbox;
  zoom: number;
  activeLayerIds: readonly string[];
  activeFilters?: { openNow?: boolean; minRating?: number; tags?: readonly string[] };
  mode?: string;
  planId?: string;
  featureRef?: { layerId: string; featureId: string };
  regionRef?: string;
}

export interface AiChatConsent {
  externalModel: boolean;
  preciseLocation: boolean;
}

export interface AiChatRequest {
  ownerUserId: string;
  message: string;
  messageDataClass: AiDataClass;
  context: AiChatContext;
  consent: AiChatConsent;
  conversation:
    | { mode: "new"; scope: AiConversationScope }
    | { mode: "existing"; conversationId: string; baseRevision: number };
  actor: AiToolActor;
  projection: AiToolPermissionProjection;
  signal?: AbortSignal;
}

export type AiChatIntent =
  "place" | "layer_query" | "question" | "plan" | "edit_plan" | "layer_create" | "command";

export interface AiChatPlaceCard {
  type: "places";
  title: string;
  places: AiPlaceSearchRecord[];
  /** Layers the client has to switch on before these pins can be shown. */
  layerIds: string[];
}

export interface AiChatLinkCard {
  type: "link";
  title: string;
  url: string;
  excerpt?: string;
}

export interface AiChatLayerCard {
  type: "layer";
  title: string;
  layerIds: string[];
  filters?: Record<string, unknown>;
}

/** A layer the user can switch on, carrying its own data and its own attribution (§30.7). It is
 *  a proposal: nothing is registered or saved until the user says so. */
export interface AiChatLayerDraftCard {
  type: "layer-draft";
  title: string;
  layerId: string;
  manifest: LayerManifestV2;
  featureCount: number;
}

/** A plan the user can open in Plánování. Every stop keeps the source of the place it is. */
export interface AiChatPlanCard {
  type: "plan";
  title: string;
  summary: string;
  stops: {
    title: string;
    longitude: number;
    latitude: number;
    day?: number;
    note?: string;
    sourceId: string;
  }[];
}

/** An edit to an existing plan, as a diff waiting for confirmation (§30.8). */
export interface AiChatPlanEditCard {
  type: "plan-edit";
  title: string;
  proposalId: string;
  planId: string;
  diff: AiPlanDiff;
}

/** Numbers with their year and source, never rounded into prose: a statistic without its vintage
 *  is a statistic the reader cannot check (§30.5). */
export interface AiChatFactsCard {
  type: "facts";
  title: string;
  items: { label: string; value: string; note?: string; sourceIds: string[] }[];
}

export type AiChatCard =
  | AiChatPlaceCard
  | AiChatLinkCard
  | AiChatLayerCard
  | AiChatFactsCard
  | AiChatLayerDraftCard
  | AiChatPlanCard
  | AiChatPlanEditCard;

export interface AiChatAnswer {
  execution: "model-tool-loop" | "deterministic";
  intent: AiChatIntent;
  text: string;
  cards: AiChatCard[];
  sources: AiCitation[];
  followUps: string[];
  model?: string;
}

export type AiChatEvent =
  | { type: "intent"; intent: AiChatIntent; execution: AiChatAnswer["execution"] }
  | { type: "token"; text: string }
  | { type: "tool_start"; tool: string; title: string }
  | { type: "tool_result"; tool: string; status: AiToolStatus }
  | { type: "card"; card: AiChatCard }
  | {
      type: "done";
      answer: AiChatAnswer;
      conversation: { id: string; revision: number; scope: AiConversationScope };
    }
  | { type: "error"; code: AiChatErrorCode; message: string };

export type AiChatErrorCode =
  "invalid-request" | "policy-denied" | "conversation-unavailable" | "answer-unavailable";

export type AiChatEmit = (event: AiChatEvent) => void | Promise<void>;

const CHAT_TEMPLATE_VERSION = "ai-chat-turn.v1";

/** The structured answer, delivered as a tool call because the cloud ignores JSON-schema output
 *  but honours a forced tool (§30.2). */
const SUBMIT_ANSWER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["text"],
  properties: {
    text: { type: "string", minLength: 1, maxLength: 4_000 },
    placeIds: {
      type: "array",
      maxItems: MAX_PLACE_CARD_ITEMS,
      items: { type: "string", minLength: 1, maxLength: 128 },
      description: "Identifikátory míst z výsledků nástrojů, v pořadí, v jakém je chceš zobrazit."
    },
    followUps: {
      type: "array",
      maxItems: 3,
      items: { type: "string", minLength: 1, maxLength: 120 }
    }
  }
} as const;

/** `emit_layer`: a name and a selection of places the loop already saw (§30.7). The model does
 *  not describe a data source, because a described source is one nobody can check. */
const EMIT_LAYER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "text", "placeIds"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 80 },
    text: { type: "string", minLength: 1, maxLength: 2_000 },
    description: { type: "string", maxLength: 400 },
    placeIds: {
      type: "array",
      minItems: 1,
      maxItems: 200,
      items: { type: "string", minLength: 1, maxLength: 128 },
      description: "Identifikátory míst z výsledků nástrojů, která mají být ve vrstvě."
    },
    followUps: {
      type: "array",
      maxItems: 3,
      items: { type: "string", minLength: 1, maxLength: 120 }
    }
  }
} as const;

/** `submit_plan`: stops picked from tool results, optionally spread over days. */
const SUBMIT_PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "text", "stops"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 80 },
    text: { type: "string", minLength: 1, maxLength: 2_000 },
    stops: {
      type: "array",
      minItems: 1,
      maxItems: 40,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["placeId"],
        properties: {
          placeId: { type: "string", minLength: 1, maxLength: 128 },
          day: { type: "integer", minimum: 1, maximum: 30 },
          note: { type: "string", maxLength: 240 }
        }
      }
    },
    followUps: {
      type: "array",
      maxItems: 3,
      items: { type: "string", minLength: 1, maxLength: 120 }
    }
  }
} as const;

/** `select_layers`: the answer to "zapni mi vrstvy pro…" (§4.13). The model may only name layers
 *  a tool listed for this user, and the client applies the selection — the server never toggles
 *  anything on somebody's map. */
const SELECT_LAYERS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["text", "title", "layerIds"],
  properties: {
    text: { type: "string", minLength: 1, maxLength: 2_000 },
    title: { type: "string", minLength: 1, maxLength: 80 },
    layerIds: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: { type: "string", minLength: 1, maxLength: 128 },
      description: "Identifikátory vrstev z list_available_layers, které se mají zapnout."
    },
    filters: {
      type: "object",
      additionalProperties: false,
      properties: {
        openNow: { type: "boolean" },
        minRating: { type: "number", minimum: 0, maximum: 5 },
        tags: {
          type: "array",
          maxItems: 8,
          items: { type: "string", minLength: 1, maxLength: 64 }
        }
      }
    },
    followUps: {
      type: "array",
      maxItems: 3,
      items: { type: "string", minLength: 1, maxLength: 120 }
    }
  }
} as const;

/**
 * `apply_plan_commands`: an edit vocabulary, not raw plan commands (§30.8).
 *
 * The store would validate a hand-written `PlanCommandV2` too, but a fast model writing envelope
 * JSON spends its attention on the shape instead of on the edit. Four operations cover what a
 * chat asks for, and the server translates them into one batch command whose diff the user sees
 * before anything is applied.
 */
const APPLY_PLAN_COMMANDS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["text", "summary", "edits"],
  properties: {
    text: { type: "string", minLength: 1, maxLength: 2_000 },
    summary: { type: "string", minLength: 1, maxLength: 240 },
    edits: {
      type: "array",
      minItems: 1,
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["op"],
        properties: {
          op: { enum: ["add-stop", "remove-stop", "move-stop", "rename-plan"] },
          placeId: { type: "string", minLength: 1, maxLength: 128 },
          stopId: { type: "string", minLength: 1, maxLength: 128 },
          atIndex: { type: "integer", minimum: 0, maximum: 200 },
          toIndex: { type: "integer", minimum: 0, maximum: 200 },
          note: { type: "string", maxLength: 240 },
          name: { type: "string", minLength: 1, maxLength: 120 }
        }
      }
    },
    followUps: {
      type: "array",
      maxItems: 3,
      items: { type: "string", minLength: 1, maxLength: 120 }
    }
  }
} as const;

export interface AiChatPlanEdit {
  op: "add-stop" | "remove-stop" | "move-stop" | "rename-plan";
  placeId?: string;
  stopId?: string;
  atIndex?: number;
  toIndex?: number;
  note?: string;
  name?: string;
}

/** What the chat needs in order to propose an edit: a proposal it can describe, never a write. */
export interface AiChatPlanEditor {
  propose(input: {
    ownerUserId: string;
    planId: string;
    conversationId: string;
    summary: string;
    edits: readonly AiChatPlanEdit[];
    places: readonly AiPlaceSearchRecord[];
    citations: readonly AiCitation[];
    signal?: AbortSignal;
  }): Promise<{ proposalId: string; planId: string; diff: AiPlanDiff }>;
}

function hasDisallowedControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 8 || (code >= 11 && code <= 12) || (code >= 14 && code <= 31)) return true;
  }
  return false;
}

function validMessage(value: string): string | null {
  const message = value.trim();
  if (!message || message.length > MAX_MESSAGE_CHARS || hasDisallowedControl(message)) return null;
  return message;
}

/**
 * Whole-word alternatives for any script.
 *
 * `\b` is defined on ASCII word characters, so `\bzkrať\b` never matches: the boundary after "ť"
 * sits between two characters JavaScript both considers non-word. Czech imperatives end in those
 * letters more often than not, which silently cost the router "zkrať", "změň", "proč" and "čím".
 */
function wholeWords(...words: readonly string[]): RegExp {
  return new RegExp(`(?<!\\p{L})(?:${words.join("|")})(?!\\p{L})`, "u");
}

/**
 * The server half of the intent router (§30.4 point 1).
 *
 * The client already ran the same kind of heuristic for instant feedback; this either confirms it
 * or overrides it. It is deliberately keyword-based and offline: a router that needs a network
 * round trip to decide that "hrady poblíž" is a place lookup has already lost the interaction.
 */
export function classifyChatIntent(message: string): AiChatIntent {
  const text = message.toLocaleLowerCase("cs-CZ");
  const editsSomething = wholeWords(
    "přidej",
    "pridej",
    "odeber",
    "zkrať",
    "zkrat",
    "změň",
    "zmen",
    "vyhni",
    "přehoď",
    "prehod"
  );
  const aboutAPlan = new RegExp(
    `plán|plan|trasu|trasa|zastávk|zastavk|itinerář|itinerar|${wholeWords("den", "dny", "dní", "dni").source}`,
    "u"
  );
  if (editsSomething.test(text) && aboutAPlan.test(text)) return "edit_plan";
  if (
    new RegExp(
      `naplánuj|naplanuj|plán na|itinerář|itinerar|${wholeWords("výlet", "vylet", "dní", "dni", "dny").source}`,
      "u"
    ).test(text)
  ) {
    return "plan";
  }
  if (/vytvoř vrstvu|vytvor vrstvu|udělej vrstvu|udelej vrstvu|vlastní vrstvu/u.test(text)) {
    return "layer_create";
  }
  if (/^(zapni|vypni|zobraz|skryj|přepni|prepni)\b/u.test(text)) return "command";
  if (inferAiCategories(message).length) {
    return wholeWords("kolik", "proč", "proc", "jak", "co je", "čím", "cim").test(text)
      ? "question"
      : "place";
  }
  if (/vrstv|katastr|záplav|zaplav|geolog/u.test(text)) return "layer_query";
  return "question";
}

function distanceLabel(distanceMeters: number | undefined): string {
  if (distanceMeters === undefined) return "";
  return distanceMeters < 1_000
    ? ` (${distanceMeters} m)`
    : ` (${(distanceMeters / 1_000).toFixed(1).replace(".", ",")} km)`;
}

function safeText(value: string): string {
  let clean = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    clean += code <= 31 || code === 127 ? " " : value[index];
  }
  return clean.replace(/\s+/gu, " ").trim();
}

/** The template answer of the deterministic path: what was found, where the nearest one is, and
 *  nothing that was not in the tool result. */
function deterministicText(
  categories: readonly string[],
  places: readonly AiPlaceSearchRecord[]
): string {
  const label = categories.map((id) => aiCategoryLabel(id) ?? id).join(", ");
  if (!places.length) {
    return `V okolí jsem v aktivních vrstvách nenašla nic v kategorii ${label}. Zkus zvětšit okolí nebo zapnout další vrstvu.`;
  }
  const [nearest, ...rest] = places;
  const first = `Našla jsem ${places.length} × ${label}. Nejblíž je ${safeText(nearest!.title)}${distanceLabel(nearest!.distanceMeters)}.`;
  if (!rest.length) return first;
  return `${first} Dál pak ${rest
    .slice(0, 3)
    .map((place) => `${safeText(place.title)}${distanceLabel(place.distanceMeters)}`)
    .join(", ")}.`;
}

function placeCard(
  categories: readonly string[],
  places: readonly AiPlaceSearchRecord[]
): AiChatPlaceCard | null {
  if (!places.length) return null;
  const label = categories.map((id) => aiCategoryLabel(id) ?? id).join(", ");
  return {
    type: "places",
    title: label || "Nalezená místa",
    places: places.slice(0, MAX_PLACE_CARD_ITEMS).map((place) => ({ ...place })),
    layerIds: [...new Set(places.map((place) => place.layerId))]
  };
}

function followUpsFor(intent: AiChatIntent, categories: readonly string[]): string[] {
  if (intent === "plan" || intent === "edit_plan") {
    return ["Kolik to je kilometrů?", "Přidej den u vody", "Jaké bude počasí?"];
  }
  if (categories.length) {
    return ["Zobraz to v mapě", "Co je poblíž?", "Naplánuj sem cestu"];
  }
  return ["Co je zajímavého v okolí?", "Jaké bude počasí?", "Naplánuj mi tu den"];
}

/** Tool specs as the model sees them: read-only, permitted for this actor, and actually composed
 *  in this deployment. The registry stays the enforcement boundary — a call is re-checked against
 *  permissions and projection before any handler runs. */
export function chatToolSpecs(
  registry: AiToolRegistry,
  actor: AiToolActor,
  available?: ReadonlySet<string>
): AiToolSpec[] {
  return registry
    .describe()
    .filter(
      (descriptor) =>
        descriptor.effect === "read" &&
        (!available || available.has(descriptor.name)) &&
        descriptor.permissionPolicy.requiredPermissions.every((permission) =>
          actor.permissions.has(permission)
        )
    )
    .map((descriptor) => ({
      name: descriptor.name,
      description: descriptor.description,
      parameters: descriptor.inputSchema
    }));
}

function citationsFrom(value: unknown): AiCitation[] {
  if (typeof value !== "object" || value === null) return [];
  const record = value as Record<string, unknown>;
  const collected: AiCitation[] = [];
  const push = (candidate: unknown) => {
    if (typeof candidate !== "object" || candidate === null) return;
    const citation = candidate as AiCitation;
    if (typeof citation.sourceId === "string" && typeof citation.label === "string") {
      collected.push({ ...citation });
    }
  };
  if (Array.isArray(record.sources)) record.sources.forEach(push);
  push(record.source);
  if (Array.isArray(record.results)) {
    for (const entry of record.results) {
      if (typeof entry === "object" && entry !== null) push((entry as { source?: unknown }).source);
    }
  }
  return collected;
}

function placesFrom(value: unknown): AiPlaceSearchRecord[] {
  if (typeof value !== "object" || value === null) return [];
  const record = value as { places?: unknown; results?: unknown };
  const rows = Array.isArray(record.places)
    ? record.places
    : Array.isArray(record.results)
      ? record.results
      : [];
  const places: AiPlaceSearchRecord[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const entry = row as Record<string, unknown>;
    const sourceId =
      typeof entry.sourceId === "string"
        ? entry.sourceId
        : typeof (entry.source as AiCitation | undefined)?.sourceId === "string"
          ? (entry.source as AiCitation).sourceId
          : null;
    if (
      typeof entry.id !== "string" ||
      typeof entry.layerId !== "string" ||
      typeof entry.title !== "string" ||
      typeof entry.longitude !== "number" ||
      typeof entry.latitude !== "number" ||
      !sourceId
    ) {
      continue;
    }
    places.push({
      id: entry.id,
      layerId: entry.layerId,
      title: entry.title,
      category: typeof entry.category === "string" ? entry.category : "",
      longitude: entry.longitude,
      latitude: entry.latitude,
      ...(typeof entry.distanceMeters === "number" ? { distanceMeters: entry.distanceMeters } : {}),
      ...(typeof entry.rating === "number" ? { rating: entry.rating } : {}),
      ...(typeof entry.openNow === "boolean" ? { openNow: entry.openNow } : {}),
      sourceId
    });
  }
  return places;
}

function linkCardsFrom(value: unknown): AiChatLinkCard[] {
  if (typeof value !== "object" || value === null) return [];
  const record = value as { results?: unknown; url?: unknown; title?: unknown };
  if (typeof record.url === "string") {
    return [{ type: "link", title: safeText(String(record.title ?? record.url)), url: record.url }];
  }
  if (!Array.isArray(record.results)) return [];
  const cards: AiChatLinkCard[] = [];
  for (const entry of record.results) {
    if (typeof entry !== "object" || entry === null) continue;
    const row = entry as { title?: unknown; url?: unknown; excerpt?: unknown };
    if (typeof row.url !== "string" || typeof row.title !== "string") continue;
    cards.push({
      type: "link",
      title: safeText(row.title),
      url: row.url,
      ...(typeof row.excerpt === "string" ? { excerpt: safeText(row.excerpt) } : {})
    });
  }
  return cards;
}

/** The two guide tools, as the registry has already validated them against their output schemas. */
interface AiRegionContextResult {
  region: { name: string; level: string; hierarchy?: string[]; countryCode?: string };
  guide?: {
    lead: string;
    highlights: { title: string; text: string; sourceIds: string[] }[];
    practical?: { arrival?: string; bestTime?: string; warnings?: string[] };
  };
}

interface AiStatsResult {
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
}

const CZECH_NUMBER = new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 1 });

/** "Kolik lidí tu žije" is a numbers question; "co je tu zajímavého" is not. The distinction
 *  decides whether the deterministic path pays for the statistics lookup as well. */
const ASKS_FOR_NUMBERS =
  /kolik|obyvatel|počet|pocet|rozloh|hustot|statistik|nezaměstnan|nezamestnan/u;

interface CollectedEvidence {
  places: Map<string, AiPlaceSearchRecord>;
  sources: Map<string, AiCitation>;
  links: AiChatLinkCard[];
  /** Layers a tool actually listed this turn, by id. A selection may only name these. */
  layers: Map<string, string>;
}

function newEvidence(): CollectedEvidence {
  return { places: new Map(), sources: new Map(), links: [], layers: new Map() };
}

function layersFrom(value: unknown): Array<{ layerId: string; name: string }> {
  if (typeof value !== "object" || value === null) return [];
  const rows = (value as { layers?: unknown }).layers;
  if (!Array.isArray(rows)) return [];
  const layers: Array<{ layerId: string; name: string }> = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const entry = row as { layerId?: unknown; name?: unknown };
    if (typeof entry.layerId !== "string") continue;
    layers.push({
      layerId: entry.layerId,
      name: typeof entry.name === "string" ? safeText(entry.name) : entry.layerId
    });
  }
  return layers;
}

export interface AiChatServiceOptions {
  registry: AiToolRegistry;
  conversations: AiConversationStore;
  runtime?: AiModelRuntime;
  /** Tools composed in this deployment. Omitted means "everything the registry knows". */
  availableTools?: ReadonlySet<string>;
  /** Deterministic place search for the no-model path; the registry is still the caller. */
  deterministicSearchLimit?: number;
  /** Present where a plan can be edited; absent means the chat can only talk about plans. */
  planEditor?: AiChatPlanEditor;
  /** Ids for emitted layers, injectable so a test can assert a stable manifest. */
  createId?: () => string;
}

export class AiChatService {
  private readonly registry: AiToolRegistry;
  private readonly conversations: AiConversationStore;
  private readonly runtime: AiModelRuntime;
  private readonly availableTools?: ReadonlySet<string>;
  private readonly deterministicLimit: number;
  private readonly planEditor?: AiChatPlanEditor;
  private readonly createId: () => string;

  constructor(options: AiChatServiceOptions) {
    this.registry = options.registry;
    this.conversations = options.conversations;
    this.runtime = options.runtime ?? aiModelRuntime();
    if (options.availableTools) this.availableTools = options.availableTools;
    if (options.planEditor) this.planEditor = options.planEditor;
    this.createId = options.createId ?? (() => randomUUID().slice(0, 8));
    this.deterministicLimit = Math.min(
      50,
      Math.max(1, Math.floor(options.deterministicSearchLimit ?? 8))
    );
  }

  /** One turn. Events are emitted as they happen; the returned answer is the same one carried by
   *  the final `done` event, for callers that only want the result. */
  async run(request: AiChatRequest, emit: AiChatEmit): Promise<AiChatAnswer | null> {
    const message = validMessage(request.message);
    if (!message || !request.actor.userId || request.actor.userId !== request.ownerUserId) {
      await emit({
        type: "error",
        code: message ? "policy-denied" : "invalid-request",
        message: message ? "Dotaz není povolen" : "Neplatný dotaz"
      });
      return null;
    }

    let conversation: AiConversation;
    try {
      conversation =
        request.conversation.mode === "new"
          ? this.conversations.create(request.ownerUserId, request.conversation.scope)
          : this.conversations.get(request.ownerUserId, request.conversation.conversationId);
      conversation = this.conversations.append(request.ownerUserId, conversation.id, {
        baseRevision: request.conversation.mode === "new" ? 0 : request.conversation.baseRevision,
        role: "user",
        content: message,
        dataClass: request.messageDataClass
      });
    } catch (error) {
      const known =
        error instanceof ConversationNotFoundError || error instanceof ConversationRevisionError;
      await emit({
        type: "error",
        code: known ? "conversation-unavailable" : "invalid-request",
        message: known
          ? "Konverzace se mezitím změnila nebo není dostupná"
          : "Neplatný AI požadavek"
      });
      return null;
    }

    const intent = classifyChatIntent(message);
    const useModel = request.consent.externalModel && this.runtime.enabled;
    await emit({
      type: "intent",
      intent,
      execution: useModel ? "model-tool-loop" : "deterministic"
    });

    let answer: AiChatAnswer | null = useModel
      ? await this.modelAnswer(request, message, intent, conversation, emit)
      : null;
    // A provider that is down, rate-limited or refused is not a reason to answer nothing: the
    // deterministic path knows how to look places up on its own.
    answer ??= await this.deterministicAnswer(request, message, intent, emit);

    if (!answer) {
      await emit({
        type: "error",
        code: "answer-unavailable",
        message: "Odpověď se teď nepodařilo připravit"
      });
      return null;
    }

    for (const card of answer.cards) await emit({ type: "card", card });

    try {
      conversation = this.conversations.append(request.ownerUserId, conversation.id, {
        baseRevision: conversation.revision,
        role: "assistant",
        content: answer.text,
        dataClass: "public",
        citations: answer.sources
      });
    } catch {
      await emit({
        type: "error",
        code: "conversation-unavailable",
        message: "Odpověď nelze uložit do konverzace"
      });
      return null;
    }

    await emit({
      type: "done",
      answer,
      conversation: {
        id: conversation.id,
        revision: conversation.revision,
        scope: conversation.scope
      }
    });
    return answer;
  }

  /** The tool loop. Bounded in rounds, in calls per round and in the bytes of each result that
   *  travel back to the model, because all three are ways for one question to cost a fortune. */
  private async modelAnswer(
    request: AiChatRequest,
    message: string,
    intent: AiChatIntent,
    conversation: AiConversation,
    emit: AiChatEmit
  ): Promise<AiChatAnswer | null> {
    const slot = intent === "plan" || intent === "layer_create" ? "strong" : "fast";
    const submissions = this.submissionTools(request, intent);
    const specs = [
      ...chatToolSpecs(this.registry, request.actor, this.availableTools),
      {
        name: SUBMIT_ANSWER_TOOL,
        description: "Odevzdej hotovou odpověď pro uživatele.",
        parameters: SUBMIT_ANSWER_SCHEMA as unknown as Record<string, unknown>
      },
      ...submissions
    ];
    const submissionNames = new Set([SUBMIT_ANSWER_TOOL, ...submissions.map(({ name }) => name)]);
    const evidence = newEvidence();
    const history: AiChatTurn[] = conversation.messages.slice(-6, -1).map((entry) => ({
      role: entry.role === "user" ? "user" : "assistant",
      content: entry.content
    }));
    const maxRounds = Math.min(
      MAX_TOOL_ROUNDS,
      this.runtime.profiles(slot)[0]!.limits.maxToolRounds
    );

    for (const profile of this.runtime.profiles(slot)) {
      const turns: AiChatTurn[] = [...history];
      for (let round = 0; round < maxRounds; round += 1) {
        const outcome = await this.runtime.gateway.turn({
          taskId: "ai-chat-turn",
          templateVersion: CHAT_TEMPLATE_VERSION,
          system: aiPrompt(CHAT_TEMPLATE_VERSION, { submitTool: SUBMIT_ANSWER_TOOL }),
          prompt: message,
          profile,
          permissionPartition: request.ownerUserId,
          sourceBlocks: [
            {
              sourceId: "map-context",
              label: "Aktuální kontext mapy",
              content: this.contextBlock(request),
              dataClass: "public"
            }
          ],
          history: turns,
          tools: specs,
          toolChoice: "auto",
          ...(request.signal ? { signal: request.signal } : {})
        });
        if (outcome.status !== "succeeded") break;

        const submitted = outcome.toolCalls.find((call) => submissionNames.has(call.name));
        if (submitted) {
          const answer = await this.answerFromSubmission(
            submitted.name,
            submitted.arguments,
            request,
            intent,
            conversation,
            evidence,
            profile.model
          );
          // A submission the server could not honour — an unresolvable place, a plan that moved
          // under it — is not an answer; the loop lets the fallback speak instead.
          if (answer) return answer;
          break;
        }
        const calls = outcome.toolCalls
          .filter((call) => !submissionNames.has(call.name))
          .slice(0, MAX_TOOL_CALLS_PER_ROUND);
        if (!calls.length) {
          // Prose without a submission still answers the user; the cards come from whatever the
          // loop already gathered.
          const text = safeText(outcome.text);
          if (!text) break;
          return this.assembleAnswer(
            { text, execution: "model-tool-loop", intent, model: profile.model },
            evidence,
            [...evidence.places.values()]
          );
        }

        turns.push({
          role: "assistant",
          content: outcome.text,
          toolCalls: calls
        });
        for (const call of calls) {
          const descriptor = this.registry.describe().find((entry) => entry.name === call.name);
          await emit({
            type: "tool_start",
            tool: call.name,
            title: descriptor?.title ?? call.name
          });
          const result = await this.registry.invoke(call.name, call.arguments, {
            actor: request.actor,
            projection: request.projection,
            ...(request.signal ? { signal: request.signal } : {})
          });
          await emit({ type: "tool_result", tool: call.name, status: result.status });
          if (result.status === "succeeded") this.collect(result.value, evidence);
          turns.push({
            role: "tool",
            toolCallId: call.id,
            name: call.name,
            content:
              result.status === "succeeded"
                ? JSON.stringify(result.value).slice(0, MAX_TOOL_RESULT_CHARS)
                : JSON.stringify({ error: result.status })
          });
        }
      }
    }
    return null;
  }

  /** No model, or the model failed: infer categories from the question and run the same
   *  `search_places` tool the model would have called (§30.4 point 4). */
  private async deterministicAnswer(
    request: AiChatRequest,
    message: string,
    intent: AiChatIntent,
    emit: AiChatEmit
  ): Promise<AiChatAnswer | null> {
    const categories = inferAiCategories(message);
    if (!categories.length) {
      // A question that names no category is usually about the place itself, and the guide answers
      // exactly that — without a model, from the same sources the Objevuj panel cites (§30.5).
      const guided = await this.regionAnswer(request, message, intent, emit);
      if (guided) return guided;
      const text =
        "Bez AI modelu umím spolehlivě hledat místa podle kategorie — zkus třeba „kempy poblíž“ nebo „vyhlídky do 10 km“.";
      await emit({ type: "token", text });
      return {
        execution: "deterministic",
        intent,
        text,
        cards: [],
        sources: [],
        followUps: followUpsFor(intent, categories)
      };
    }

    const radiusMeters = 15_000;
    const bbox =
      request.context.bbox ??
      bboxAround(
        request.context.mapCenter.longitude,
        request.context.mapCenter.latitude,
        radiusMeters
      );
    await emit({ type: "tool_start", tool: "search_places", title: "Hledám místa" });
    const result = await this.registry.invoke<AiPlaceSearchOutput>(
      "search_places",
      {
        categories: [...categories],
        near: { ...request.context.mapCenter },
        bbox,
        radiusMeters,
        ...(request.context.activeFilters
          ? {
              filters: {
                ...(request.context.activeFilters.openNow === undefined
                  ? {}
                  : { openNow: request.context.activeFilters.openNow }),
                ...(request.context.activeFilters.minRating === undefined
                  ? {}
                  : { minRating: request.context.activeFilters.minRating }),
                ...(request.context.activeFilters.tags
                  ? { tags: [...request.context.activeFilters.tags] }
                  : {})
              }
            }
          : {}),
        limit: this.deterministicLimit
      },
      {
        actor: request.actor,
        projection: request.projection,
        ...(request.signal ? { signal: request.signal } : {})
      }
    );
    await emit({ type: "tool_result", tool: "search_places", status: result.status });
    if (result.status !== "succeeded") return null;

    const evidence = newEvidence();
    this.collect(result.value, evidence);
    const places = [...evidence.places.values()];
    const text = deterministicText(categories, places);
    await emit({ type: "token", text });
    // Without a model the same request still gets its layer or its plan: the categories came
    // from the question, the places from the tool, so there is nothing left for a model to add.
    const extraCards: AiChatCard[] = [];
    if (intent === "layer_create") {
      const label = categories.map((id) => aiCategoryLabel(id) ?? id).join(", ");
      const card = this.layerDraftCard(label, undefined, places, evidence, {
        prompt: message
      });
      if (card) extraCards.push(card);
    }
    if (intent === "plan" && places.length) {
      extraCards.push({
        type: "plan",
        title: `Návrh plánu: ${categories.map((id) => aiCategoryLabel(id) ?? id).join(", ")}`,
        summary: text.slice(0, 400),
        stops: places.slice(0, 8).map((place) => ({
          title: safeText(place.title),
          longitude: place.longitude,
          latitude: place.latitude,
          sourceId: place.sourceId
        }))
      });
    }
    return this.assembleAnswer(
      {
        text,
        execution: "deterministic",
        intent,
        categories,
        ...(extraCards.length ? { extraCards } : {})
      },
      evidence,
      places
    );
  }

  /** The guide, read without a model: what the area is, two things worth knowing, and — when the
   *  question asked for numbers — the numbers with their year and source. */
  private async regionAnswer(
    request: AiChatRequest,
    message: string,
    intent: AiChatIntent,
    emit: AiChatEmit
  ): Promise<AiChatAnswer | null> {
    if (this.availableTools && !this.availableTools.has("get_region_context")) return null;
    const invocation = {
      actor: request.actor,
      projection: request.projection,
      ...(request.signal ? { signal: request.signal } : {})
    };
    const point = { ...request.context.mapCenter };
    const zoom = Math.min(24, Math.max(0, Math.round(request.context.zoom)));

    await emit({
      type: "tool_start",
      tool: "get_region_context",
      title: "Načítám kontext oblasti"
    });
    const context = await this.registry.invoke<AiRegionContextResult>(
      "get_region_context",
      { point, zoom },
      invocation
    );
    await emit({ type: "tool_result", tool: "get_region_context", status: context.status });
    if (context.status !== "succeeded") return null;

    const evidence = newEvidence();
    this.collect(context.value, evidence);
    const { region, guide } = context.value;
    const where = [region.name, ...(region.hierarchy ?? []).slice(0, 1)].join(", ");
    const sentences = [`Jsi v ${safeText(where)}.`];
    if (guide?.lead) sentences.push(safeText(guide.lead));
    for (const highlight of guide?.highlights.slice(0, 2) ?? []) {
      sentences.push(`${safeText(highlight.title)}: ${safeText(highlight.text)}`);
    }
    if (guide?.practical?.arrival) sentences.push(`Doprava: ${safeText(guide.practical.arrival)}.`);

    const cards: AiChatCard[] = [];
    if (ASKS_FOR_NUMBERS.test(message.toLocaleLowerCase("cs-CZ"))) {
      if (!this.availableTools || this.availableTools.has("get_stats")) {
        await emit({ type: "tool_start", tool: "get_stats", title: "Načítám statistiky" });
        const stats = await this.registry.invoke<AiStatsResult>(
          "get_stats",
          { point, zoom },
          invocation
        );
        await emit({ type: "tool_result", tool: "get_stats", status: stats.status });
        if (stats.status === "succeeded" && stats.value.statistics.length) {
          this.collect(stats.value, evidence);
          const items = stats.value.statistics.slice(0, 8).map((statistic) => ({
            label: safeText(statistic.label),
            value: `${CZECH_NUMBER.format(statistic.value)} ${statistic.unit}`.trim(),
            ...(statistic.year || statistic.uncertaintyLabel
              ? {
                  note: [
                    statistic.year ? String(statistic.year) : "",
                    statistic.uncertaintyLabel ? safeText(statistic.uncertaintyLabel) : ""
                  ]
                    .filter(Boolean)
                    .join(" · ")
                }
              : {}),
            sourceIds: statistic.sourceIds
          }));
          cards.push({
            type: "facts",
            title: safeText(stats.value.statistics[0]!.regionName ?? region.name),
            items
          });
        }
      }
    }

    if (sentences.length === 1 && !cards.length) return null;
    const text = sentences.join(" ");
    await emit({ type: "token", text });
    return {
      execution: "deterministic",
      intent,
      text,
      cards,
      sources: [...evidence.sources.values()],
      followUps: ["Co je zajímavého v okolí?", "Kolik tu žije lidí?", "Naplánuj mi tu den"]
    };
  }

  /** The submission tools this turn may use. `submit_answer` is always there; the others exist
   *  only where the intent asks for them and the deployment can honour them (§30.7, §30.8). */
  private submissionTools(request: AiChatRequest, intent: AiChatIntent): AiToolSpec[] {
    const specs: AiToolSpec[] = [];
    if (intent === "layer_create") {
      specs.push({
        name: EMIT_LAYER_TOOL,
        description:
          "Odevzdej odpověď i s návrhem vrstvy z míst, která ti vrátily nástroje. Uživatel ji sám zapne nebo uloží.",
        parameters: EMIT_LAYER_SCHEMA as unknown as Record<string, unknown>
      });
    }
    if (intent === "plan") {
      specs.push({
        name: SUBMIT_PLAN_TOOL,
        description:
          "Odevzdej odpověď i s návrhem plánu ze zastávek, které ti vrátily nástroje. Plán se nikam neuloží, uživatel ho otevře v Plánování.",
        parameters: SUBMIT_PLAN_SCHEMA as unknown as Record<string, unknown>
      });
    }
    if (intent === "command") {
      specs.push({
        name: SELECT_LAYERS_TOOL,
        description:
          "Odevzdej odpověď i s výběrem vrstev, které si uživatel přeje zapnout. Vrstvy jen z list_available_layers; zapne je klient, ne ty.",
        parameters: SELECT_LAYERS_SCHEMA as unknown as Record<string, unknown>
      });
    }
    const planId = request.context.planId;
    if (
      intent === "edit_plan" &&
      this.planEditor &&
      planId &&
      request.projection.allowedPlanIds.has(planId)
    ) {
      specs.push({
        name: APPLY_PLAN_COMMANDS_TOOL,
        description:
          "Navrhni úpravy otevřeného plánu. Nic se neaplikuje — uživatel uvidí rozdíl a potvrdí ho.",
        parameters: APPLY_PLAN_COMMANDS_SCHEMA as unknown as Record<string, unknown>
      });
    }
    return specs;
  }

  private async answerFromSubmission(
    tool: string,
    submission: Record<string, unknown>,
    request: AiChatRequest,
    intent: AiChatIntent,
    conversation: AiConversation,
    evidence: CollectedEvidence,
    model: string
  ): Promise<AiChatAnswer | null> {
    const text = typeof submission.text === "string" ? safeText(submission.text) : "";
    if (!text) return null;
    const requested = Array.isArray(submission.placeIds)
      ? submission.placeIds.filter((id): id is string => typeof id === "string")
      : [];
    // Only places a tool actually returned: an id the loop never saw is a hallucinated pin.
    const chosen = requested
      .map((id) => evidence.places.get(id))
      .filter((place): place is AiPlaceSearchRecord => Boolean(place));
    const followUps = Array.isArray(submission.followUps)
      ? submission.followUps
          .filter((entry): entry is string => typeof entry === "string")
          .map(safeText)
          .filter(Boolean)
          .slice(0, 3)
      : [];
    const extraCards: AiChatCard[] = [];

    if (tool === EMIT_LAYER_TOOL) {
      const card = this.layerDraftCard(
        typeof submission.name === "string" ? submission.name : "",
        typeof submission.description === "string" ? submission.description : undefined,
        chosen,
        evidence,
        { prompt: request.message, model }
      );
      if (!card) return null;
      extraCards.push(card);
    }

    if (tool === SUBMIT_PLAN_TOOL) {
      const card = this.planCard(
        typeof submission.name === "string" ? submission.name : "",
        text,
        submission.stops,
        evidence
      );
      if (!card) return null;
      extraCards.push(card);
    }

    if (tool === SELECT_LAYERS_TOOL) {
      const card = this.layerSelectionCard(request, submission, evidence);
      if (!card) return null;
      extraCards.push(card);
    }

    if (tool === APPLY_PLAN_COMMANDS_TOOL) {
      const card = await this.planEditCard(request, conversation, submission, evidence);
      if (!card) return null;
      extraCards.push(card);
    }

    return this.assembleAnswer(
      {
        text,
        execution: "model-tool-loop",
        intent,
        model,
        ...(followUps.length ? { followUps } : {}),
        ...(extraCards.length ? { extraCards } : {})
      },
      evidence,
      // A layer or plan submission already says which places it means; showing the same list
      // twice as a places card would only repeat it.
      extraCards.length ? [] : chosen.length ? chosen : [...evidence.places.values()]
    );
  }

  private layerDraftCard(
    name: string,
    description: string | undefined,
    places: readonly AiPlaceSearchRecord[],
    evidence: CollectedEvidence,
    origin: { prompt: string; model?: string }
  ): AiChatLayerDraftCard | null {
    if (!places.length) return null;
    try {
      const manifest = buildInlineLayerManifest({
        name: safeText(name),
        ...(description ? { description: safeText(description) } : {}),
        places,
        sources: [...evidence.sources.values()],
        generatedAt: new Date().toISOString(),
        seed: this.createId(),
        prompt: origin.prompt,
        ...(origin.model ? { model: origin.model } : {})
      });
      return {
        type: "layer-draft",
        title: manifest.name,
        layerId: manifest.id,
        manifest,
        featureCount: inlineLayerFeatureCount(manifest)
      };
    } catch {
      // An unattributable or empty layer is not offered at all; the text answer still stands.
      return null;
    }
  }

  /** §4.13: "zapni mi vrstvy pro…" answered as a selection the client applies. A layer id the
   *  loop never listed, or one the projection does not allow, is dropped rather than offered. */
  private layerSelectionCard(
    request: AiChatRequest,
    submission: Record<string, unknown>,
    evidence: CollectedEvidence
  ): AiChatLayerCard | null {
    const requested = Array.isArray(submission.layerIds)
      ? submission.layerIds.filter((id): id is string => typeof id === "string")
      : [];
    const layerIds = [...new Set(requested)].filter(
      (layerId) =>
        (evidence.layers.has(layerId) || request.context.activeLayerIds.includes(layerId)) &&
        request.projection.allowedLayerIds.has(layerId)
    );
    if (!layerIds.length) return null;
    const title =
      typeof submission.title === "string" && submission.title.trim()
        ? safeText(submission.title)
        : "Vrstvy k zapnutí";
    const raw = submission.filters;
    const filters: Record<string, unknown> = {};
    if (typeof raw === "object" && raw !== null) {
      const entry = raw as Record<string, unknown>;
      if (typeof entry.openNow === "boolean") filters.openNow = entry.openNow;
      if (typeof entry.minRating === "number") filters.minRating = entry.minRating;
      if (Array.isArray(entry.tags)) {
        const tags = entry.tags
          .filter((tag): tag is string => typeof tag === "string")
          .map(safeText)
          .filter(Boolean)
          .slice(0, 8);
        if (tags.length) filters.tags = tags;
      }
    }
    return {
      type: "layer",
      title,
      layerIds,
      ...(Object.keys(filters).length ? { filters } : {})
    };
  }

  private planCard(
    name: string,
    text: string,
    raw: unknown,
    evidence: CollectedEvidence
  ): AiChatPlanCard | null {
    const rows = Array.isArray(raw) ? raw : [];
    const stops: AiChatPlanCard["stops"] = [];
    for (const row of rows) {
      if (typeof row !== "object" || row === null) continue;
      const entry = row as { placeId?: unknown; day?: unknown; note?: unknown };
      const place =
        typeof entry.placeId === "string" ? evidence.places.get(entry.placeId) : undefined;
      if (!place) continue;
      stops.push({
        title: safeText(place.title),
        longitude: place.longitude,
        latitude: place.latitude,
        ...(typeof entry.day === "number" ? { day: entry.day } : {}),
        ...(typeof entry.note === "string" && entry.note.trim()
          ? { note: safeText(entry.note) }
          : {}),
        sourceId: place.sourceId
      });
      if (stops.length >= 40) break;
    }
    if (!stops.length) return null;
    return {
      type: "plan",
      title: safeText(name) || "Návrh plánu",
      summary: text.slice(0, 400),
      stops
    };
  }

  private async planEditCard(
    request: AiChatRequest,
    conversation: AiConversation,
    submission: Record<string, unknown>,
    evidence: CollectedEvidence
  ): Promise<AiChatPlanEditCard | null> {
    const planId = request.context.planId;
    if (!this.planEditor || !planId) return null;
    const summary = typeof submission.summary === "string" ? safeText(submission.summary) : "";
    const rows = Array.isArray(submission.edits) ? submission.edits : [];
    const edits: AiChatPlanEdit[] = [];
    for (const row of rows) {
      if (typeof row !== "object" || row === null) continue;
      const entry = row as Record<string, unknown>;
      if (typeof entry.op !== "string") continue;
      edits.push({
        op: entry.op as AiChatPlanEdit["op"],
        ...(typeof entry.placeId === "string" ? { placeId: entry.placeId } : {}),
        ...(typeof entry.stopId === "string" ? { stopId: entry.stopId } : {}),
        ...(typeof entry.atIndex === "number" ? { atIndex: entry.atIndex } : {}),
        ...(typeof entry.toIndex === "number" ? { toIndex: entry.toIndex } : {}),
        ...(typeof entry.note === "string" && entry.note.trim()
          ? { note: safeText(entry.note) }
          : {}),
        ...(typeof entry.name === "string" ? { name: safeText(entry.name) } : {})
      });
    }
    if (!summary || !edits.length) return null;
    try {
      const proposal = await this.planEditor.propose({
        ownerUserId: request.ownerUserId,
        planId,
        conversationId: conversation.id,
        summary,
        edits,
        places: [...evidence.places.values()],
        citations: [...evidence.sources.values()],
        ...(request.signal ? { signal: request.signal } : {})
      });
      return {
        type: "plan-edit",
        title: summary,
        proposalId: proposal.proposalId,
        planId: proposal.planId,
        diff: proposal.diff
      };
    } catch {
      // The plan moved, the edit did not apply, or the store refused it: no card, and the text
      // answer is what the user sees.
      return null;
    }
  }

  private assembleAnswer(
    base: {
      text: string;
      execution: AiChatAnswer["execution"];
      intent: AiChatIntent;
      model?: string;
      followUps?: string[];
      categories?: readonly string[];
      extraCards?: readonly AiChatCard[];
    },
    evidence: CollectedEvidence,
    places: readonly AiPlaceSearchRecord[]
  ): AiChatAnswer {
    const categories = base.categories ?? [
      ...new Set(places.map((place) => place.category).filter(Boolean))
    ];
    const cards: AiChatCard[] = [...(base.extraCards ?? [])];
    const card = placeCard(categories, places);
    if (card) cards.push(card);
    cards.push(...evidence.links.slice(0, 3));
    return {
      execution: base.execution,
      intent: base.intent,
      text: base.text,
      cards,
      sources: [...evidence.sources.values()],
      followUps: base.followUps ?? followUpsFor(base.intent, categories),
      ...(base.model ? { model: base.model } : {})
    };
  }

  private collect(value: unknown, evidence: CollectedEvidence): void {
    for (const layer of layersFrom(value)) evidence.layers.set(layer.layerId, layer.name);
    for (const place of placesFrom(value)) evidence.places.set(place.id, place);
    for (const citation of citationsFrom(value)) {
      if (!evidence.sources.has(citation.sourceId))
        evidence.sources.set(citation.sourceId, citation);
    }
    for (const link of linkCardsFrom(value)) {
      if (!evidence.links.some((existing) => existing.url === link.url)) evidence.links.push(link);
    }
  }

  /** The context block the model sees: a projection, never the raw request (§30.3). Precise
   *  coordinates are rounded unless the user consented to sharing them. */
  private contextBlock(request: AiChatRequest): string {
    const precise = request.projection.allowPreciseLocation && request.consent.preciseLocation;
    const digits = precise ? 5 : 2;
    const allowedLayers = request.context.activeLayerIds.filter((layerId) =>
      request.projection.allowedLayerIds.has(layerId)
    );
    const lines = [
      `Střed mapy: ${request.context.mapCenter.latitude.toFixed(digits)}, ${request.context.mapCenter.longitude.toFixed(digits)}`,
      `Přiblížení: ${request.context.zoom.toFixed(1)}`,
      `Aktivní vrstvy: ${allowedLayers.length ? allowedLayers.join(", ") : "žádné"}`
    ];
    if (request.context.mode) lines.push(`Režim: ${request.context.mode}`);
    if (request.context.regionRef) lines.push(`Oblast: ${request.context.regionRef}`);
    if (request.context.planId && request.projection.allowedPlanIds.has(request.context.planId)) {
      lines.push(`Plán: ${request.context.planId}`);
    }
    if (
      request.context.featureRef &&
      request.projection.allowedLayerIds.has(request.context.featureRef.layerId)
    ) {
      lines.push(
        `Vybrané místo: ${request.context.featureRef.featureId} (${request.context.featureRef.layerId})`
      );
    }
    return lines.join("\n");
  }
}
