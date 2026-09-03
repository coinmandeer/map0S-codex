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

test("tools travel as function specs and come back as parsed calls", async () => {
  let sent: Record<string, unknown> = {};
  const adapter = new OpenAiCompatibleAdapter({
    id: "tool-provider",
    baseUrl: "https://provider.test/v1",
    apiKey: "test-key",
    model: "test-model",
    fetch: async (_input, init) => {
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "call-1",
                    type: "function",
                    function: {
                      name: "query_layer",
                      arguments: '{"layerId":"park4night","limit":5}'
                    }
                  },
                  // Dropped: arguments that are not JSON cannot be executed, and repairing
                  // them is how a read turns into the wrong call.
                  { id: "call-2", type: "function", function: { name: "x", arguments: "{" } }
                ]
              }
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
  });

  const result = await adapter.run(
    {
      ...baseRequest,
      history: [
        { role: "user", content: "Kde je kemp?" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "call-0", name: "query_layer", arguments: { layerId: "osm-poi" } }]
        },
        { role: "tool", toolCallId: "call-0", name: "query_layer", content: '{"features":[]}' }
      ],
      tools: [
        {
          name: "query_layer",
          description: "Hledá ve vrstvě",
          parameters: { type: "object", properties: {} }
        }
      ],
      toolChoice: "auto"
    },
    new AbortController().signal
  );

  const tools = sent.tools as Array<{ type: string; function: { name: string } }>;
  assert.equal(tools[0]?.type, "function");
  assert.equal(tools[0]?.function.name, "query_layer");
  assert.equal(sent.tool_choice, "auto");
  // No response_format alongside tools: the provider ignores it and it only wastes context.
  assert.equal(sent.response_format, undefined);
  const messages = sent.messages as Array<Record<string, unknown>>;
  assert.deepEqual(
    messages.map((message) => message.role),
    ["system", "user", "assistant", "tool", "user"]
  );
  assert.equal(messages[3]?.tool_call_id, "call-0");

  assert.equal(result.finishReason, "tool-call");
  assert.deepEqual(result.toolCalls, [
    { id: "call-1", name: "query_layer", arguments: { layerId: "park4night", limit: 5 } }
  ]);
});

test("a forced tool carries the output schema as its parameters", async () => {
  let sent: Record<string, unknown> = {};
  const adapter = new OpenAiCompatibleAdapter({
    id: "schema-provider",
    baseUrl: "https://provider.test/v1",
    apiKey: "test-key",
    model: "test-model",
    fetch: async (_input, init) => {
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          choices: [{ finish_reason: "stop", message: { content: "ok" } }]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
  });

  await adapter.run(
    {
      ...baseRequest,
      tools: [
        {
          name: "submit_result",
          description: "Odevzdej výsledek",
          parameters: {
            type: "object",
            required: ["text"],
            properties: { text: { type: "string" } }
          }
        }
      ],
      toolChoice: { name: "submit_result" }
    },
    new AbortController().signal
  );

  assert.deepEqual(sent.tool_choice, { type: "function", function: { name: "submit_result" } });
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
