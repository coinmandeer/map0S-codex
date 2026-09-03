import assert from "node:assert/strict";
import test from "node:test";
import { AiChatService, classifyChatIntent, type AiChatEvent } from "./chatService.js";
import { createAiChatTurnFactory, createFixtureChatToolProviders } from "./chatComposition.js";
import { AiConversationStore } from "./conversation.js";
import type {
  AiAdapterRequest,
  AiAdapterResult,
  AiModelAdapter,
  AiModelProfile
} from "./contracts.js";
import { AiGateway } from "./gateway.js";
import type { AiModelRuntime } from "./modelRuntime.js";
import { createChatToolRegistry } from "./chatTools.js";
import { createMemoryPlaceSearchSource } from "./placeSearch.js";
import { createFixtureWebTools } from "./webTools.js";
import type { AiToolActor, AiToolPermissionProjection } from "./toolRegistry.js";

const FIXTURES = [
  { osmId: "node/1", category: "camp_site", name: "Kemp U Řeky", lng: 13.379, lat: 49.749 },
  { osmId: "node/2", category: "camp_site", name: "Kemp Na Kopci", lng: 13.4, lat: 49.76 },
  { osmId: "node/3", category: "bar", name: "Bar U Mostu", lng: 13.378, lat: 49.748 }
];

const actor: AiToolActor = {
  authenticated: true,
  userId: "user-1",
  permissions: new Set([
    "map:read",
    "layers:read",
    "poi:read",
    "route:read",
    "weather:read",
    "events:read",
    "web:read"
  ]),
  entitlementIds: new Set()
};

const projection: AiToolPermissionProjection = {
  allowedLayerIds: new Set(["osm-poi"]),
  allowedPlanIds: new Set(),
  allowedFeatureFieldsByLayer: new Map(),
  allowedDataClasses: new Set(["public"]),
  allowPreciseLocation: false
};

function request(message: string, consent = { externalModel: true, preciseLocation: false }) {
  return {
    ownerUserId: "user-1",
    message,
    messageDataClass: "account-private" as const,
    context: {
      mapCenter: { longitude: 13.3775, latitude: 49.7475 },
      zoom: 13,
      activeLayerIds: ["osm-poi"]
    },
    consent,
    conversation: { mode: "new" as const, scope: { type: "global" as const } },
    actor,
    projection
  };
}

function collect() {
  const events: AiChatEvent[] = [];
  return { events, emit: (event: AiChatEvent) => void events.push(event) };
}

/** A profile whose adapter is scripted: the real gateway policy, cache and byte limits still
 *  apply, only the provider round trip is replaced. */
function scriptedRuntime(results: readonly AiAdapterResult[]): {
  runtime: AiModelRuntime;
  requests: AiAdapterRequest[];
} {
  const requests: AiAdapterRequest[] = [];
  let index = 0;
  const adapter: AiModelAdapter = {
    id: "scripted",
    capabilities: { text: true, jsonSchema: false, tools: true, streaming: false, vision: false },
    async run(input) {
      requests.push(input);
      const result = results[Math.min(index, results.length - 1)];
      index += 1;
      if (!result) throw new Error("script exhausted");
      return result;
    }
  };
  const profile: AiModelProfile = {
    id: "scripted-fast",
    providerId: "scripted",
    model: "scripted-model",
    capabilities: adapter.capabilities,
    limits: {
      contextTokens: 16_000,
      outputTokens: 2_000,
      maxToolRounds: 6,
      timeoutMs: 5_000,
      maxResponseBytes: 32_768
    },
    privacy: {
      execution: "external",
      allowedDataClasses: ["public", "account-private"],
      retention: "none"
    },
    costPolicy: "economy"
  };
  return {
    runtime: { gateway: new AiGateway([adapter]), enabled: true, profiles: () => [profile] },
    requests
  };
}

