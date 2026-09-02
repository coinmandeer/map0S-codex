import type { GamePerformanceTier } from "./avatarAssets";

export interface GameFrameBudget {
  targetFrameMsP50: number;
  maxFrameMsP95: number;
  maxSceneDrawCalls: number;
  maxSceneTriangles: number;
  maxEstimatedGpuBytes: number;
  maxVisibleEntities: number;
}

export const GAME_FRAME_BUDGETS: Record<GamePerformanceTier, GameFrameBudget> = {
  low: {
    targetFrameMsP50: 33.4,
    maxFrameMsP95: 50,
    maxSceneDrawCalls: 24,
    maxSceneTriangles: 45_000,
    maxEstimatedGpuBytes: 48 * 1024 * 1024,
    maxVisibleEntities: 120
  },
  balanced: {
    targetFrameMsP50: 16.7,
    maxFrameMsP95: 33.4,
    maxSceneDrawCalls: 48,
    maxSceneTriangles: 90_000,
    maxEstimatedGpuBytes: 96 * 1024 * 1024,
    maxVisibleEntities: 180
  }
};

export interface GamePerformanceSnapshot {
  sampleCount: number;
  frameMsP50: number | null;
  frameMsP95: number | null;
  drawCalls: number;
  triangles: number;
  estimatedGpuBytes: number;
  visibleEntities: number;
  withinBudget: boolean;
  violations: string[];
}

function percentile(sorted: number[], fraction: number): number | null {
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index]!;
}

export function evaluateGamePerformance(
  tier: GamePerformanceTier,
  measurements: Omit<
    GamePerformanceSnapshot,
    "sampleCount" | "frameMsP50" | "frameMsP95" | "withinBudget" | "violations"
  > & { frameSamplesMs: number[] }
): GamePerformanceSnapshot {
  const budget = GAME_FRAME_BUDGETS[tier];
  const samples = measurements.frameSamplesMs
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  const frameMsP50 = percentile(samples, 0.5);
  const frameMsP95 = percentile(samples, 0.95);
  const violations: string[] = [];
  if (frameMsP50 !== null && frameMsP50 > budget.targetFrameMsP50) violations.push("frame-p50");
  if (frameMsP95 !== null && frameMsP95 > budget.maxFrameMsP95) violations.push("frame-p95");
  if (measurements.drawCalls > budget.maxSceneDrawCalls) violations.push("draw-calls");
  if (measurements.triangles > budget.maxSceneTriangles) violations.push("triangles");
  if (measurements.estimatedGpuBytes > budget.maxEstimatedGpuBytes) violations.push("gpu-memory");
  if (measurements.visibleEntities > budget.maxVisibleEntities) violations.push("entities");
  return {
    sampleCount: samples.length,
    frameMsP50,
    frameMsP95,
    drawCalls: measurements.drawCalls,
    triangles: measurements.triangles,
    estimatedGpuBytes: measurements.estimatedGpuBytes,
    visibleEntities: measurements.visibleEntities,
    withinBudget: violations.length === 0,
    violations
  };
}

export class GamePerformanceMonitor {
  private frameSamplesMs: number[] = [];
  private drawCalls = 0;
  private triangles = 0;
  private estimatedGpuBytes = 0;
  private visibleEntities = 0;

  constructor(private readonly maxSamples = 180) {}

  record(input: {
    frameMs: number;
    drawCalls: number;
    triangles: number;
    geometries: number;
    textures: number;
    visibleEntities: number;
  }): void {
    if (Number.isFinite(input.frameMs) && input.frameMs >= 0) {
      this.frameSamplesMs.push(input.frameMs);
      if (this.frameSamplesMs.length > this.maxSamples) this.frameSamplesMs.shift();
    }
    this.drawCalls = Math.max(0, input.drawCalls);
    this.triangles = Math.max(0, input.triangles);
    // WebGLRenderer does not expose exact allocation. This conservative estimate is labelled as
    // such and is used only as an early warning; device traces remain the release evidence.
    this.estimatedGpuBytes =
      Math.max(0, input.geometries) * 256_000 + Math.max(0, input.textures) * 4_000_000;
    this.visibleEntities = Math.max(0, input.visibleEntities);
  }

  snapshot(tier: GamePerformanceTier): GamePerformanceSnapshot {
    return evaluateGamePerformance(tier, {
      frameSamplesMs: this.frameSamplesMs,
      drawCalls: this.drawCalls,
      triangles: this.triangles,
      estimatedGpuBytes: this.estimatedGpuBytes,
      visibleEntities: this.visibleEntities
    });
  }
}

const PERFORMANCE_STORAGE_KEY = "mapos:game-performance-tier-v1";

export function defaultGamePerformanceTier(): GamePerformanceTier {
  if (typeof window === "undefined") return "low";
  let saved: string | null = null;
  try {
    saved = window.localStorage.getItem(PERFORMANCE_STORAGE_KEY);
  } catch {
    // Privacy/storage restrictions should select a conservative profile, never block the game.
  }
  if (saved === "low" || saved === "balanced") return saved;
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const memory =
    typeof navigator === "undefined"
      ? undefined
      : (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return reducedMotion || (typeof memory === "number" && memory <= 4) ? "low" : "balanced";
}

export function persistGamePerformanceTier(tier: GamePerformanceTier): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PERFORMANCE_STORAGE_KEY, tier);
  } catch {
    // The selected in-memory profile remains valid when persistent storage is unavailable.
  }
}
