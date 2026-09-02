import { assertProviderId, type CircuitSnapshot } from "./providerCircuitBreaker.js";

interface RequestMetric {
  method: string;
  route: string;
  statusClass: string;
  count: number;
  durationMsSum: number;
  durationMsMax: number;
}

interface ProviderMetric {
  provider: string;
  outcome: "success" | "error" | "timeout" | "aborted" | "circuit-open";
  count: number;
  durationMsSum: number;
}

interface ProviderTrace {
  correlationId: string;
  provider: string;
  outcome: ProviderMetric["outcome"];
  durationMs: number;
  finishedAt: string;
}

interface AiMetric {
  status: string;
  cached: boolean;
  count: number;
  durationMsSum: number;
  durationMsMax: number;
}

const AI_STATUSES = new Set([
  "succeeded",
  "unavailable",
  "policy-denied",
  "rate-limited",
  "timeout",
  "aborted",
  "invalid-output",
  "provider-error"
]);

const ROUTE = /^\/[A-Za-z0-9_:/.*-]{0,159}$/;

function safeRoute(value: string | undefined): string {
  if (!value || value.includes("?") || !ROUTE.test(value)) return "/unmatched";
  return value;
}

function finiteDuration(value: number): number {
  return Number.isFinite(value) ? Math.min(3_600_000, Math.max(0, value)) : 0;
}

function label(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n");
}

/**
 * Process telemetry deliberately stores only route templates and fixed provider IDs. It has no
 * field for URL query, coordinates, prompt, note, e-mail, wallet or session identifiers.
 */
export class OperationalTelemetry {
  private readonly requests = new Map<string, RequestMetric>();
  private readonly providers = new Map<string, ProviderMetric>();
  private readonly providerTraces: ProviderTrace[] = [];
  private readonly aiRuns = new Map<string, AiMetric>();
  private readonly startedAt = new Date();

  recordRequest(input: {
    method: string;
    route?: string;
    statusCode: number;
    durationMs: number;
  }): void {
    const method = /^[A-Z]{3,8}$/.test(input.method) ? input.method : "OTHER";
    const route = safeRoute(input.route);
    const statusClass =
      Number.isInteger(input.statusCode) && input.statusCode >= 100 && input.statusCode <= 599
        ? `${Math.floor(input.statusCode / 100)}xx`
        : "other";
    const key = `${method}\u0000${route}\u0000${statusClass}`;
    const metric = this.requests.get(key) ?? {
      method,
      route,
      statusClass,
      count: 0,
      durationMsSum: 0,
      durationMsMax: 0
    };
    const durationMs = finiteDuration(input.durationMs);
    metric.count += 1;
    metric.durationMsSum += durationMs;
    metric.durationMsMax = Math.max(metric.durationMsMax, durationMs);
    if (this.requests.size < 512 || this.requests.has(key)) this.requests.set(key, metric);
  }

  recordProvider(input: {
    provider: string;
    outcome: ProviderMetric["outcome"];
    durationMs: number;
    correlationId?: string | null;
  }): void {
    const provider = assertProviderId(input.provider);
    const key = `${provider}\u0000${input.outcome}`;
    const metric = this.providers.get(key) ?? {
      provider,
      outcome: input.outcome,
      count: 0,
      durationMsSum: 0
    };
    metric.count += 1;
    metric.durationMsSum += finiteDuration(input.durationMs);
    if (this.providers.size < 256 || this.providers.has(key)) this.providers.set(key, metric);
    if (input.correlationId && /^[a-f0-9-]{16,64}$/i.test(input.correlationId)) {
      this.providerTraces.push({
        correlationId: input.correlationId,
        provider,
        outcome: input.outcome,
        durationMs: finiteDuration(input.durationMs),
        finishedAt: new Date().toISOString()
      });
      if (this.providerTraces.length > 100) {
        this.providerTraces.splice(0, this.providerTraces.length - 100);
      }
    }
  }

