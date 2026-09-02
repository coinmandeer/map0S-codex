import type { AiCitation, AiDataClass } from "./contracts.js";
import {
  AiConversationStore,
  ConversationNotFoundError,
  ConversationRevisionError,
  type AiConversation,
  type AiConversationScope
} from "./conversation.js";
import type {
  AiNearestPoiActiveFilters,
  AiNearestPoiOutput,
  AiNearestPoiReference,
  AiNearestPoiResult
} from "./toolCatalog.js";
import type {
  AiToolActor,
  AiToolPermissionProjection,
  AiToolRegistry,
  AiToolStatus
} from "./toolRegistry.js";

export type AiOrchestrationConversationTarget =
  | { mode: "new"; scope: AiConversationScope }
  | { mode: "existing"; conversationId: string; baseRevision: number };

export interface AiNearestPoiMapContext {
  reference: AiNearestPoiReference;
  activeLayerIds: readonly string[];
  activeFilters: AiNearestPoiActiveFilters;
  radiusMeters?: number;
  limit?: number;
}

export interface AiOrchestrationRequest {
  ownerUserId: string;
  conversation: AiOrchestrationConversationTarget;
  prompt: string;
  promptDataClass: AiDataClass;
  actor: AiToolActor;
  projection: AiToolPermissionProjection;
  mapContext: AiNearestPoiMapContext;
  signal?: AbortSignal;
}

export interface AiOrchestratedNearestPoiAnswer {
  execution: "deterministic-tool";
  toolName: "find_nearest_poi";
  text: string;
  results: AiNearestPoiResult[];
  citations: AiCitation[];
}

export type AiOrchestrationOutcome =
  | {
      status: "succeeded";
      conversation: AiConversation;
      answer: AiOrchestratedNearestPoiAnswer;
    }
  | { status: "unsupported-intent" }
  | { status: "invalid-request" }
  | { status: "policy-denied" }
  | { status: "conversation-unavailable" }
  | {
      status: "tool-failed";
      toolStatus: Exclude<AiToolStatus, "succeeded">;
      conversationId: string;
      revision: number;
    };

const MAX_ORCHESTRATION_PROMPT_CHARS = 2_000;
const MAX_ORCHESTRATED_RESULTS = 4;
const DATA_CLASSES = new Set<AiDataClass>([
  "public",
  "account-private",
  "precise-user-location",
  "secret"
]);

function hasDisallowedTextControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 8 || (code >= 11 && code <= 12) || (code >= 14 && code <= 31)) return true;
  }
  return false;
}

function validPrompt(value: string): string | null {
  const prompt = value.trim();
  if (
    !prompt ||
    prompt.length > MAX_ORCHESTRATION_PROMPT_CHARS ||
    hasDisallowedTextControl(prompt)
  ) {
    return null;
  }
  return prompt;
}

function isNearestBarIntent(prompt: string): boolean {
  const normalized = prompt
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLocaleLowerCase("cs");
  return (
    /\b(nejblizsi|nearest)\b/u.test(normalized) &&
    /\b(bar|baru|barum|pub|hospoda|hospodu)\b/u.test(normalized)
  );
}

function safeDisplayText(value: string): string {
  let clean = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    clean += code <= 31 || code === 127 ? " " : value[index];
  }
  return clean.replace(/\s+/gu, " ").trim();
}

function displayDistance(distanceMeters: number): string {
  if (distanceMeters < 1_000) return `${distanceMeters} m`;
  return `${(distanceMeters / 1_000).toFixed(1)} km`;
}

function answerText(results: readonly AiNearestPoiResult[]): string {
  if (!results.length) {
    return "V aktivních povolených vrstvách nebyl nalezen odpovídající bar.";
  }
  const [nearest, ...remaining] = results;
  const first = `Nejblíž je ${safeDisplayText(nearest!.title)} (${displayDistance(nearest!.distanceMeters)}).`;
  if (!remaining.length) return first;
  return `${first} Další: ${remaining
    .map((result) => `${safeDisplayText(result.title)} (${displayDistance(result.distanceMeters)})`)
    .join(", ")}.`;
}

