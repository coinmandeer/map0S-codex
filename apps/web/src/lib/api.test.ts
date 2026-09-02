import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { ApiError, apiPost, apiPostWithMetadata, safeApiRequestId } from "./api.js";

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
