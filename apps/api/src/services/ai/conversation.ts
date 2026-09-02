import { randomUUID } from "node:crypto";
import type { AiCitation, AiDataClass } from "./contracts.js";

export type AiConversationScope =
  | { type: "global" }
  | { type: "plan"; planId: string }
  | { type: "day"; planId: string; dayId: string }
  | { type: "stop"; planId: string; stopId: string }
  | { type: "segment"; planId: string; segmentId: string }
  | { type: "feature"; layerId: string; featureId: string }
  | { type: "layer"; layerId: string };

export interface AiConversationMessage {
  id: string;
  revision: number;
  role: "user" | "assistant" | "tool";
  content: string;
  dataClass: AiDataClass;
  citations: AiCitation[];
  toolNames: string[];
  artifactIds: string[];
  createdAt: string;
}

export interface AiConversationStructuredState {
  latestUserIntent: string | null;
  latestAssistantConclusion: string | null;
  sourceIds: string[];
  toolNames: string[];
  artifactIds: string[];
}

export interface AiConversationSummaryPartition {
  dataClass: AiDataClass;
  messageCount: number;
  /** Bounded extractive summary; it is never a substitute for source citations. */
  summary: string;
  state: AiConversationStructuredState;
}

export interface AiConversationCompaction {
  throughRevision: number;
  compactedMessageCount: number;
  partitions: AiConversationSummaryPartition[];
}

export interface AiConversation {
  id: string;
  ownerUserId: string;
  scope: AiConversationScope;
  revision: number;
  /** Lifetime count; messages contains only the bounded raw tail. */
  messageCount: number;
  compaction: AiConversationCompaction | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  messages: AiConversationMessage[];
}

export interface AiConversationModelContext {
  conversationId: string;
  scope: AiConversationScope;
  revision: number;
  totalMessageCount: number;
  compactedMessageCount: number;
  omittedRecentMessageCount: number;
  summaries: AiConversationSummaryPartition[];
  recentMessages: AiConversationMessage[];
}

export interface AppendConversationMessage {
  baseRevision: number;
  role: AiConversationMessage["role"];
  content: string;
  dataClass: AiDataClass;
  citations?: AiCitation[];
  toolNames?: string[];
  artifactIds?: string[];
}

export class ConversationNotFoundError extends Error {
  readonly name = "ConversationNotFoundError";
}

export class ConversationRevisionError extends Error {
  readonly name = "ConversationRevisionError";
}

export const AI_CONVERSATION_RAW_MESSAGE_LIMIT = 24;
export const AI_CONVERSATION_RAW_CHAR_LIMIT = 48_000;
/** Exact UTF-8 JSON budget for the object returned by projectForModel, including metadata. */
export const AI_CONVERSATION_MODEL_CONTEXT_BYTE_LIMIT = 128 * 1_024;
const RAW_TAIL_AFTER_COMPACTION = 16;
const MAX_TOTAL_MESSAGES = 10_000;
const MAX_CONTENT_CHARS = 12_000;
const MAX_CITATIONS_PER_MESSAGE = 4;
const MAX_CITATION_URL_CHARS = 2_048;
const MAX_SUMMARY_LINES = 8;
const MAX_SUMMARY_CHARS = 2_000;
const MAX_STATE_REFERENCES = 12;
const MAX_STATE_TEXT_CHARS = 320;
const MAX_MESSAGE_REFERENCES = 20;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DATA_CLASSES = new Set<AiDataClass>([
  "public",
  "account-private",
  "precise-user-location",
  "secret"
]);

function hasDisallowedTextControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    // Preserve tab/newline/carriage-return for multi-line prompts, matching the prior contract.
    if (code <= 8 || (code >= 11 && code <= 12) || (code >= 14 && code <= 31)) return true;
  }
  return false;
}

function cleanIdentifier(value: string, label: string): string {
  const clean = value.trim();
  if (!IDENTIFIER.test(clean)) throw new TypeError(`Invalid ${label}`);
  return clean;
}

function cleanText(value: string): string {
  const clean = value.trim();
  if (!clean || clean.length > MAX_CONTENT_CHARS || hasDisallowedTextControl(clean)) {
    throw new TypeError("Invalid conversation content");
  }
  return clean;
}

function cleanDataClass(value: AiDataClass): AiDataClass {
  if (!DATA_CLASSES.has(value)) throw new TypeError("Invalid conversation data class");
  return value;
}

