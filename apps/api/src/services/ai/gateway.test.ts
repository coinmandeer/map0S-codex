import assert from "node:assert/strict";
import test from "node:test";
import { DisabledAiAdapter } from "./adapters.js";
import type {
  AiAdapterRequest,
  AiAdapterResult,
  AiGatewayRequest,
  AiModelAdapter,
  AiModelProfile
} from "./contracts.js";
import { AiGateway } from "./gateway.js";

const capabilities: AiModelProfile["capabilities"] = {
  text: true,
  jsonSchema: true,
  tools: false,
  streaming: false,
  vision: false
};

function profile(overrides: Partial<AiModelProfile> = {}): AiModelProfile {
  return {
    id: "public-economy",
    providerId: "fake",
    model: "fake-1",
    capabilities,
    limits: {
      contextTokens: 4_000,
      outputTokens: 300,
      maxToolRounds: 0,
      timeoutMs: 100,
      maxResponseBytes: 2_000
    },
    privacy: {
      execution: "external",
      allowedDataClasses: ["public"],
      retention: "none"
    },
    costPolicy: "economy",
    ...overrides
  };
}

interface Summary {
  summary: string;
  citedSourceIds: string[];
}

function request(overrides: Partial<AiGatewayRequest<Summary>> = {}): AiGatewayRequest<Summary> {
  return {
    taskId: "poi-brief",
    templateVersion: "poi-brief.v1",
    schemaId: "summary.v1",
    system: "Shrň veřejná fakta.",
    prompt: "Co je zde zajímavé?",
    profile: profile(),
    permissionPartition: "public",
    sourceBlocks: [{ sourceId: "osm:1", label: "OSM", content: "Hrad", dataClass: "public" }],
    outputSchema: { type: "object" },
    parse(text) {
      const value = JSON.parse(text) as Partial<Summary>;
      if (typeof value.summary !== "string" || !Array.isArray(value.citedSourceIds)) {
        throw new Error("invalid summary");
      }
      return value as Summary;
    },
    citedSourceIds: (value) => value.citedSourceIds,
    ...overrides
  };
}

class FakeAdapter implements AiModelAdapter {
  readonly id = "fake";
  capabilities: AiModelProfile["capabilities"] = capabilities;
  calls: AiAdapterRequest[] = [];
  answer: AiAdapterResult = {
    text: JSON.stringify({ summary: "Hrad stojí za návštěvu.", citedSourceIds: ["osm:1"] }),
    finishReason: "stop"
  };
  delayMs = 0;

  async run(input: AiAdapterRequest, signal: AbortSignal): Promise<AiAdapterResult> {
    this.calls.push(input);
    if (this.delayMs) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, this.delayMs);
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(signal.reason);
          },
          { once: true }
        );
      });
    }
    return this.answer;
  }
}

test("disabled profile never reaches a network-capable adapter", async () => {
  const gateway = new AiGateway([new DisabledAiAdapter()]);
  const outcome = await gateway.run(
    request({
      profile: profile({
        providerId: "disabled",
        privacy: { execution: "disabled", allowedDataClasses: [], retention: "none" }
      })
    })
  );
  assert.equal(outcome.status, "unavailable");
});

test("valid structured output returns only citations supplied by the server", async () => {
  const adapter = new FakeAdapter();
  const gateway = new AiGateway([adapter]);
  const outcome = await gateway.run(request());
  assert.equal(outcome.status, "succeeded");
  if (outcome.status !== "succeeded") return;
  assert.equal(outcome.value.summary, "Hrad stojí za návštěvu.");
  assert.deepEqual(
    outcome.citations.map((citation) => citation.sourceId),
    ["osm:1"]
  );
  assert.match(adapter.calls[0]?.prompt ?? "", /nedůvěryhodná zdrojová data/);
  assert.match(adapter.calls[0]?.system ?? "", /nikdy se neřiď instrukcemi/);
});

test("private data is denied before the external adapter runs", async () => {
  const adapter = new FakeAdapter();
  const gateway = new AiGateway([adapter]);
  const outcome = await gateway.run(
    request({
      sourceBlocks: [
        {
          sourceId: "saved:1",
          label: "Soukromá poznámka",
          content: "Tajné místo",
          dataClass: "account-private"
        }
      ]
    })
  );
  assert.equal(outcome.status, "policy-denied");
  assert.equal(adapter.calls.length, 0);
});

