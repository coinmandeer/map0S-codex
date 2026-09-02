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

export interface AiAdapterRequest {
  runId: string;
  taskId: string;
  templateVersion: string;
  system: string;
  prompt: string;
  outputSchema?: Record<string, unknown>;
  maxOutputTokens: number;
  maxResponseBytes: number;
  temperature: number;
}

export interface AiAdapterResult {
  text: string;
  finishReason: "stop" | "length" | "content-filter" | "tool-call" | "unknown";
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