function cleanCitations(citations: readonly AiCitation[]): AiCitation[] {
  const cleaned: AiCitation[] = [];
  const seen = new Set<string>();
  for (const citation of citations.slice(0, MAX_CITATIONS_PER_MESSAGE)) {
    const sourceId = cleanIdentifier(citation.sourceId, "citation source id");
    if (seen.has(sourceId)) continue;
    const label = citation.label.trim();
    if (!label || label.length > 240 || hasDisallowedTextControl(label)) {
      throw new TypeError("Invalid citation label");
    }
    let url: string | undefined;
    if (citation.url) {
      if (citation.url.length > MAX_CITATION_URL_CHARS) {
        throw new TypeError("Invalid citation URL");
      }
      const parsed = new URL(citation.url);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        throw new TypeError("Invalid citation URL");
      }
      url = parsed.toString();
      if (url.length > MAX_CITATION_URL_CHARS) throw new TypeError("Invalid citation URL");
    }
    if (citation.retrievedAt !== undefined) {
      if (
        typeof citation.retrievedAt !== "string" ||
        !citation.retrievedAt ||
        citation.retrievedAt.length > 64 ||
        hasDisallowedTextControl(citation.retrievedAt)
      ) {
        throw new TypeError("Invalid citation retrieval timestamp");
      }
    }
    cleaned.push({
      sourceId,
      label,
      ...(url ? { url } : {}),
      ...(citation.providerId
        ? { providerId: cleanIdentifier(citation.providerId, "citation provider id") }
        : {}),
      ...(citation.retrievedAt ? { retrievedAt: citation.retrievedAt } : {})
    });
    seen.add(sourceId);
  }
  return cleaned;
}

function cleanScope(scope: AiConversationScope): AiConversationScope {
  if (scope.type === "global") return scope;
  if (scope.type === "plan") {
    return { type: scope.type, planId: cleanIdentifier(scope.planId, "plan id") };
  }
  if (scope.type === "day") {
    return {
      type: scope.type,
      planId: cleanIdentifier(scope.planId, "plan id"),
      dayId: cleanIdentifier(scope.dayId, "day id")
    };
  }
  if (scope.type === "stop") {
    return {
      type: scope.type,
      planId: cleanIdentifier(scope.planId, "plan id"),
      stopId: cleanIdentifier(scope.stopId, "stop id")
    };
  }
  if (scope.type === "segment") {
    return {
      type: scope.type,
      planId: cleanIdentifier(scope.planId, "plan id"),
      segmentId: cleanIdentifier(scope.segmentId, "segment id")
    };
  }
  if (scope.type === "feature") {
    return {
      type: scope.type,
      layerId: cleanIdentifier(scope.layerId, "layer id"),
      featureId: cleanIdentifier(scope.featureId, "feature id")
    };
  }
  return { type: scope.type, layerId: cleanIdentifier(scope.layerId, "layer id") };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function boundedExcerpt(value: string, maxChars = MAX_STATE_TEXT_CHARS): string {
  const normalised = value.replace(/\s+/gu, " ").trim();
  if (normalised.length <= maxChars) return normalised;
  return `${normalised.slice(0, maxChars - 1)}…`;
}

function uniqueBounded(previous: readonly string[], additions: readonly string[]): string[] {
  return [...new Set([...previous, ...additions])].slice(-MAX_STATE_REFERENCES);
}

function lastMessageWithRole(
  messages: readonly AiConversationMessage[],
  role: AiConversationMessage["role"]
): AiConversationMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === role) return messages[index];
  }
  return undefined;
}

function boundedSummary(previous: string, messages: readonly AiConversationMessage[]): string {
  const previousLines = previous ? previous.split("\n") : [];
  const addedLines = messages.map(
    (message) => `${message.role}: ${boundedExcerpt(message.content, 240)}`
  );
  const lines = [...previousLines, ...addedLines].slice(-MAX_SUMMARY_LINES);
  while (lines.join("\n").length > MAX_SUMMARY_CHARS && lines.length > 1) lines.shift();
  return lines.join("\n");
}