  /** Aggregate-only AI diagnostics. Prompts, sources, models, account partitions and run IDs are
   * deliberately not accepted by this API, so callers cannot accidentally turn metrics into a
   * private prompt log. */
  recordAiRun(input: { status: string; cached: boolean; durationMs: number }): void {
    const status = AI_STATUSES.has(input.status) ? input.status : "invalid-status";
    const cached = Boolean(input.cached);
    const key = `${status}\u0000${cached ? "cached" : "uncached"}`;
    const metric = this.aiRuns.get(key) ?? {
      status,
      cached,
      count: 0,
      durationMsSum: 0,
      durationMsMax: 0
    };
    const durationMs = finiteDuration(input.durationMs);
    metric.count += 1;
    metric.durationMsSum += durationMs;
    metric.durationMsMax = Math.max(metric.durationMsMax, durationMs);
    if (this.aiRuns.size < 32 || this.aiRuns.has(key)) this.aiRuns.set(key, metric);
  }

  snapshot(circuits: readonly CircuitSnapshot[] = []) {
    return {
      startedAt: this.startedAt.toISOString(),
      generatedAt: new Date().toISOString(),
      requests: [...this.requests.values()].map((value) => ({ ...value })),
      providers: [...this.providers.values()].map((value) => ({ ...value })),
      providerTraces: this.providerTraces.map((value) => ({ ...value })),
      aiRuns: [...this.aiRuns.values()].map((value) => ({ ...value })),
      circuits: circuits.map((value) => ({ ...value }))
    };
  }

  openMetrics(circuits: readonly CircuitSnapshot[] = []): string {
    const lines = [
      "# HELP mapos_http_requests_total Requests grouped only by method, route template and status class.",
      "# TYPE mapos_http_requests_total counter"
    ];
    for (const item of this.requests.values()) {
      const labels = `method="${label(item.method)}",route="${label(item.route)}",status_class="${label(item.statusClass)}"`;
      lines.push(`mapos_http_requests_total{${labels}} ${item.count}`);
      lines.push(`mapos_http_request_duration_milliseconds_sum{${labels}} ${item.durationMsSum}`);
      lines.push(`mapos_http_request_duration_milliseconds_max{${labels}} ${item.durationMsMax}`);
    }
    lines.push(
      "# HELP mapos_provider_calls_total Provider outcomes without request URLs or user data.",
      "# TYPE mapos_provider_calls_total counter"
    );
    for (const item of this.providers.values()) {
      const labels = `provider="${label(item.provider)}",outcome="${item.outcome}"`;
      lines.push(`mapos_provider_calls_total{${labels}} ${item.count}`);
      lines.push(`mapos_provider_duration_milliseconds_sum{${labels}} ${item.durationMsSum}`);
    }
    lines.push("# HELP mapos_provider_circuit_open Whether a provider circuit is currently open.");
    lines.push("# TYPE mapos_provider_circuit_open gauge");
    for (const circuit of circuits) {
      lines.push(
        `mapos_provider_circuit_open{provider="${label(assertProviderId(circuit.provider))}"} ${circuit.state === "open" ? 1 : 0}`
      );
    }
    lines.push(
      "# HELP mapos_ai_runs_total AI outcomes aggregated without prompts, sources, models or user identifiers.",
      "# TYPE mapos_ai_runs_total counter"
    );
    for (const item of this.aiRuns.values()) {
      const labels = `status="${label(item.status)}",cached="${item.cached ? "true" : "false"}"`;
      lines.push(`mapos_ai_runs_total{${labels}} ${item.count}`);
      lines.push(`mapos_ai_run_duration_milliseconds_sum{${labels}} ${item.durationMsSum}`);
      lines.push(`mapos_ai_run_duration_milliseconds_max{${labels}} ${item.durationMsMax}`);
    }
    return `${lines.join("\n")}\n`;
  }

  clear(): void {
    this.requests.clear();
    this.providers.clear();
    this.providerTraces.splice(0);
    this.aiRuns.clear();
  }
}

export const operationalTelemetry = new OperationalTelemetry();
