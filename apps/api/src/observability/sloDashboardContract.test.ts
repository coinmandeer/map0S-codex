import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

interface DashboardView {
  id: string;
  domain: string;
  ownership: string;
  source: string;
  exportMode: string;
  signals: string[];
  fields: string[];
}

interface DashboardContract {
  schema: string;
  schemaVersion: string;
  mode: string;
  targetPolicy: string;
  views: DashboardView[];
  forbiddenDimensions: string[];
}

const CONTRACT_URL = new URL("../../../../docs/operations/slo-dashboard.json", import.meta.url);

async function loadContract(): Promise<DashboardContract> {
  return JSON.parse(await readFile(CONTRACT_URL, "utf8")) as DashboardContract;
}

test("SLO dashboard contract separates MapOS failures from provider outages", async () => {
  const contract = await loadContract();
  assert.equal(contract.schema, "mapos.operational-dashboard");
  assert.equal(contract.mode, "baseline-only");
  assert.match(contract.targetPolicy, /No availability or latency target/);

  const byDomain = new Map(contract.views.map((view) => [view.domain, view]));
  assert.equal(byDomain.get("core")?.ownership, "mapos");
  assert.equal(byDomain.get("provider")?.ownership, "external-provider");
  assert.notEqual(byDomain.get("core")?.source, byDomain.get("provider")?.source);
});

test("telemetry contract covers every Phase 17/18 performance signal", async () => {
  const contract = await loadContract();
  const domains = new Set(contract.views.map((view) => view.domain));
  for (const domain of ["provider", "map", "ai", "routing", "3d"]) {
    assert.ok(domains.has(domain), `missing ${domain} telemetry view`);
  }

  const signals = new Set(contract.views.flatMap((view) => view.signals));
  for (const signal of ["latency", "errors", "cache", "aborts", "task-duration", "frame"]) {
    assert.ok(signals.has(signal), `missing ${signal} signal`);
  }
  for (const view of contract.views) {
    assert.ok(view.id.length > 0);
    assert.ok(view.source.length > 0);
    assert.ok(view.exportMode.length > 0);
    assert.ok(view.fields.length > 0);
  }
});

test("dashboard dimensions explicitly exclude private inputs", async () => {
  const contract = await loadContract();
  const forbidden = new Set(contract.forbiddenDimensions);
  for (const dimension of [
    "rawUrl",
    "query",
    "coordinates",
    "prompt",
    "privateNote",
    "email",
    "wallet",
    "cookie",
    "signature",
    "apiKey",
    "sessionId"
  ]) {
    assert.ok(forbidden.has(dimension), `missing redaction rule for ${dimension}`);
  }
});

test("routing view names the local task stats and safe request/provider correlation", async () => {
  const contract = await loadContract();
  const routing = contract.views.find((view) => view.domain === "routing");
  assert.ok(routing);
  for (const field of [
    "TaskRecordV2.status",
    "TaskRecordV2.error.code",
    "TaskRecordV2.telemetry.durationMs",
    "TaskRecordV2.telemetry.aborted",
    "TaskRecordV2.telemetry.cache",
    "TaskRecordV2.telemetry.eligibleSegments",
    "TaskRecordV2.telemetry.providerCalls",
    "TaskRecordV2.telemetry.cacheHits",
    "TaskRecordV2.telemetry.maxConcurrency",
    "TaskRecordV2.telemetry.failedSegments",
    "TaskRecordV2.correlation.requestId",
    "TaskRecordV2.correlation.providerId"
  ]) {
    assert.ok(routing.fields.includes(field), `missing routing field ${field}`);
  }
});

test("browser-managed providers are represented as local-only bounded aggregates", async () => {
  const contract = await loadContract();
  const clientProvider = contract.views.find((view) => view.domain === "provider-client");
  assert.ok(clientProvider);
  assert.equal(clientProvider.ownership, "external-provider");
  assert.equal(clientProvider.exportMode, "local-diagnostic");
  assert.match(clientProvider.source, /BrowserProviderHealth/);
  for (const signal of ["latency", "errors", "aborts"]) {
    assert.ok(clientProvider.signals.includes(signal), `missing browser provider signal ${signal}`);
  }
  for (const field of [
    "providerId",
    "outcome",
    "count",
    "durationMsSum",
    "durationMsMax",
    "lastAt",
    "circuits[].state",
    "circuits[].consecutiveFailures",
    "circuits[].retryAt"
  ]) {
    assert.ok(clientProvider.fields.includes(field), `missing browser provider field ${field}`);
  }
});