function citedResults(results: readonly AiNearestPoiResult[]): AiCitation[] {
  const citations = new Map<string, AiCitation>();
  for (const result of results) {
    if (!citations.has(result.source.sourceId)) {
      citations.set(result.source.sourceId, { ...result.source });
    }
  }
  return [...citations.values()];
}

/**
 * Explicit provider-neutral orchestration boundary for deterministic intents.
 *
 * Current model adapters advertise tools=false, so this class intentionally resolves the narrow
 * nearest-bar intent before any model gateway. It invokes the server-side registry directly and
 * records both turns in the scoped conversation store; it must not be described as a native model
 * tool-call path.
 */
export class ProviderNeutralAiOrchestrator {
  constructor(
    private readonly tools: AiToolRegistry,
    private readonly conversations: AiConversationStore
  ) {}

  async run(request: AiOrchestrationRequest): Promise<AiOrchestrationOutcome> {
    const prompt = validPrompt(request.prompt);
    if (!prompt || !DATA_CLASSES.has(request.promptDataClass)) return { status: "invalid-request" };
    if (!isNearestBarIntent(prompt)) return { status: "unsupported-intent" };
    if (!request.actor.userId || request.actor.userId !== request.ownerUserId) {
      return { status: "policy-denied" };
    }

    let conversation: AiConversation;
    try {
      conversation =
        request.conversation.mode === "new"
          ? this.conversations.create(request.ownerUserId, request.conversation.scope)
          : this.conversations.get(request.ownerUserId, request.conversation.conversationId);
      const expectedRevision =
        request.conversation.mode === "new" ? 0 : request.conversation.baseRevision;
      conversation = this.conversations.append(request.ownerUserId, conversation.id, {
        baseRevision: expectedRevision,
        role: "user",
        content: prompt,
        dataClass: request.promptDataClass
      });
    } catch (error) {
      if (
        error instanceof ConversationNotFoundError ||
        error instanceof ConversationRevisionError
      ) {
        return { status: "conversation-unavailable" };
      }
      return { status: "invalid-request" };
    }

    const radiusMeters = request.mapContext.radiusMeters ?? 5_000;
    const limit = Math.min(request.mapContext.limit ?? 3, MAX_ORCHESTRATED_RESULTS);
    const tool = await this.tools.invoke<AiNearestPoiOutput>(
      "find_nearest_poi",
      {
        reference: { ...request.mapContext.reference },
        layerIds: [...request.mapContext.activeLayerIds],
        category: "food.bar",
        activeFilters: structuredClone(request.mapContext.activeFilters),
        radiusMeters,
        limit
      },
      {
        actor: request.actor,
        projection: request.projection,
        signal: request.signal
      }
    );
    if (tool.status !== "succeeded") {
      return {
        status: "tool-failed",
        toolStatus: tool.status,
        conversationId: conversation.id,
        revision: conversation.revision
      };
    }

    const results = tool.value.results.map((result) => structuredClone(result));
    const citations = citedResults(results);
    const answer: AiOrchestratedNearestPoiAnswer = {
      execution: "deterministic-tool",
      toolName: "find_nearest_poi",
      text: answerText(results),
      results,
      citations
    };
    try {
      conversation = this.conversations.append(request.ownerUserId, conversation.id, {
        baseRevision: conversation.revision,
        role: "assistant",
        content: answer.text,
        dataClass: "public",
        citations,
        toolNames: [answer.toolName]
      });
    } catch (error) {
      if (error instanceof ConversationRevisionError) {
        return { status: "conversation-unavailable" };
      }
      return { status: "invalid-request" };
    }
    return { status: "succeeded", conversation, answer };
  }
}
