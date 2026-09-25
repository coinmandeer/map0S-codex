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

test("large responses evict least recently used payloads before the entry count limit", async () => {
  const calls = new Map<string, number>();
  const payload = JSON.stringify({ value: "x".repeat(7 * 1024 * 1024) });
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.set(url, (calls.get(url) ?? 0) + 1);
    return new Response(payload, { headers: { "content-type": "application/json" } });
  };
  useMockFetch();
  const get = (id: number) =>
    fetchJson(`https://example.test/large/${id}`, {
      providerId: "cache-budget-test",
      maxResponseBytes: 8 * 1024 * 1024,
      ttlMs: 60_000
    });
  for (const id of [0, 1, 2, 3]) await get(id);
  await get(0); // Keep the oldest insertion hot.
  await get(4); // Five payloads exceed 32 MiB; entry 1 must be evicted.
  await get(0);
  assert.equal(calls.get("https://example.test/large/0"), 1);
  await get(1);
  assert.equal(calls.get("https://example.test/large/1"), 2);
});

test("a warm response cannot bypass a stricter freshness or size policy", async () => {
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return new Response(JSON.stringify({ revision: requests, value: "x".repeat(2_000) }), {
      headers: { "content-type": "application/json" }
    });
  };
  useMockFetch();
  const url = "https://example.test/policy";
  const common = { providerId: "cache-policy-test", maxResponseBytes: 4_096 };
  await fetchJson(url, { ...common, ttlMs: 600_000 });
  const fresh = await fetchJson<{ revision: number }>(url, { ...common, ttlMs: 0 });
  assert.equal(fresh.revision, 2);
  await fetchJson(url, { ...common, ttlMs: 0 });
  assert.equal(requests, 3);
  await assert.rejects(
    fetchJson(url, { ...common, ttlMs: 600_000, maxResponseBytes: 1_024 }),
    /příliš velkou/
  );
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
    { name: "AbortError" }
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
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

test("budget admission follows dedup, reserves every retry, and never caches commercial responses", async () => {
  useMockFetch();
  let reservations = 0,
    requests = 0;
  globalThis.fetch = async () => {
    requests++;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  const options = {
    providerId: "budget-fixture",
    retries: 0,
    ttlMs: 99999,
    budget: {
      scope: "account-one",
      reserve: async () => {
        reservations++;
      }
    }
  };
  await Promise.all([
    fetchJson("https://example.test/budget", options),
    fetchJson("https://example.test/budget", options)
  ]);
  assert.equal(reservations, 1);
  assert.equal(requests, 1);
  await fetchJson("https://example.test/budget", options);
  assert.equal(reservations, 2);
  assert.equal(requests, 2);
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts++;
    throw new Error("network error");
  };
  await assert.rejects(fetchJson("https://example.test/retry", { ...options, retries: 1 }));
  assert.equal(attempts, 2);
  assert.equal(reservations, 4);
});

test("denied budget never reaches transport or consumes retries", async () => {
  useMockFetch();
  let calls = 0,
    reservations = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error("must not call");
  };
  const denied = new Error("budget-exhausted");
  await assert.rejects(
    fetchJson("https://example.test/denied", {
      providerId: "budget-denied",
      retries: 2,
      budget: {
        scope: "account-one",
        reserve: async () => {
          reservations++;
          throw denied;
        }
      }
    }),
    (e) => e === denied
  );
  assert.equal(calls, 0);
  assert.equal(reservations, 1);
});

test("explicitly cacheable web budget does not charge cache hits and stays account partitioned", async () => {
  useMockFetch();
  let reservations = 0,
    requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" }
    });
  };
  const options = {
    providerId: "budget-web-cache",
    ttlMs: 60000,
    budget: {
      scope: "web-account-one",
      cacheable: true,
      reserve: async () => {
        reservations++;
      }
    }
  };
  await fetchJson("https://example.test/web-cache", options);
  await fetchJson("https://example.test/web-cache", options);
  assert.equal(reservations, 1);
  assert.equal(requests, 1);
  await fetchJson("https://example.test/web-cache", {
    ...options,
    budget: { ...options.budget, scope: "web-account-two" }
  });
  assert.equal(reservations, 2);
  assert.equal(requests, 2);
});

test("provider-specific JSON MIME exception does not leak through cache to strict callers", async () => {
  globalThis.fetch = async () =>
    new Response('{"results":[]}', { headers: { "content-type": "text/html; charset=utf-8" } });
  useMockFetch();
  const options = { providerId: "ollama-test", ttlMs: 60000 };
  assert.deepEqual(
    await fetchJson("https://example.test/search", {
      ...options,
      acceptedContentTypes: ["application/json", "text/html"]
    }),
    { results: [] }
  );
  await assert.rejects(fetchJson("https://example.test/search", options), /nepodporovaný/);
  __resetUpstreamCache();
  useMockFetch();
  globalThis.fetch = async () =>
    new Response("<html>gateway failure</html>", { headers: { "content-type": "text/html" } });
  await assert.rejects(
    fetchJson("https://example.test/search", { ...options, acceptedContentTypes: ["text/html"] }),
    /neplatný JSON/
  );
});
