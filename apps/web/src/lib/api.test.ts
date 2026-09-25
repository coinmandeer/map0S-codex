import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { ApiError, apiGet, apiPost, apiPostWithMetadata, safeApiRequestId } from "./api.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("shared API correlation metadata", () => {
  it("accepts only bounded opaque request IDs", () => {
    assert.equal(
      safeApiRequestId("3db0c9d7-4d8d-4d49-999b-ae47bf332285"),
      "3db0c9d7-4d8d-4d49-999b-ae47bf332285"
    );
    assert.equal(safeApiRequestId("https://private.test/?lat=50.08"), null);
    assert.equal(safeApiRequestId("short"), null);
    assert.equal(safeApiRequestId("a".repeat(65)), null);
  });

  it("returns a validated X-Request-ID without changing the body-only API", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "X-Request-ID": "3db0c9d7-4d8d-4d49-999b-ae47bf332285"
        }
      });

    assert.deepEqual(await apiPost<{ ok: boolean }>("/fixture", {}), { ok: true });
    assert.deepEqual(await apiPostWithMetadata<{ ok: boolean }>("/fixture", {}), {
      data: { ok: true },
      requestId: "3db0c9d7-4d8d-4d49-999b-ae47bf332285"
    });
  });

  it("keeps a safe request ID on errors and discards an unsafe header", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ message: "unavailable" }), {
        status: 503,
        headers: {
          "Content-Type": "application/json",
          "X-Request-ID": "3db0c9d7-4d8d-4d49-999b-ae47bf332285"
        }
      });

    await assert.rejects(
      apiPostWithMetadata("/fixture", {}),
      (error: unknown) =>
        error instanceof ApiError &&
        error.status === 503 &&
        error.requestId === "3db0c9d7-4d8d-4d49-999b-ae47bf332285"
    );

    globalThis.fetch = async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json", "X-Request-ID": "private?q=coords" }
      });
    assert.equal((await apiPostWithMetadata("/fixture", {})).requestId, null);
  });
});

describe("in-flight GET sharing", () => {
  it("joins identical concurrent GETs into one request and isolates the payloads", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return new Response(JSON.stringify({ items: [1] }), { status: 200 });
    };
    const [a, b] = await Promise.all([
      apiGet<{ items: number[] }>("/themes", { query: { lang: "cs" } }),
      apiGet<{ items: number[] }>("/themes", { query: { lang: "cs" } })
    ]);
    assert.equal(calls, 1);
    a.items.push(2);
    assert.deepEqual(b.items, [1]);
    await apiGet("/themes", { query: { lang: "cs" } });
    assert.equal(calls, 2, "a settled request is not reused as a cache");
  });

  it("keeps the shared request alive while another caller still waits", async () => {
    let aborted = false;
    globalThis.fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
      init?.signal?.addEventListener("abort", () => (aborted = true));
      await new Promise((resolve) => setTimeout(resolve, 10));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const first = new AbortController();
    const cancelled = apiGet("/place", { signal: first.signal });
    const waiting = apiGet<{ ok: boolean }>("/place");
    first.abort();
    await assert.rejects(cancelled, (error: unknown) => (error as Error).name === "AbortError");
    assert.deepEqual(await waiting, { ok: true });
    assert.equal(aborted, false);
  });

  it("aborts the network request once every caller has cancelled", async () => {
    let aborted = false;
    globalThis.fetch = (_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    const controller = new AbortController();
    const request = apiGet("/slow", { signal: controller.signal });
    controller.abort();
    await assert.rejects(request);
    assert.equal(aborted, true);
  });
});
