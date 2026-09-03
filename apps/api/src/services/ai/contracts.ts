export type AiDataClass = "public" | "account-private" | "precise-user-location" | "secret";

export interface AiCitation {
  sourceId: string;
  label: string;
  url?: string;
  providerId?: string;
  retrievedAt?: string;
}

export interface AiSourceBlock extends AiCitation {
  /** Untrusted provider/community text. It is data, never a system instruction. */
  content: string;
  dataClass: AiDataClass;
}

export interface AiModelProfile {
  id: string;
  providerId: string;
  model: string;
  capabilities: {
    text: boolean;
    jsonSchema: boolean;
    tools: boolean;
    streaming: boolean;
    vision: boolean;
  };
  limits: {
    contextTokens: number;
    outputTokens: number;
    maxToolRounds: number;
    timeoutMs: number;
    maxResponseBytes: number;
  };
  privacy: {
    execution: "external" | "private-cloud" | "local" | "disabled";
    allowedDataClasses: AiDataClass[];
    residency?: string[];
    retention: "none" | "provider-policy";
  };
  costPolicy: "economy" | "balanced" | "quality";
}

/** One tool as the model sees it: a name, a sentence of purpose and a JSON schema for the
 *  arguments. The same schema the registry validates against, so a model that follows it lands
 *  on a call the server can actually execute. */
export interface AiToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AiToolCall {
  id: string;
  name: string;
  /** Parsed arguments. A call whose arguments are not valid JSON never reaches a caller. */
  arguments: Record<string, unknown>;
}

/** A turn carried back to the model so a tool loop has memory: what it asked for and what the
 *  server answered. */
export type AiChatTurn =
  | { role: "user" | "assistant"; content: string }
  | { role: "assistant"; content: string; toolCalls: readonly AiToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export interface AiAdapterRequest {
  runId: string;
  taskId: string;
  templateVersion: string;
  system: string;
  prompt: string;
  outputSchema?: Record<string, unknown>;
  /** Earlier turns of this conversation, sent between the system prompt and `prompt`. */
  history?: readonly AiChatTurn[];
  tools?: readonly AiToolSpec[];
  /** `"auto"` lets the model answer in text; a name forces exactly that call, which is how a
   *  structured result is obtained from providers that ignore JSON-schema output (§30.2). */
  toolChoice?: "auto" | { name: string };
  maxOutputTokens: number;
  maxResponseBytes: number;
  temperature: number;
}

export interface AiAdapterResult {
  text: string;
  finishReason: "stop" | "length" | "content-filter" | "tool-call" | "unknown";
  toolCalls?: readonly AiToolCall[];
  providerRequestId?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface AiModelAdapter {
  readonly id: string;
  readonly capabilities: AiModelProfile["capabilities"];
  run(request: AiAdapterRequest, signal: AbortSignal): Promise<AiAdapterResult>;
}

export interface AiRunMeta {
  runId: string;
  taskId: string;
  templateVersion: string;
  profileId: string;
  providerId: string;
  model: string;
  cached: boolean;
  durationMs: number;
  finishReason?: AiAdapterResult["finishReason"];
  usage?: AiAdapterResult["usage"];
}

export type AiRunStatus =
  | "unavailable"
  | "policy-denied"
  | "rate-limited"
  | "timeout"
  | "aborted"
  | "invalid-output"
  | "provider-error";

export type AiRunOutcome<T> =
  | { status: "succeeded"; value: T; citations: AiCitation[]; meta: AiRunMeta }
  | { status: AiRunStatus; meta: AiRunMeta };

export interface AiGatewayRequest<T> {
  taskId: string;
  templateVersion: string;
  schemaId: string;
  system: string;
  prompt: string;
  profile: AiModelProfile;
  permissionPartition: string;
  sourceBlocks: AiSourceBlock[];
  outputSchema?: Record<string, unknown>;
  parse(text: string): T;
  citedSourceIds(value: T): string[];
  temperature?: number;
  ttlMs?: number;
  signal?: AbortSignal;
}

/** A single round of a tool loop. Unlike {@link AiGatewayRequest} it is neither cached nor
 *  parsed: the caller owns the loop, and a round that repeats verbatim still has to run because
 *  the tools it drives have side effects on the conversation. */
export interface AiTurnRequest {
  taskId: string;
  templateVersion: string;
  system: string;
  prompt: string;
  profile: AiModelProfile;
  permissionPartition: string;
  sourceBlocks: AiSourceBlock[];
  history?: readonly AiChatTurn[];
  tools?: readonly AiToolSpec[];
  toolChoice?: "auto" | { name: string };
  temperature?: number;
  signal?: AbortSignal;
}

export type AiTurnOutcome =
  | {
      status: "succeeded";
      text: string;
      toolCalls: readonly AiToolCall[];
      citations: AiCitation[];
      meta: AiRunMeta;
    }
  | { status: AiRunStatus; meta: AiRunMeta };

/** Metadata-only audit record. Prompts, source contents, permission partitions and parsed output
 * are intentionally absent so the default observer cannot become a private-data store. */
export interface AiRunTrace {
  at: string;
  status: "succeeded" | AiRunStatus;
  meta: AiRunMeta;
  sourceCount: number;
  sourceDataClasses: AiDataClass[];
  promptChars: number;
  structuredOutput: boolean;
  citationCount: number;
}
