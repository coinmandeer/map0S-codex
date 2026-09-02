import type { DataProvider, PlanDocumentV2 } from "@mapos/layer-sdk";
import { ApiError, apiPostWithMetadata, type ApiResponseWithMetadata } from "../lib/api.js";
import { TaskRegistry, taskRegistry } from "../tasks/TaskRegistry.js";

export interface RoutedPlanResponse {
  plan: PlanDocumentV2;
  failedSegmentIds: string[];
  stats: {
    eligibleSegments: number;
    providerCalls: number;
    cacheHits: number;
    maxConcurrency: number;
  };
}

type RoutingRequest = (
  plan: PlanDocumentV2,
  provider: DataProvider,
  signal: AbortSignal
) => Promise<ApiResponseWithMetadata<RoutedPlanResponse>>;

export interface RoutingTaskOptions {
  registry?: TaskRegistry;
  request?: RoutingRequest;
}

export interface RoutingTaskRun {
  taskId: string;
  result: Promise<RoutedPlanResponse>;
  cancel(): boolean;
}

export const ROUTING_BATCH_STOP_BUDGET = 100;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function routingBatches(plan: PlanDocumentV2): Array<{
  startSegmentIndex: number;
  plan: PlanDocumentV2;
}> {
  if (plan.stops.length <= ROUTING_BATCH_STOP_BUDGET) {
    return [{ startSegmentIndex: 0, plan }];
  }
  const batches: Array<{ startSegmentIndex: number; plan: PlanDocumentV2 }> = [];
  const segmentStep = ROUTING_BATCH_STOP_BUDGET - 1;
  for (let start = 0; start < plan.stops.length - 1; start += segmentStep) {
    const end = Math.min(plan.stops.length, start + ROUTING_BATCH_STOP_BUDGET);
    const stops = plan.stops.slice(start, end).map((stop, order) => ({ ...clone(stop), order }));
    const segments = plan.segments
      .slice(start, end - 1)
      .map((segment, order) => ({ ...clone(segment), order }));
    batches.push({
      startSegmentIndex: start,
      plan: {
        ...clone(plan),
        stops,
        segments,
        // Routing does not consume annotations. Keeping them on the complete document avoids
        // dangling references in a partial transport view.
        annotations: []
      }
    });
  }
  return batches;
}

async function requestBatchedPlan(
  plan: PlanDocumentV2,
  provider: DataProvider,
  signal: AbortSignal,
  request: RoutingRequest
): Promise<ApiResponseWithMetadata<RoutedPlanResponse>> {
  const batches = routingBatches(plan);
  if (batches.length === 1) return request(plan, provider, signal);

  const mergedPlan = clone(plan);
  const failedSegmentIds: string[] = [];
  const stats: RoutedPlanResponse["stats"] = {
    eligibleSegments: 0,
    providerCalls: 0,
    cacheHits: 0,
    maxConcurrency: 0
  };
  let requestId: string | null = null;

  // Sequential transport batches avoid a client-side request burst. Each server batch still
  // routes adjacent segments through its bounded worker queue.
  for (const batch of batches) {
    if (signal.aborted) throw abortError();
    const response = await request(batch.plan, provider, signal);
    if (!requestId && response.requestId) requestId = response.requestId;
    response.data.plan.segments.forEach((segment, localIndex) => {
      const order = batch.startSegmentIndex + localIndex;
      mergedPlan.segments[order] = { ...clone(segment), order };
    });
    mergedPlan.updatedAt = response.data.plan.updatedAt;
    failedSegmentIds.push(...response.data.failedSegmentIds);
    stats.eligibleSegments += response.data.stats.eligibleSegments;
    stats.providerCalls += response.data.stats.providerCalls;
    stats.cacheHits += response.data.stats.cacheHits;
    stats.maxConcurrency = Math.max(stats.maxConcurrency, response.data.stats.maxConcurrency);
  }

  return {
    data: {
      plan: mergedPlan,
      failedSegmentIds: [...new Set(failedSegmentIds)].sort(),
      stats
    },
    requestId
  };
}

function abortError(): Error {
  const error = new Error("Routing request was aborted.");
  error.name = "AbortError";
  return error;
}

export function isRoutingAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function cacheOutcome(stats: RoutedPlanResponse["stats"]): "none" | "hit" | "miss" | "mixed" {
  if (stats.eligibleSegments === 0) return "none";
  if (stats.cacheHits === 0) return "miss";
  return stats.cacheHits >= stats.eligibleSegments ? "hit" : "mixed";
}

const defaultRequest: RoutingRequest = (plan, provider, signal) =>
  apiPostWithMetadata<RoutedPlanResponse>("/v2/routing/plan", { plan, provider }, { signal });

/**
 * Runs adjacent-segment routing as one cancellable local task. Only bounded counters, the
 * code-owned provider ID and a validated server request ID enter diagnostics; the plan, URL and
 * coordinates remain outside the task record.
 */
export function startRoutingPlanTask(
  plan: PlanDocumentV2,
  provider: DataProvider,
  options: RoutingTaskOptions = {}
): RoutingTaskRun {
  const registry = options.registry ?? taskRegistry;
  const request = options.request ?? defaultRequest;
  const controller = new AbortController();
  const task = registry.start({
    type: "routing",
    label: "Počítám trasu",
    cancellable: true,
    cancel: () => controller.abort(),
    telemetry: { providerId: provider, cache: "unknown", aborted: false }
  });

  const result = (async () => {
    try {
      const response = await requestBatchedPlan(plan, provider, controller.signal, request);
      if (controller.signal.aborted || registry.get(task.id)?.status === "cancelled") {
        throw abortError();
      }
      const { stats } = response.data;
      registry.succeed(
        task.id,
        {
          providerId: provider,
          cache: cacheOutcome(stats),
          aborted: false,
          eligibleSegments: stats.eligibleSegments,
          providerCalls: stats.providerCalls,
          cacheHits: stats.cacheHits,
          maxConcurrency: stats.maxConcurrency,
          failedSegments: response.data.failedSegmentIds.length
        },
        response.requestId ? { requestId: response.requestId, providerId: provider } : undefined
      );
      return response.data;
    } catch (error) {
      if (controller.signal.aborted || isRoutingAbortError(error)) {
        registry.cancel(task.id);
        throw isRoutingAbortError(error) ? error : abortError();
      }
      const apiError = error instanceof ApiError ? error : null;
      registry.fail(task.id, {
        code: apiError ? `ROUTING_HTTP_${apiError.status}` : "ROUTING_FAILED",
        message: "Trasu se nepodařilo vypočítat",
        retryable:
          apiError === null ||
          apiError.status === 408 ||
          apiError.status === 429 ||
          apiError.status >= 500,
        telemetry: { providerId: provider, cache: "unknown", aborted: false },
        correlation: apiError?.requestId
          ? { requestId: apiError.requestId, providerId: provider }
          : undefined
      });
      throw error;
    }
  })();

  return {
    taskId: task.id,
    result,
    cancel: () => registry.cancel(task.id)
  };
}
