import type { VersionEnvelope } from "./common.js";

export type TaskTypeV2 =
  | "layer-query"
  | "tile-load"
  | "geocode"
  | "reverse-geocode"
  | "routing"
  | "weather"
  | "event-search"
  | "ai"
  | "poi-enrichment"
  | "import"
  | "export"
  | "sync"
  | "game-asset"
  | "commerce";

export type TaskStatusV2 = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "stale";

export interface TaskErrorV2 {
  code: string;
  message: string;
  retryable: boolean;
}

/**
 * Privacy-safe, locally retained task diagnostics. Only these code-owned scalar fields are
 * accepted; arbitrary telemetry keys could otherwise become an accidental channel for queries,
 * coordinates or account identifiers. Request correlation lives in the separate bounded object.
 */
export interface TaskTelemetryV2 {
  durationMs?: number;
  aborted?: boolean;
  cache?: "unknown" | "none" | "hit" | "miss" | "mixed";
  providerId?: string | null;
  source?: string | null;
  budget?: number;
  received?: number;
  eligibleSegments?: number;
  providerCalls?: number;
  cacheHits?: number;
  maxConcurrency?: number;
  failedSegments?: number;
}

export interface TaskCorrelationV2 {
  /** Server-generated UUID request identifier; never a URL or request input. */
  requestId: string;
  /** Code-owned provider adapter slug selected for this request. */
  providerId: string;
}

export interface TaskRecordV2 extends VersionEnvelope {
  schema: "mapos.task";
  schemaVersion: string;
  id: string;
  type: TaskTypeV2;
  label: string;
  status: TaskStatusV2;
  progress?: number | null;
  message?: string | null;
  layerId?: string | null;
  parentId?: string | null;
  /** Optional opaque digest (`rk_` + 16–64 lowercase hex chars), never a raw query/cache key. */
  requestKey?: string | null;
  startedAt: string;
  finishedAt?: string | null;
  cancellable: boolean;
  error?: TaskErrorV2 | null;
  telemetry?: TaskTelemetryV2;
  correlation?: TaskCorrelationV2 | null;
}