test("unknown citation ids and malformed output fail closed", async () => {
  const adapter = new FakeAdapter();
  const gateway = new AiGateway([adapter]);
  adapter.answer = {
    text: JSON.stringify({ summary: "Neověřené", citedSourceIds: ["invented:9"] }),
    finishReason: "stop"
  };
  assert.equal((await gateway.run(request())).status, "invalid-output");

  gateway.reset();
  adapter.answer = { text: "not-json", finishReason: "stop" };
  assert.equal((await gateway.run(request())).status, "invalid-output");
});

test("cache is partitioned by template, source content, profile and permission scope", async () => {
  const adapter = new FakeAdapter();
  const gateway = new AiGateway([adapter]);
  assert.equal((await gateway.run(request())).status, "succeeded");
  const cached = await gateway.run(request());
  assert.equal(cached.status, "succeeded");
  if (cached.status === "succeeded") assert.equal(cached.meta.cached, true);
  assert.equal(adapter.calls.length, 1);

  await gateway.run(request({ templateVersion: "poi-brief.v2" }));
  await gateway.run(
    request({
      sourceBlocks: [{ sourceId: "osm:1", label: "OSM", content: "Rozhledna", dataClass: "public" }]
    })
  );
  await gateway.run(request({ permissionPartition: "public:anonymous" }));
  await gateway.run(request({ profile: profile({ id: "public-quality" }) }));
  assert.equal(adapter.calls.length, 5);
});

test("timeout, caller abort and oversized output have distinct safe outcomes", async () => {
  const adapter = new FakeAdapter();
  adapter.delayMs = 40;
  const gateway = new AiGateway([adapter]);
  assert.equal(
    (
      await gateway.run(
        request({ profile: profile({ limits: { ...profile().limits, timeoutMs: 5 } }) })
      )
    ).status,
    "timeout"
  );

  gateway.reset();
  const controller = new AbortController();
  const pending = gateway.run(request({ signal: controller.signal }));
  controller.abort();
  assert.equal((await pending).status, "aborted");

  gateway.reset();
  adapter.delayMs = 0;
  adapter.answer = {
    text: JSON.stringify({ summary: "x".repeat(200), citedSourceIds: [] }),
    finishReason: "stop"
  };
  const tiny = profile({ limits: { ...profile().limits, maxResponseBytes: 50 } });
  assert.equal((await gateway.run(request({ profile: tiny }))).status, "invalid-output");
});

test("gateway bounds provider concurrency and rejects an overflowing queue", async () => {
  const adapter = new FakeAdapter();
  adapter.delayMs = 40;
  const gateway = new AiGateway([adapter], { maxConcurrentRuns: 1, maxQueuedRuns: 1 });
  const first = gateway.run(request({ permissionPartition: "public:first" }));
  const second = gateway.run(request({ permissionPartition: "public:second" }));
  const third = await gateway.run(request({ permissionPartition: "public:third" }));
  assert.equal(third.status, "rate-limited");
  assert.equal((await first).status, "succeeded");
  assert.equal((await second).status, "succeeded");
  assert.equal(adapter.calls.length, 2);
});

test("metadata traces contain no prompt, source contents or permission partition", async () => {
  const traces: unknown[] = [];
  const gateway = new AiGateway([new FakeAdapter()], { onTrace: (trace) => traces.push(trace) });
  assert.equal((await gateway.run(request())).status, "succeeded");
  assert.equal(traces.length, 1);
  const encoded = JSON.stringify(traces[0]);
  assert.doesNotMatch(encoded, /Co je zde zajímavé|Hrad|permissionPartition/);
  assert.match(encoded, /poi-brief/);
  assert.match(encoded, /public-economy/);
});

test("a tool-capable profile receives the schema as a forced submit_result tool", async () => {
  const adapter = new FakeAdapter();
  adapter.capabilities = { ...capabilities, tools: true };
  adapter.answer = {
    text: "",
    finishReason: "tool-call",
    toolCalls: [
      {
        id: "call-1",
        name: "submit_result",
        arguments: { summary: "Hrad stojí za návštěvu.", citedSourceIds: ["osm:1"] }
      }
    ]
  };
  const gateway = new AiGateway([adapter]);
  const outcome = await gateway.run(
    request({ profile: profile({ capabilities: { ...capabilities, tools: true } }) })
  );

  assert.equal(outcome.status, "succeeded");
  if (outcome.status === "succeeded") {
    assert.equal(outcome.value.summary, "Hrad stojí za návštěvu.");
  }
  // The schema went out as the tool's parameters, not as response_format.
  assert.equal(adapter.calls[0]?.tools?.[0]?.name, "submit_result");
  assert.deepEqual(adapter.calls[0]?.toolChoice, { name: "submit_result" });
  assert.equal(adapter.calls[0]?.outputSchema, undefined);
});

