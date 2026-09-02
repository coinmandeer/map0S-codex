import assert from "node:assert/strict";
import test from "node:test";
import { OperationalTelemetry } from "./operationalTelemetry.js";

test("operational telemetry retains route templates and rejects provider URLs or secrets", () => {
  const telemetry = new OperationalTelemetry();
  telemetry.recordRequest({
    method: "GET",
    route: "/places?bbox=14.42076,50.08804,14.43,50.09&query=private-note",
    statusCode: 200,
    durationMs: 12
  });
  telemetry.recordRequest({ method: "GET", route: "/places/:id", statusCode: 503, durationMs: 20 });
  assert.throws(
    () =>
      telemetry.recordProvider({
        provider: "https://token@rpc.example?secret=yes",
        outcome: "error",
        durationMs: 8
      }),
    /providerId must be a stable lowercase slug/
  );
  const serialized = JSON.stringify(telemetry.snapshot());
  assert.doesNotMatch(serialized, /14\.42076|private-note|token|secret=yes/);
  assert.match(serialized, /\/unmatched/);
  assert.match(serialized, /\/places\/:id/);
  assert.doesNotMatch(serialized, /unknown/);
});

test("OpenMetrics output is bounded to redacted operational dimensions", () => {
  const telemetry = new OperationalTelemetry();
  telemetry.recordRequest({ method: "POST", route: "/auth/login", statusCode: 401, durationMs: 4 });
  telemetry.recordProvider({ provider: "mapy", outcome: "timeout", durationMs: 3_000 });
  telemetry.recordProvider({ provider: "mapy", outcome: "aborted", durationMs: 4 });
  telemetry.recordAiRun({ status: "succeeded", cached: true, durationMs: 17 });
  telemetry.recordAiRun({ status: "aborted", cached: false, durationMs: 99 });
  const metrics = telemetry.openMetrics([
    {
      provider: "mapy",
      state: "open",
      consecutiveFailures: 4,
      retryAt: null,
      lastSuccessAt: null,
      lastFailureAt: null
    }
  ]);
  assert.match(metrics, /mapos_http_requests_total\{method="POST",route="\/auth\/login"/);
  assert.match(metrics, /mapos_provider_calls_total\{provider="mapy",outcome="timeout"\} 1/);
  assert.match(metrics, /mapos_provider_calls_total\{provider="mapy",outcome="aborted"\} 1/);
  assert.match(metrics, /mapos_provider_circuit_open\{provider="mapy"\} 1/);
  assert.match(metrics, /mapos_ai_runs_total\{status="succeeded",cached="true"\} 1/);
  assert.match(metrics, /mapos_ai_runs_total\{status="aborted",cached="false"\} 1/);
  assert.match(metrics, /mapos_ai_run_duration_milliseconds_sum/);
});

test("AI metrics cannot retain prompt, model, source or account dimensions", () => {
  const telemetry = new OperationalTelemetry();
  telemetry.recordAiRun({ status: "provider-error", cached: false, durationMs: 42 });
  const serialized = JSON.stringify(telemetry.snapshot());
  assert.match(serialized, /provider-error/);
  for (const forbidden of ["prompt", "model", "source", "account", "runId"]) {
    assert.equal(
      serialized.includes(forbidden),
      false,
      `retained forbidden AI field: ${forbidden}`
    );
  }
});
