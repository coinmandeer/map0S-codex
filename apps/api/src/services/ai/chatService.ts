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

import type { Bbox } from "@mapos/layer-sdk";
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

export type AiChatCard = AiChatPlaceCard | AiChatLinkCard | AiChatLayerCard;

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

const SYSTEM_PROMPT = [
  "Jsi asistent mapové aplikace MapOS. Odpovídáš česky, věcně a krátce.",
  "Fakta o místech, trasách, počasí a událostech smíš uvádět jen z výsledků nástrojů.",
  "Souřadnice nikdy nevymýšlíš; místo bez zdroje do odpovědi nepatří.",
  "Když nástroj nic nenajde, řekni to a navrhni, co zkusit dál.",
  `Výsledek vždy odevzdej voláním nástroje ${SUBMIT_ANSWER_TOOL}.`
].join(" ");

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
 * The server half of the intent router (§30.4 point 1).
 *
 * The client already ran the same kind of heuristic for instant feedback; this either confirms it
 * or overrides it. It is deliberately keyword-based and offline: a router that needs a network
 * round trip to decide that "hrady poblíž" is a place lookup has already lost the interaction.
 */
export function classifyChatIntent(message: string): AiChatIntent {
  const text = message.toLocaleLowerCase("cs-CZ");
  const editsSomething = /\b(přidej|pridej|odeber|zkrať|zkrat|změň|zmen|vyhni|přehoď|prehod)\b/u;
  const aboutAPlan = /plán|plan|trasu|trasa|zastávk|zastavk|\bden\b|\bdn[ií]\b|itinerář|itinerar/u;
  if (editsSomething.test(text) && aboutAPlan.test(text)) return "edit_plan";
  if (/naplánuj|naplanuj|plán na|itinerář|itinerar|\bvýlet\b|\bvylet\b|\bdn[ií]\b/u.test(text)) {
    return "plan";
  }
  if (/vytvoř vrstvu|vytvor vrstvu|udělej vrstvu|udelej vrstvu|vlastní vrstvu/u.test(text)) {
    return "layer_create";
  }
  if (/^(zapni|vypni|zobraz|skryj|přepni|prepni)\b/u.test(text)) return "command";
  if (inferAiCategories(message).length) {
    return /\b(kolik|proč|proc|jak|co je|čím|cim)\b/u.test(text) ? "question" : "place";
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

interface CollectedEvidence {
  places: Map<string, AiPlaceSearchRecord>;
  sources: Map<string, AiCitation>;
  links: AiChatLinkCard[];
}

export interface AiChatServiceOptions {
  registry: AiToolRegistry;
  conversations: AiConversationStore;
  runtime?: AiModelRuntime;
  /** Tools composed in this deployment. Omitted means "everything the registry knows". */
  availableTools?: ReadonlySet<string>;
  /** Deterministic place search for the no-model path; the registry is still the caller. */
  deterministicSearchLimit?: number;
}

export class AiChatService {
  private readonly registry: AiToolRegistry;
  private readonly conversations: AiConversationStore;
  private readonly runtime: AiModelRuntime;
  private readonly availableTools?: ReadonlySet<string>;
  private readonly deterministicLimit: number;

  constructor(options: AiChatServiceOptions) {
    this.registry = options.registry;
    this.conversations = options.conversations;
    this.runtime = options.runtime ?? aiModelRuntime();
    if (options.availableTools) this.availableTools = options.availableTools;
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
    const specs = [
      ...chatToolSpecs(this.registry, request.actor, this.availableTools),
      {
        name: SUBMIT_ANSWER_TOOL,
        description: "Odevzdej hotovou odpověď pro uživatele.",
        parameters: SUBMIT_ANSWER_SCHEMA as unknown as Record<string, unknown>
      }
    ];
    const evidence: CollectedEvidence = { places: new Map(), sources: new Map(), links: [] };
    const history: AiChatTurn[] = conversation.messages
      .slice(-6, -1)
      .map((entry) => ({
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
          templateVersion: "ai-chat-turn.v1",
          system: SYSTEM_PROMPT,
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

        const submitted = outcome.toolCalls.find((call) => call.name === SUBMIT_ANSWER_TOOL);
        if (submitted) {
          return this.answerFromSubmission(submitted.arguments, intent, evidence, profile.model);
        }
        const calls = outcome.toolCalls
          .filter((call) => call.name !== SUBMIT_ANSWER_TOOL)
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

    const evidence: CollectedEvidence = { places: new Map(), sources: new Map(), links: [] };
    this.collect(result.value, evidence);
    const places = [...evidence.places.values()];
    const text = deterministicText(categories, places);
    await emit({ type: "token", text });
    return this.assembleAnswer(
      { text, execution: "deterministic", intent, categories },
      evidence,
      places
    );
  }

  private answerFromSubmission(
    submission: Record<string, unknown>,
    intent: AiChatIntent,
    evidence: CollectedEvidence,
    model: string
  ): AiChatAnswer | null {
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
    return this.assembleAnswer(
      {
        text,
        execution: "model-tool-loop",
        intent,
        model,
        ...(followUps.length ? { followUps } : {})
      },
      evidence,
      chosen.length ? chosen : [...evidence.places.values()]
    );
  }

  private assembleAnswer(
    base: {
      text: string;
      execution: AiChatAnswer["execution"];
      intent: AiChatIntent;
      model?: string;
      followUps?: string[];
      categories?: readonly string[];
    },
    evidence: CollectedEvidence,
    places: readonly AiPlaceSearchRecord[]
  ): AiChatAnswer {
    const categories = base.categories ?? [
      ...new Set(places.map((place) => place.category).filter(Boolean))
    ];
    const cards: AiChatCard[] = [];
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