function service(runtime?: AiModelRuntime) {
  const { registry, available } = createChatToolRegistry({
    providers: {
      placeSearch: createMemoryPlaceSearchSource(() => FIXTURES),
      layers: () => [
        { layerId: "osm-poi", name: "OSM POI", categories: ["stay.camp_site"], access: "public" }
      ],
      web: createFixtureWebTools([
        { url: "https://fixture.test/kempy", title: "Kempy", text: "Kempy u vody." }
      ])
    },
    mapContext: {
      center: { longitude: 13.3775, latitude: 49.7475 },
      zoom: 13,
      activeLayerIds: ["osm-poi"]
    }
  });
  return new AiChatService({
    registry,
    conversations: new AiConversationStore(),
    availableTools: available,
    ...(runtime ? { runtime } : {})
  });
}

test("the router keeps place lookups off the model path and names plan work as plan work", () => {
  assert.equal(classifyChatIntent("kde najdu klidný kemp u vody?"), "place");
  assert.equal(classifyChatIntent("naplánuj mi 3 dny karavanem po Provence"), "plan");
  assert.equal(classifyChatIntent("přidej Kutnou Horu na den 2 a zkrať to"), "edit_plan");
  assert.equal(classifyChatIntent("vytvoř vrstvu s pivovary"), "layer_create");
  assert.equal(classifyChatIntent("zapni katastr"), "command");
  assert.equal(classifyChatIntent("jak vysoká je Sněžka?"), "question");
});

test("without a model the same question is answered from the same tool", async () => {
  const { events } = await (async () => {
    const sink = collect();
    const answer = await service().run(
      request("kde najdu kemp u vody?", { externalModel: false, preciseLocation: false }),
      sink.emit
    );
    assert.ok(answer);
    // The template answer is built from tool output, not from the question.
    assert.equal(answer.execution, "deterministic");
    assert.match(answer.text, /Kemp U Řeky/);
    assert.ok(answer.sources.length > 0, "a place in the answer carries its source");
    const card = answer.cards.find((entry) => entry.type === "places");
    assert.ok(card && card.type === "places");
    assert.deepEqual(card.layerIds, ["osm-poi"]);
    assert.equal(card.places.length, 2, "only the camp sites, not the bar");
    return sink;
  })();

  assert.deepEqual(
    events.map((event) => event.type),
    ["intent", "tool_start", "tool_result", "token", "card", "done"]
  );
});

test("a question with no category still answers with something to try next", async () => {
  const sink = collect();
  const answer = await service().run(
    request("co si mám počít?", { externalModel: false, preciseLocation: false }),
    sink.emit
  );
  assert.ok(answer);
  assert.equal(answer.cards.length, 0);
  assert.equal(answer.followUps.length, 3, "an empty answer without a next step is forbidden");
});

test("the tool loop runs a tool, then submits an answer that may only cite what it saw", async () => {
  const { runtime, requests } = scriptedRuntime([
    {
      text: "",
      finishReason: "tool-call",
      toolCalls: [
        {
          id: "call-1",
          name: "search_places",
          arguments: {
            categories: ["stay.camp_site"],
            near: { longitude: 13.3775, latitude: 49.7475 },
            radiusMeters: 15_000,
            limit: 5
          }
        }
      ]
    },
    {
      text: "",
      finishReason: "tool-call",
      toolCalls: [
        {
          id: "call-2",
          name: "submit_answer",
          arguments: {
            text: "Nejblíž je Kemp U Řeky, asi dva kilometry od středu mapy.",
            // The second id was never returned by a tool and must be dropped.
            placeIds: ["poi:invented", "fixture-poi:not-real"],
            followUps: ["Zobraz to v mapě"]
          }
        }
      ]
    }
  ]);

  const sink = collect();
  const answer = await service(runtime).run(request("kde je kemp?"), sink.emit);
  assert.ok(answer);
  assert.equal(answer.execution, "model-tool-loop");
  assert.equal(answer.text, "Nejblíž je Kemp U Řeky, asi dva kilometry od středu mapy.");
  assert.deepEqual(answer.followUps, ["Zobraz to v mapě"]);
  // Invented ids are dropped, so the card falls back to the places the tool did return.
  const card = answer.cards.find((entry) => entry.type === "places");
  assert.ok(card && card.type === "places");
  assert.ok(card.places.every((place) => place.title.startsWith("Kemp")));

  assert.deepEqual(
    sink.events.map((event) => event.type),
    ["intent", "tool_start", "tool_result", "card", "done"]
  );
  const started = sink.events.find((event) => event.type === "tool_start");
  assert.ok(started?.type === "tool_start" && started.tool === "search_places");

  // Only composed, read-only, permitted tools are offered — plus the submission tool.
  const offered = new Set((requests[0]?.tools ?? []).map((tool) => tool.name));
  assert.ok(offered.has("search_places"));
  assert.ok(offered.has("submit_answer"));
  assert.ok(!offered.has("create_plan_draft"), "a draft tool is never offered to the model");
  assert.ok(!offered.has("route_segment"), "an uncomposed tool is never offered to the model");
  // The second round carries the tool result back, otherwise the loop has no memory.
  assert.ok(
    (requests[1]?.history ?? []).some((turn) => turn.role === "tool"),
    "the tool result travels back to the model"
  );
});