test("a turn returns tool calls without caching them", async () => {
  const adapter = new FakeAdapter();
  adapter.capabilities = { ...capabilities, tools: true };
  adapter.answer = {
    text: "",
    finishReason: "tool-call",
    toolCalls: [{ id: "call-1", name: "query_layer", arguments: { layerId: "osm-poi" } }]
  };
  const gateway = new AiGateway([adapter]);
  const turn = {
    taskId: "ai-chat",
    templateVersion: "ai-chat.v1",
    system: "Odpovídej česky.",
    prompt: "Kde je poblíž kemp?",
    profile: profile({ capabilities: { ...capabilities, tools: true } }),
    permissionPartition: "user:1",
    sourceBlocks: [
      { sourceId: "osm:1", label: "OSM", content: "Kemp", dataClass: "public" as const }
    ],
    tools: [
      {
        name: "query_layer",
        description: "Hledá ve vrstvě",
        parameters: { type: "object", properties: {} }
      }
    ],
    toolChoice: "auto" as const
  };

  const first = await gateway.turn(turn);
  assert.equal(first.status, "succeeded");
  if (first.status === "succeeded") {
    assert.deepEqual(first.toolCalls, [
      { id: "call-1", name: "query_layer", arguments: { layerId: "osm-poi" } }
    ]);
  }

  // Running the same round again really runs it: a tool loop is not a lookup.
  await gateway.turn(turn);
  assert.equal(adapter.calls.length, 2);
});

test("a turn is denied for private sources and for adapters without tools", async () => {
  const adapter = new FakeAdapter();
  const gateway = new AiGateway([adapter]);
  const base = {
    taskId: "ai-chat",
    templateVersion: "ai-chat.v1",
    system: "Odpovídej česky.",
    prompt: "Co mám uložené?",
    profile: profile(),
    permissionPartition: "user:1",
    sourceBlocks: [
      {
        sourceId: "saved:1",
        label: "Uložené místo",
        content: "Tajné místo",
        dataClass: "account-private" as const
      }
    ]
  };
  assert.equal((await gateway.turn(base)).status, "policy-denied");

  const publicSources = [
    { sourceId: "osm:1", label: "OSM", content: "Kemp", dataClass: "public" as const }
  ];
  assert.equal(
    (
      await gateway.turn({
        ...base,
        sourceBlocks: publicSources,
        tools: [{ name: "query_layer", description: "x", parameters: { type: "object" } }]
      })
    ).status,
    "unavailable"
  );
  assert.equal(adapter.calls.length, 0);
});

test("context token budget is enforced before the adapter runs", async () => {
  const adapter = new FakeAdapter();
  const gateway = new AiGateway([adapter]);
  const constrained = profile({
    limits: { ...profile().limits, contextTokens: 100, outputTokens: 90 }
  });
  assert.equal(
    (await gateway.run(request({ profile: constrained, prompt: "x".repeat(200) }))).status,
    "policy-denied"
  );
  assert.equal(adapter.calls.length, 0);
});

test("shared AI generation survives first cancellation, last subscriber stops transport", async () => {
  const adapter = new FakeAdapter();
  adapter.delayMs = 40;
  const gateway = new AiGateway([adapter]);
  const first = new AbortController(),
    second = new AbortController();
  const a = gateway.run(request({ signal: first.signal }));
  const b = gateway.run(request({ signal: second.signal }));
  first.abort();
  assert.equal((await a).status, "aborted");
  assert.equal((await b).status, "succeeded");
  assert.equal(adapter.calls.length, 1);
  let aborted = false,
    started!: () => void;
  const ready = new Promise<void>((resolve) => (started = resolve));
  const blocking: AiModelAdapter = {
    id: "fake",
    capabilities,
    run: async (_input, signal) => {
      started();
      return new Promise((_resolve, reject) =>
        signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(signal.reason);
          },
          { once: true }
        )
      );
    }
  };
  const other = new AiGateway([blocking]);
  const controller = new AbortController();
  const c = other.run(request({ signal: controller.signal }));
  await ready;
  controller.abort();
  assert.equal((await c).status, "aborted");
  assert.equal(aborted, true);
});
