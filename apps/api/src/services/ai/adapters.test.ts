import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { operationalTelemetry } from "../../observability/operationalTelemetry.js";
import { __resetUpstreamCache, __setUpstreamTestDependencies } from "../../utils/upstream.js";
import { OpenAiCompatibleAdapter } from "./adapters.js";

afterEach(() => {
  operationalTelemetry.clear();
  __resetUpstreamCache();
});

const baseRequest = {
  runId: "run-1",
  taskId: "summary",
  templateVersion: "summary.v1",
  system: "System",
  prompt: "Prompt",
  maxOutputTokens: 100,
  maxResponseBytes: 2_000,
  temperature: 0.2
};

test("OpenAI-compatible adapter normalises output and usage through an injected fetch", async () => {
  let requestedUrl = "";
  let requestedBody = "";
  const adapter = new OpenAiCompatibleAdapter({
    id: "fake-openai",
    baseUrl: "https://provider.test/v1/",
    apiKey: "test-key",
    model: "test-model",
    fetch: async (input, init) => {
      requestedUrl = String(input);
      requestedBody = String(init?.body);
      const body = JSON.stringify({
        id: "provider-run",
        choices: [{ finish_reason: "stop", message: { content: " Odpověď " } }],
        usage: { prompt_tokens: 12, completion_tokens: 4 }
      });
      return new Response(body, {
        status: 200,
        headers: { "content-type": "application/json", "content-length": String(body.length) }
      });
    }
  });

  const result = await adapter.run(baseRequest, new AbortController().signal);
  assert.equal(requestedUrl, "https://provider.test/v1/chat/completions");
  assert.equal((JSON.parse(requestedBody) as Record<string, unknown>).model, "test-model");
  assert.equal(result.text, "Odpověď");
  assert.equal(result.providerRequestId, "provider-run");
  assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 4 });
});

test("production AI requests use the pinned provider transport and telemetry", async () => {
  let requestedPath = "";
  __setUpstreamTestDependencies({
    resolveHost: async () => ["93.184.216.34"],
    request: async (url) => {
      requestedPath = url.pathname;
      return new Response(
        JSON.stringify({
          id: "provider-run",
          choices: [{ finish_reason: "stop", message: { content: "Odpověď" } }]
        }),
        { headers: { "content-type": "application/json" } }
      );
    }
  });
  const adapter = new OpenAiCompatibleAdapter({
    id: "real-provider",
    baseUrl: "https://provider.test/v1",
    apiKey: "test-key",
    model: "test-model"
  });

  assert.equal((await adapter.run(baseRequest, new AbortController().signal)).text, "Odpověď");
  assert.equal(requestedPath, "/v1/chat/completions");
  assert.equal(
    operationalTelemetry.snapshot().providers.find((entry) => entry.provider === "ai-real-provider")
      ?.outcome,
    "success"
  );
});

test("adapter rejects insecure endpoints and malformed provider responses", async () => {
  assert.throws(
    () =>
      new OpenAiCompatibleAdapter({
        id: "bad",
        baseUrl: "http://provider.test/v1",
        apiKey: "test-key",
        model: "test-model"
      }),
    /HTTPS/
  );

  const adapter = new OpenAiCompatibleAdapter({
    id: "bad-response",
    baseUrl: "https://provider.test/v1",
    apiKey: "test-key",
    model: "test-model",
    fetch: async () =>
      new Response("not-json", {
        status: 200,
        headers: { "content-type": "application/json" }
      })
  });
  await assert.rejects(adapter.run(baseRequest, new AbortController().signal), /malformed JSON/);
});

test("adapter refuses an oversized body before parsing it", async () => {
  const adapter = new OpenAiCompatibleAdapter({
    id: "oversized",
    baseUrl: "https://provider.test/v1",
    apiKey: "test-key",
    model: "test-model",
    fetch: async () =>
      new Response(JSON.stringify({ choices: [] }), {
        status: 200,
        headers: { "content-type": "application/json", "content-length": "9999" }
      })
  });
  await assert.rejects(
    adapter.run({ ...baseRequest, maxResponseBytes: 100 }, new AbortController().signal),
    /byte limit/
  );
});