test("a rounded map centre is what the model sees without location consent", async () => {
  const { runtime, requests } = scriptedRuntime([
    {
      text: "",
      finishReason: "tool-call",
      toolCalls: [{ id: "c", name: "submit_answer", arguments: { text: "Ano." } }]
    }
  ]);
  await service(runtime).run(request("co je tady?"), collect().emit);
  assert.match(requests[0]!.prompt, /49\.75, 13\.38/);
  assert.ok(!requests[0]!.prompt.includes("49.7475"));
});

test("a provider failure falls back to the deterministic answer instead of an apology", async () => {
  const failing: AiModelRuntime = {
    gateway: new AiGateway([
      {
        id: "broken",
        capabilities: {
          text: true,
          jsonSchema: false,
          tools: true,
          streaming: false,
          vision: false
        },
        async run() {
          throw new Error("provider is down");
        }
      }
    ]),
    enabled: true,
    profiles: () => [
      {
        id: "broken-fast",
        providerId: "broken",
        model: "broken",
        capabilities: {
          text: true,
          jsonSchema: false,
          tools: true,
          streaming: false,
          vision: false
        },
        limits: {
          contextTokens: 16_000,
          outputTokens: 2_000,
          maxToolRounds: 6,
          timeoutMs: 5_000,
          maxResponseBytes: 32_768
        },
        privacy: { execution: "external", allowedDataClasses: ["public"], retention: "none" },
        costPolicy: "economy"
      }
    ]
  };
  const answer = await service(failing).run(request("kde je kemp?"), collect().emit);
  assert.ok(answer);
  assert.equal(answer.execution, "deterministic");
  assert.match(answer.text, /Kemp/);
});

test("the offline composition answers the same question over the demo fixtures", async () => {
  const turn = createAiChatTurnFactory({
    conversations: new AiConversationStore(),
    providers: createFixtureChatToolProviders({ fixtures: () => FIXTURES })
  });
  const answer = await turn({
    center: { longitude: 13.3775, latitude: 49.7475 },
    zoom: 13,
    activeLayerIds: ["osm-poi"]
  }).run(request("kempy poblíž", { externalModel: false, preciseLocation: false }), collect().emit);
  assert.ok(answer);
  assert.match(answer.text, /Kemp/);
  assert.ok(answer.sources.every((source) => source.label.includes("fixture")));
});

test("a message from someone else's account is refused before any tool runs", async () => {
  const sink = collect();
  const answer = await service().run(
    { ...request("kempy poblíž"), ownerUserId: "user-2" },
    sink.emit
  );
  assert.equal(answer, null);
  assert.deepEqual(
    sink.events.map((event) => event.type),
    ["error"]
  );
});