function compactMessages(
  previous: AiConversationCompaction | null,
  messages: readonly AiConversationMessage[]
): AiConversationCompaction {
  const partitions = new Map(
    (previous?.partitions ?? []).map((partition) => [partition.dataClass, clone(partition)])
  );
  for (const dataClass of DATA_CLASSES) {
    const matching = messages.filter((message) => message.dataClass === dataClass);
    if (!matching.length) continue;
    const existing = partitions.get(dataClass) ?? {
      dataClass,
      messageCount: 0,
      summary: "",
      state: {
        latestUserIntent: null,
        latestAssistantConclusion: null,
        sourceIds: [],
        toolNames: [],
        artifactIds: []
      }
    };
    const latestUser = lastMessageWithRole(matching, "user");
    const latestAssistant = lastMessageWithRole(matching, "assistant");
    partitions.set(dataClass, {
      dataClass,
      messageCount: existing.messageCount + matching.length,
      summary: boundedSummary(existing.summary, matching),
      state: {
        latestUserIntent: latestUser
          ? boundedExcerpt(latestUser.content)
          : existing.state.latestUserIntent,
        latestAssistantConclusion: latestAssistant
          ? boundedExcerpt(latestAssistant.content)
          : existing.state.latestAssistantConclusion,
        sourceIds: uniqueBounded(
          existing.state.sourceIds,
          matching.flatMap((message) => message.citations.map(({ sourceId }) => sourceId))
        ),
        toolNames: uniqueBounded(
          existing.state.toolNames,
          matching.flatMap((message) => message.toolNames)
        ),
        artifactIds: uniqueBounded(
          existing.state.artifactIds,
          matching.flatMap((message) => message.artifactIds)
        )
      }
    });
  }
  return {
    throughRevision: Math.max(
      previous?.throughRevision ?? 0,
      ...messages.map((message) => message.revision)
    ),
    compactedMessageCount: (previous?.compactedMessageCount ?? 0) + messages.length,
    partitions: [...partitions.values()].sort((a, b) => a.dataClass.localeCompare(b.dataClass))
  };
}

function compactRawTail(
  messages: readonly AiConversationMessage[],
  previous: AiConversationCompaction | null
): { messages: AiConversationMessage[]; compaction: AiConversationCompaction | null } {
  const rawChars = messages.reduce((count, message) => count + message.content.length, 0);
  if (
    messages.length <= AI_CONVERSATION_RAW_MESSAGE_LIMIT &&
    rawChars <= AI_CONVERSATION_RAW_CHAR_LIMIT
  ) {
    return { messages: [...messages], compaction: previous };
  }
  let compactCount = Math.max(0, messages.length - RAW_TAIL_AFTER_COMPACTION);
  let remainingChars = messages
    .slice(compactCount)
    .reduce((count, message) => count + message.content.length, 0);
  while (remainingChars > AI_CONVERSATION_RAW_CHAR_LIMIT && compactCount < messages.length - 1) {
    remainingChars -= messages[compactCount]?.content.length ?? 0;
    compactCount += 1;
  }
  return {
    messages: messages.slice(compactCount),
    compaction: compactMessages(previous, messages.slice(0, compactCount))
  };
}

/**
 * Repository-neutral scoped store with owner ACLs, optimistic revision and a bounded raw tail.
 * Compaction is deterministic and data-class partitioned, so projection never mixes private state
 * into a public model request. A durable repository can replace the Map without changing these
 * invariants.
 */
export class AiConversationStore {
  private readonly records = new Map<string, AiConversation>();

  constructor(
    private readonly now: () => Date = () => new Date(),
    private readonly createId: () => string = randomUUID
  ) {}

  create(ownerUserId: string, scope: AiConversationScope): AiConversation {
    const owner = cleanIdentifier(ownerUserId, "owner id");
    const id = cleanIdentifier(this.createId(), "conversation id");
    const timestamp = this.now().toISOString();
    const conversation: AiConversation = {
      id,
      ownerUserId: owner,
      scope: cleanScope(scope),
      revision: 0,
      messageCount: 0,
      compaction: null,
      archivedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      messages: []
    };
    this.records.set(id, conversation);
    return clone(conversation);
  }

  get(ownerUserId: string, conversationId: string): AiConversation {
    return clone(this.owned(ownerUserId, conversationId));
  }

  append(
    ownerUserId: string,
    conversationId: string,
    input: AppendConversationMessage
  ): AiConversation {
    const conversation = this.owned(ownerUserId, conversationId);
    if (conversation.archivedAt) throw new ConversationRevisionError("Conversation is archived");
    if (input.baseRevision !== conversation.revision) {
      throw new ConversationRevisionError(
        `Stale conversation revision ${input.baseRevision}; current revision is ${conversation.revision}`
      );
    }
    if (conversation.messageCount >= MAX_TOTAL_MESSAGES) {
      throw new ConversationRevisionError("Conversation message budget exhausted");
    }
    const timestamp = this.now().toISOString();
    const revision = conversation.revision + 1;
    const message: AiConversationMessage = {
      id: cleanIdentifier(this.createId(), "message id"),
      revision,
      role: input.role,
      content: cleanText(input.content),
      dataClass: cleanDataClass(input.dataClass),
      citations: cleanCitations(input.citations ?? []),
      toolNames: [...new Set((input.toolNames ?? []).slice(0, MAX_MESSAGE_REFERENCES))].map(
        (name) => cleanIdentifier(name, "tool name")
      ),
      artifactIds: [...new Set((input.artifactIds ?? []).slice(0, MAX_MESSAGE_REFERENCES))].map(
        (id) => cleanIdentifier(id, "artifact id")
      ),
      createdAt: timestamp
    };
    const compacted = compactRawTail([...conversation.messages, message], conversation.compaction);
    const updated: AiConversation = {
      ...conversation,
      revision,
      messageCount: conversation.messageCount + 1,
      compaction: compacted.compaction,
      updatedAt: timestamp,
      messages: compacted.messages
    };
    this.records.set(conversation.id, updated);
    return clone(updated);
  }

