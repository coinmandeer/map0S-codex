import type { Bbox, FilterValues } from "../types.js";
import type { MapOSFeatureV2, Position } from "./feature.js";

export const FEATURE_QUERY_MAX_LIMIT = 100 as const;

export interface TemporalQueryV2 {
  at?: string;
  from?: string;
  to?: string;
}

export interface FeatureQueryV2 {
  bbox: Bbox;
  center?: Position;
  zoom?: number;
  filters?: FilterValues;
  temporal?: TemporalQueryV2;
  limit?: number;
  cursor?: string;
  fields?: string[];
}

export interface LayerNoticeV2 {
  code: string;
  message: string;
  severity?: "info" | "warning" | "error";
}

export interface FeatureQueryResultV2 {
  data: { type: "FeatureCollection"; features: MapOSFeatureV2[] };
  meta: {
    limit: number;
    returned: number;
    truncated: boolean;
    nextCursor: string | null;
    cache: "hit" | "stale" | "miss";
    sources: Array<{ providerId: string; state: "ready" | "stale" | "unavailable" }>;
    taskId?: string;
  };
  notices: LayerNoticeV2[];
}

export function normalizeFeatureLimit(
  value: unknown,
  fallback: number = FEATURE_QUERY_MAX_LIMIT
): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return Math.min(FEATURE_QUERY_MAX_LIMIT, Math.max(1, fallback));
  return Math.min(FEATURE_QUERY_MAX_LIMIT, Math.max(1, Math.trunc(parsed)));
}

export function featureQueryResult(args: {
  features: MapOSFeatureV2[];
  requestedLimit?: unknown;
  availableCount?: number;
  nextCursor?: string | null;
  cache?: "hit" | "stale" | "miss";
  sources?: FeatureQueryResultV2["meta"]["sources"];
  notices?: LayerNoticeV2[];
  taskId?: string;
}): FeatureQueryResultV2 {
  const limit = normalizeFeatureLimit(args.requestedLimit);
  const features = args.features.slice(0, limit);
  const availableCount = args.availableCount ?? args.features.length;
  return {
    data: { type: "FeatureCollection", features },
    meta: {
      limit,
      returned: features.length,
      truncated: availableCount > features.length,
      nextCursor: availableCount > features.length ? (args.nextCursor ?? null) : null,
      cache: args.cache ?? "miss",
      sources: args.sources ?? [],
      ...(args.taskId ? { taskId: args.taskId } : {})
    },
    notices: args.notices ?? []
  };
}
