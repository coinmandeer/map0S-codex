/**
 * Compatibility facade for existing generated-text callers.
 *
 * Transport, privacy policy, timeout, cache partition and response bounds live in the unified AI
 * gateway. Model calls are opt-in twice: the deployment enables the gateway and the caller proves
 * that its prompt was assembled only from reviewed public data. A free-form browser value therefore
 * falls back without ever reaching an external provider.
 */

import { config } from "../config.js";
import { DisabledAiAdapter, OpenAiCompatibleAdapter } from "./ai/adapters.js";
import type { AiModelAdapter, AiModelProfile } from "./ai/contracts.js";
import { AiGateway } from "./ai/gateway.js";
import { operationalTelemetry } from "../observability/operationalTelemetry.js";
import type { AiRunTrace } from "./ai/contracts.js";

export interface CmlRequest {
  cacheKey: string;
  system: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  ttlMs?: number;
  /** Set only after the server, not a browser field, established public provenance. */
  verifiedPublic?: boolean;
  /** Server-side proof that this one request may send bounded account-private context externally. */
  accountPrivateConsent?: boolean;
  /** Stable owner partition; required for account-private caching and deduplication. */
  permissionPartition?: string;
  signal?: AbortSignal;
}

export interface CmlAnswer {
  text: string;
  model: string;
  cached: boolean;
}

let runtime: { gateway: AiGateway; profile: AiModelProfile } | null = null;

/** Production observer for metadata-only AI aggregates. The trace contract contains richer
 * diagnostics, but this boundary intentionally forwards only status/cache/duration. */
export function recordCmlTrace(trace: AiRunTrace): void {
  operationalTelemetry.recordAiRun({
    status: trace.status,
    cached: trace.meta.cached,
    durationMs: trace.meta.durationMs
  });
}

const capabilities: AiModelProfile["capabilities"] = {
  text: true,
  jsonSchema: true,
  tools: false,
  streaming: false,
  vision: false
};

function disabledRuntime() {
  const adapter = new DisabledAiAdapter();
  return {
    gateway: new AiGateway([adapter], { onTrace: recordCmlTrace }),
    profile: {
      id: "disabled",
      providerId: adapter.id,
      model: "none",
      capabilities: adapter.capabilities,
      limits: {
        contextTokens: 4_000,
        outputTokens: 1_000,
        maxToolRounds: 0,
        timeoutMs: 15_000,
        maxResponseBytes: 16_384
      },
      privacy: {
        execution: "disabled",
        allowedDataClasses: [],
        retention: "none"
      },
      costPolicy: "economy"
    } satisfies AiModelProfile
  };
}

function configuredRuntime(): { gateway: AiGateway; profile: AiModelProfile } {
  if (!config.aiGatewayEnabled) return disabledRuntime();

  let adapter: AiModelAdapter | null = null;
  let model = "none";
  if (config.cmlProvider === "openai" && config.openaiKey) {
    model = config.openaiModel;
    adapter = new OpenAiCompatibleAdapter({
      id: "openai",
      baseUrl: "https://api.openai.com/v1",
      apiKey: config.openaiKey,
      model
    });
  } else if (config.cmlProvider === "ollama" && config.ollamaKey) {
    model = config.ollamaModel;
    adapter = new OpenAiCompatibleAdapter({
      id: "ollama",
      baseUrl: config.ollamaBaseUrl,
      apiKey: config.ollamaKey,
      model
    });
  }
  if (!adapter) return disabledRuntime();

  const profile: AiModelProfile = {
    id: `${adapter.id}-economy`,
    providerId: adapter.id,
    model,
    capabilities,
    limits: {
      contextTokens: 8_000,
      outputTokens: 2_000,
      maxToolRounds: 0,
      timeoutMs: 25_000,
      maxResponseBytes: 16_384
    },
    privacy: {
      execution: "external",
      allowedDataClasses: ["public", "account-private"],
      retention: "provider-policy"
    },
    costPolicy: "economy"
  };
  return { gateway: new AiGateway([adapter], { onTrace: recordCmlTrace }), profile };
}

function currentRuntime() {
  runtime ??= configuredRuntime();
  return runtime;
}

/** Test/config seam. No generated answer or prompt remains after reset. */
export function __resetCmlCache() {
  runtime?.gateway.reset();
  runtime = null;
}

export async function askCml(request: CmlRequest): Promise<CmlAnswer | null> {
  const accountPrivate =
    request.accountPrivateConsent === true && Boolean(request.permissionPartition?.trim());
  if (!request.verifiedPublic && !accountPrivate) return null;
  const { gateway, profile } = currentRuntime();
  const outcome = await gateway.run({
    taskId: "legacy-public-text",
    templateVersion: "legacy-public-text.v1",
    schemaId: "plain-text.v1",
    system: request.system,
    prompt: "Zpracuj dodaný veřejný zdrojový blok podle systémových pravidel.",
    profile: {
      ...profile,
      limits: {
        ...profile.limits,
        outputTokens: Math.min(Math.max(1, request.maxTokens ?? 2_000), 4_000)
      }
    },
    permissionPartition: accountPrivate ? request.permissionPartition!.trim() : "public",
    sourceBlocks: [
      {
        sourceId: `context:${request.cacheKey}`,
        label: "MapOS public context",
        content: request.prompt,
        dataClass: accountPrivate ? "account-private" : "public"
      }
    ],
    parse(text) {
      const value = text.trim();
      if (!value || value.length > 4_000) throw new Error("Invalid generated text");
      return value;
    },
    citedSourceIds: () => [],
    temperature: request.temperature,
    ttlMs: request.ttlMs,
    signal: request.signal
  });
  if (outcome.status !== "succeeded") return null;
  return { text: outcome.value, model: outcome.meta.model, cached: outcome.meta.cached };
}

export function cmlAvailable(): boolean {
  return config.aiGatewayEnabled && config.cmlProvider !== "none";
}