  archive(ownerUserId: string, conversationId: string, baseRevision: number): AiConversation {
    const conversation = this.owned(ownerUserId, conversationId);
    if (baseRevision !== conversation.revision) {
      throw new ConversationRevisionError("Stale revision");
    }
    if (conversation.archivedAt) return clone(conversation);
    const timestamp = this.now().toISOString();
    const updated = {
      ...conversation,
      revision: conversation.revision + 1,
      archivedAt: timestamp,
      updatedAt: timestamp
    };
    this.records.set(conversation.id, updated);
    return clone(updated);
  }

  delete(ownerUserId: string, conversationId: string): boolean {
    this.owned(ownerUserId, conversationId);
    return this.records.delete(conversationId);
  }

  /** Backward-compatible raw projection. It can return only the bounded recent tail. */
  project(
    ownerUserId: string,
    conversationId: string,
    allowedDataClasses: readonly AiDataClass[]
  ): AiConversationMessage[] {
    return this.projectForModel(ownerUserId, conversationId, allowedDataClasses).recentMessages;
  }

  /** Sole model-context boundary: filtered summaries/state plus a bounded, filtered raw tail. */
  projectForModel(
    ownerUserId: string,
    conversationId: string,
    allowedDataClasses: readonly AiDataClass[]
  ): AiConversationModelContext {
    const allowed = new Set(allowedDataClasses.map(cleanDataClass));
    const conversation = this.owned(ownerUserId, conversationId);
    const summaries = (conversation.compaction?.partitions ?? [])
      .filter((partition) => allowed.has(partition.dataClass))
      .map(clone);
    const eligibleMessages = conversation.messages
      .filter((message) => allowed.has(message.dataClass))
      .map(clone);
    const base = {
      conversationId: conversation.id,
      scope: clone(conversation.scope),
      revision: conversation.revision,
      totalMessageCount: conversation.messageCount,
      compactedMessageCount: summaries.reduce(
        (count, partition) => count + partition.messageCount,
        0
      ),
      summaries,
      omittedRecentMessageCount: eligibleMessages.length,
      recentMessages: [] as AiConversationMessage[]
    };
    const recentMessages: AiConversationMessage[] = [];
    for (let index = eligibleMessages.length - 1; index >= 0; index -= 1) {
      const candidateMessages = [eligibleMessages[index]!, ...recentMessages];
      const candidate: AiConversationModelContext = {
        ...base,
        omittedRecentMessageCount: eligibleMessages.length - candidateMessages.length,
        recentMessages: candidateMessages
      };
      if (
        Buffer.byteLength(JSON.stringify(candidate), "utf8") >
        AI_CONVERSATION_MODEL_CONTEXT_BYTE_LIMIT
      ) {
        break;
      }
      recentMessages.unshift(eligibleMessages[index]!);
    }
    const context: AiConversationModelContext = {
      ...base,
      omittedRecentMessageCount: eligibleMessages.length - recentMessages.length,
      recentMessages
    };
    if (
      Buffer.byteLength(JSON.stringify(context), "utf8") > AI_CONVERSATION_MODEL_CONTEXT_BYTE_LIMIT
    ) {
      // This would indicate a programming error in the bounded summary/state constants above.
      throw new ConversationRevisionError("Conversation model context budget exhausted");
    }
    return context;
  }

  private owned(ownerUserId: string, conversationId: string): AiConversation {
    const conversation = this.records.get(cleanIdentifier(conversationId, "conversation id"));
    // Deliberately indistinguishable: callers cannot enumerate another owner's conversation ids.
    if (!conversation || conversation.ownerUserId !== cleanIdentifier(ownerUserId, "owner id")) {
      throw new ConversationNotFoundError("Conversation not found");
    }
    return conversation;
  }
}
