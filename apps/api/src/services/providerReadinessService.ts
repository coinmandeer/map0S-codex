import { config } from "../config.js";
import { db } from "../db/index.js";
import { mapyCells } from "../db/schema.js";
import { safeErrorLogFields } from "../utils/clientError.js";
import { mapySuggest } from "./mapyService.js";

export type ProviderReadinessStatus = "unconfigured" | "ready" | "degraded";

export interface ProviderReadiness {
  status: ProviderReadinessStatus;
  checkedAt: string;
  tookMs: number;
  message?: string;
}

interface MapyReadinessDependencies {
  configured: boolean;
  checkDatabase(): Promise<void>;
  checkUpstream(): Promise<void>;
  now(): number;
  warn?(error: unknown): void;
}

const defaults: MapyReadinessDependencies = {
  configured: Boolean(config.mapyKey),
  async checkDatabase() {
    // The production incident was a configured provider backed by a table the runtime migration
    // never created. A one-row read makes that class of failure part of readiness.
    await db.select({ id: mapyCells.id }).from(mapyCells).limit(1);
  },
  async checkUpstream() {
    // One small regional suggest validates the key and the upstream response shape. The result is
    // cached below, so this costs at most one request per fifteen minutes per API process.
    await mapySuggest({ query: "Praha", lang: "cs", limit: 1, type: "regional" });
  },
  now: Date.now,
  warn(error) {
    console.warn("Mapy.com readiness check failed", safeErrorLogFields(error));
  }
};

export async function checkMapyReadiness(
  dependencies: MapyReadinessDependencies = defaults
): Promise<ProviderReadiness> {
  const started = dependencies.now();
  if (!dependencies.configured) {
    return {
      status: "unconfigured",
      checkedAt: new Date(started).toISOString(),
      tookMs: 0
    };
  }

  try {
    await dependencies.checkDatabase();
    await dependencies.checkUpstream();
    const finished = dependencies.now();
    return {
      status: "ready",
      checkedAt: new Date(finished).toISOString(),
      tookMs: finished - started
    };
  } catch (error) {
    // Full detail belongs in server logs. The config response carries only a stable public state.
    dependencies.warn?.(error);
    const finished = dependencies.now();
    return {
      status: "degraded",
      checkedAt: new Date(finished).toISOString(),
      tookMs: finished - started,
      message: "Mapy.com momentálně není dostupné"
    };
  }
}

const READY_TTL_MS = 15 * 60_000;
const DEGRADED_TTL_MS = 60_000;
let cached: { value: ProviderReadiness; expiresAt: number } | null = null;
let inFlight: Promise<ProviderReadiness> | null = null;

export async function getMapyReadiness(
  dependencies: MapyReadinessDependencies = defaults
): Promise<ProviderReadiness> {
  const now = dependencies.now();
  if (cached && cached.expiresAt > now) return cached.value;
  if (inFlight) return inFlight;

  inFlight = checkMapyReadiness(dependencies);
  try {
    const value = await inFlight;
    const ttl = value.status === "degraded" ? DEGRADED_TTL_MS : READY_TTL_MS;
    cached = { value, expiresAt: dependencies.now() + ttl };
    return value;
  } finally {
    inFlight = null;
  }
}

export function __resetProviderReadiness() {
  cached = null;
  inFlight = null;
}
