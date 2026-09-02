import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  __resetUpstreamCache,
  __setUpstreamTestDependencies,
  createPinnedLookup,
  fetchJson,
  providerCircuitBreaker,
  validateUpstreamUrl
} from "./upstream.js";
import { operationalTelemetry } from "../observability/operationalTelemetry.js";

const originalFetch = globalThis.fetch;

test("pinned lookup follows both scalar and Node 22 all-address callback contracts", async () => {
  const lookup = createPinnedLookup("93.184.216.34", 4);
  const scalar = await new Promise<{ address: string | object[]; family?: number }>((resolve) => {
    lookup("example.test", { all: false }, (_error, address, family) =>
      resolve({ address, family })
    );
  });
  assert.deepEqual(scalar, { address: "93.184.216.34", family: 4 });

  const all = await new Promise<{ address: string | object[]; family?: number }>((resolve) => {
    lookup("example.test", { all: true }, (_error, address, family) =>
      resolve({ address, family })
    );
  });
  assert.deepEqual(all, { address: [{ address: "93.184.216.34", family: 4 }], family: undefined });
});

function useMockFetch(resolveHost = async () => ["93.184.216.34"]) {
  __setUpstreamTestDependencies({
    resolveHost,
    request: (url, init) =>
      globalThis.fetch(url, {
        method: init.method,
        body: init.body,
        headers: { ...init.headers },
        signal: init.signal,
        redirect: "error"
      })
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  __resetUpstreamCache();
  operationalTelemetry.clear();
});

test("concurrent POST requests with the same body are coalesced", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  useMockFetch();

  const options = {
    providerId: "wikidata-test",
    method: "POST" as const,
    body: "query=SELECT%20*",
    ttlMs: 60_000
  };
  const [first, second] = await Promise.all([
    fetchJson<{ ok: boolean }>("https://example.test/sparql", options),
    fetchJson<{ ok: boolean }>("https://example.test/sparql", options)
  ]);

  assert.deepEqual(first, { ok: true });
  assert.deepEqual(second, first);
  assert.equal(calls, 1);
});

test("429 is retried when the caller opts in", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1)
      return new Response("rate limited", { status: 429, headers: { "retry-after": "0" } });
    return new Response(JSON.stringify({ recovered: true }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  useMockFetch();

  const result = await fetchJson<{ recovered: boolean }>("https://example.test/entity", {
    providerId: "wikidata-test",
    retries: 1
  });

  assert.deepEqual(result, { recovered: true });
  assert.equal(calls, 2);
});

test("non-JSON and oversized provider payloads are rejected before parsing", async () => {
  globalThis.fetch = async () =>
    new Response("not json", { status: 200, headers: { "content-type": "text/html" } });
  useMockFetch();
  await assert.rejects(
    fetchJson("https://example.test/html", { providerId: "unsafe-shape" }),
    /nepodporovaný typ/
  );

  __resetUpstreamCache();
  useMockFetch();
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ value: "x".repeat(2_000) }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  await assert.rejects(
    fetchJson("https://example.test/large", {
      providerId: "oversized",
      maxResponseBytes: 1_024
    }),
    /příliš velkou/
  );
});

test("repeated provider failures open a circuit and stop the request storm", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response("down", { status: 503 });
  };
  useMockFetch();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await assert.rejects(
      fetchJson(`https://example.test/down/${attempt}`, { providerId: "unstable" }),
      /odpověděl 503/
    );
  }
  await assert.rejects(
    fetchJson("https://example.test/down/blocked", { providerId: "unstable" }),
    /dočasně pozastaven/
  );
  assert.equal(calls, 4);
});

test("generic provider client refuses local, literal-IP, credential and non-HTTPS targets", async () => {
  for (const url of [
    "http://api.example.test/data",
    "https://localhost/data",
    "https://service.internal/data",
    "https://127.0.0.1/data",
    "https://[::1]/data",
    "https://name:secret@api.example.test/data"
  ]) {
    assert.throws(() => validateUpstreamUrl(url), /public HTTPS/);
  }
  assert.equal(validateUpstreamUrl("https://api.example.test/data#fragment").hash, "");
});

test("provider IDs fail fast and mixed private DNS answers never reach the transport", async () => {
  let requests = 0;
  __setUpstreamTestDependencies({
    resolveHost: async () => ["93.184.216.34", "127.0.0.1"],
    request: async () => {
      requests += 1;
      return new Response("{}", { headers: { "content-type": "application/json" } });
    }
  });

  await assert.rejects(
    fetchJson("https://example.test/data", { providerId: "Display Name" }),
    /providerId must be a stable lowercase slug/
  );
  await assert.rejects(
    fetchJson("https://example.test/data", { providerId: "safe-provider" }),
    /výhradně na veřejnou síť/
  );
  assert.equal(requests, 0);
});

test("failures stay isolated between two provider IDs in the shared client", async () => {
  let calls = 0;
  globalThis.fetch = async (input) => {
    calls += 1;
    return String(input).includes("broken")
      ? new Response("down", { status: 503 })
      : new Response(JSON.stringify({ ok: true }), {
          headers: { "content-type": "application/json" }
        });
  };
  useMockFetch();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await assert.rejects(
      fetchJson(`https://example.test/broken/${attempt}`, { providerId: "broken-provider" })
    );
  }
  assert.deepEqual(
    await fetchJson<{ ok: boolean }>("https://example.test/healthy", {
      providerId: "healthy-provider"
    }),
    { ok: true }
  );
  assert.equal(calls, 5);
});

test("caller abort is telemetry, not a provider failure or circuit signal", async () => {
  const controller = new AbortController();
  controller.abort();
  __setUpstreamTestDependencies({
    resolveHost: async () => ["93.184.216.34"],
    request: async (_url, init) => {
      throw init.signal.reason;
    }
  });

  await assert.rejects(
    fetchJson("https://example.test/aborted", {
      providerId: "abort-safe",
      signal: controller.signal
    }),
    /zrušen/
  );
  assert.deepEqual(providerCircuitBreaker.snapshots(), [
    {
      provider: "abort-safe",
      state: "closed",
      consecutiveFailures: 0,
      retryAt: null,
      lastSuccessAt: null,
      lastFailureAt: null
    }
  ]);
  assert.equal(
    operationalTelemetry.snapshot().providers.find((entry) => entry.provider === "abort-safe")
      ?.outcome,
    "aborted"
  );
});
