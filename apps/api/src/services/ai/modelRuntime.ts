/**
 * The two model slots the product runs on (§30.2).
 *
 * `fast` answers the intent router, the tool loop and every short summary — dozens of calls where
 * latency is the whole experience. `strong` writes the one slow answer that has to be right (a
 * multi-day plan, a generated layer). Each slot has a fallback model, registered as its own
 * adapter, because a cloud provider retiring a model is a normal Tuesday and not an outage we
 * should pass on to the user.
 *
 * Every profile is produced here so the gateway's privacy, cache-partition and byte limits are
 * identical on all AI paths; callers pick a slot, never a model name.
 */

import { config } from "../../config.js";
import { DisabledAiAdapter, OpenAiCompatibleAdapter } from "./adapters.js";
import type { AiModelAdapter, AiModelProfile, AiRunTrace } from "./contracts.js";
import { AiGateway } from "./gateway.js";
import { operationalTelemetry } from "../../observability/operationalTelemetry.js";

export type AiModelSlot = "fast" | "strong";

/** Metadata-only aggregate. The trace carries more, but nothing beyond this leaves the process. */
export function recordAiRunTrace(trace: AiRunTrace): void {
  operationalTelemetry.recordAiRun({
    status: trace.status,
    cached: trace.meta.cached,
    durationMs: trace.meta.durationMs
  });
}

const SLOT_LIMITS: Record<AiModelSlot, AiModelProfile["limits"]> = {
  fast: {
    contextTokens: 16_000,
    outputTokens: 2_000,
    maxToolRounds: 6,
    timeoutMs: 25_000,
    maxResponseBytes: 32_768
  },
  strong: {
    contextTokens: 32_000,
    outputTokens: 4_000,
    maxToolRounds: 6,
    timeoutMs: 25_000,
    maxResponseBytes: 65_536
  }
};

interface SlotModels {
  primary: string;
  fallback?: string;
}

function slotModels(slot: AiModelSlot): SlotModels {
  if (config.cmlProvider === "openai") {
    return { primary: config.openaiModel };
  }
  return slot === "fast"
    ? { primary: config.ollamaModelFast, fallback: "deepseek-v4-flash:0731" }
    : { primary: config.ollamaModelStrong, fallback: "kimi-k3" };
}

function providerTransport(): { id: string; baseUrl: string; apiKey: string } | null {
  if (config.cmlProvider === "openai" && config.openaiKey) {
    return { id: "openai", baseUrl: "https://api.openai.com/v1", apiKey: config.openaiKey };
  }
  if (config.cmlProvider === "ollama" && config.ollamaKey) {
    return { id: "ollama", baseUrl: config.ollamaBaseUrl, apiKey: config.ollamaKey };
  }
  return null;
}

function profile(
  slot: AiModelSlot,
  providerId: string,
  model: string,
  execution: AiModelProfile["privacy"]["execution"]
): AiModelProfile {
  return {
    id: `${providerId}-${slot}`,
    providerId,
    model,
    capabilities: {
      text: true,
      // Declared as verified on 2 Sep 2026: tool calling works on the cloud, JSON-schema output
      // does not, which is why structured results travel as a forced tool call instead.
      jsonSchema: false,
      tools: execution !== "disabled",
      streaming: false,
      vision: false
    },
    limits: SLOT_LIMITS[slot],
    privacy: {
      execution,
      allowedDataClasses: execution === "disabled" ? [] : ["public", "account-private"],
      retention: execution === "disabled" ? "none" : "provider-policy"
    },
    costPolicy: slot === "fast" ? "economy" : "balanced"
  };
}

export interface AiModelRuntime {
  gateway: AiGateway;
  enabled: boolean;
  /** Primary profile first, fallback second. A caller retries the next one only on a provider
   *  failure, never on a refusal: a policy denial is the same answer from every model. */
  profiles(slot: AiModelSlot): readonly AiModelProfile[];
}

let runtime: AiModelRuntime | null = null;

function disabledRuntime(): AiModelRuntime {
  const adapter = new DisabledAiAdapter();
  const gateway = new AiGateway([adapter], { onTrace: recordAiRunTrace });
  const profiles = {
    fast: [profile("fast", adapter.id, "none", "disabled")],
    strong: [profile("strong", adapter.id, "none", "disabled")]
  } as const;
  return { gateway, enabled: false, profiles: (slot) => profiles[slot] };
}

function configuredRuntime(): AiModelRuntime {
  const transport = config.aiGatewayEnabled ? providerTransport() : null;
  if (!transport) return disabledRuntime();

  const adapters: AiModelAdapter[] = [];
  const profiles: Record<AiModelSlot, AiModelProfile[]> = { fast: [], strong: [] };
  const byModel = new Map<string, string>();
  for (const slot of ["fast", "strong"] as const) {
    const { primary, fallback } = slotModels(slot);
    for (const model of fallback && fallback !== primary ? [primary, fallback] : [primary]) {
      // One adapter per distinct model: the gateway resolves an adapter by provider id, and the
      // same model reached through two ids would cache the same answer twice.
      let providerId = byModel.get(model);
      if (!providerId) {
        // Provider ids are circuit-breaker and telemetry keys, so they have to stay stable
        // lowercase slugs; model names carry colons (`deepseek-v4-flash:0731`) and would not.
        providerId = `${transport.id}-${model.toLowerCase().replace(/[^a-z0-9._-]+/gu, "-")}`.slice(
          0,
          64
        );
        byModel.set(model, providerId);
        adapters.push(new OpenAiCompatibleAdapter({ ...transport, id: providerId, model }));
      }
      profiles[slot].push(profile(slot, providerId, model, "external"));
    }
  }
  return {
    gateway: new AiGateway(adapters, { onTrace: recordAiRunTrace }),
    enabled: true,
    profiles: (slot) => profiles[slot]
  };
}

export function aiModelRuntime(): AiModelRuntime {
  runtime ??= configuredRuntime();
  return runtime;
}

/** Test/config seam. No generated answer or prompt survives a reset. */
export function __resetAiModelRuntime(): void {
  runtime?.gateway.reset();
  runtime = null;
}
