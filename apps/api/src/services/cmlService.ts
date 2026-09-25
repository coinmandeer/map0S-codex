/**
 * Compatibility facade for existing generated-text callers.
 *
 * Transport, privacy policy, timeout, cache partition and response bounds live in the unified AI
 * gateway. Model calls are opt-in twice: the deployment enables the gateway and the caller proves
 * that its prompt was assembled only from reviewed public data. A free-form browser value therefore
 * falls back without ever reaching an external provider.
 */

import { config } from "../config.js";
import { __resetAiModelRuntime, aiModelRuntime, recordAiRunTrace } from "./ai/modelRuntime.js";

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

/** Production observer for metadata-only AI aggregates. The trace contract contains richer
 * diagnostics, but this boundary intentionally forwards only status/cache/duration. */
export const recordCmlTrace = recordAiRunTrace;

/** Test/config seam. No generated answer or prompt remains after reset. */
export function __resetCmlCache() {
  __resetAiModelRuntime();
}

export async function askCml(request: CmlRequest): Promise<CmlAnswer | null> {
  const accountPrivate =
    request.accountPrivateConsent === true && Boolean(request.permissionPartition?.trim());
  if (!request.verifiedPublic && !accountPrivate) return null;
  const { gateway, profiles } = aiModelRuntime();
  // Short generated prose is the fast slot's job; the strong slot is reserved for the one answer
  // per request that has to be right.
  const profile = profiles("fast")[0]!;
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
