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
import { createOfflineDiscoverContextService } from "../discoverService.js";
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
function scriptedRuntime(
  results: readonly (AiAdapterResult | ((input: AiAdapterRequest) => AiAdapterResult))[]
): {
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
      return typeof result === "function" ? result(input) : result;
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

/** The ids of the places a tool already returned, read back the way the model would read them:
 *  out of the tool result in the history. They are opaque hashes, so nothing else can know them. */
function placeIdsFromHistory(input: AiAdapterRequest): string[] {
  const ids: string[] = [];
  for (const turn of input.history ?? []) {
    if (turn.role !== "tool") continue;
    const parsed = JSON.parse(turn.content) as { places?: Array<{ id?: unknown }> };
    for (const place of parsed.places ?? []) {
      if (typeof place.id === "string") ids.push(place.id);
    }
  }
  return ids;
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
  // Verbs ending in a soft consonant are the normal Czech imperative; an ASCII word boundary
  // after "ť" or "ň" matches nothing, which used to send these to the planner as new plans.
  assert.equal(classifyChatIntent("zkrať plán na dva dny"), "edit_plan");
  assert.equal(classifyChatIntent("změň trasu, ať se vyhne dálnicím"), "edit_plan");
  assert.equal(classifyChatIntent("proč je tu kemp zavřený?"), "question");
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

test("a question about the place itself is answered from the guide, not from a category", async () => {
  const turn = createAiChatTurnFactory({
    conversations: new AiConversationStore(),
    providers: createFixtureChatToolProviders({
      fixtures: () => FIXTURES,
      discover: createOfflineDiscoverContextService()
    })
  });
  const sink = collect();
  const answer = await turn({
    center: { longitude: 13.3775, latitude: 49.7475 },
    zoom: 12,
    activeLayerIds: ["osm-poi"]
  }).run(
    request("co je tu zajímavého?", { externalModel: false, preciseLocation: false }),
    sink.emit
  );
  assert.ok(answer);
  assert.equal(answer.execution, "deterministic");
  assert.match(answer.text, /Plzeň/);
  assert.match(answer.text, /Velká synagoga/, "a highlight from the guide, not an invented one");
  assert.ok(
    answer.sources.some((source) => source.sourceId === "guide:wikivoyage:fixture"),
    "the guide the sentences came from is cited"
  );
  assert.ok(
    sink.events.some((event) => event.type === "tool_start" && event.tool === "get_region_context"),
    "the panel and the assistant read the same context tool"
  );
  assert.ok(
    !sink.events.some((event) => event.type === "tool_start" && event.tool === "get_stats"),
    "a question with no numbers in it does not pay for the statistics lookup"
  );
});

test("numbers arrive with their year and their source, or not at all", async () => {
  const turn = createAiChatTurnFactory({
    conversations: new AiConversationStore(),
    providers: createFixtureChatToolProviders({
      fixtures: () => FIXTURES,
      discover: createOfflineDiscoverContextService()
    })
  });
  const answer = await turn({
    center: { longitude: 13.3775, latitude: 49.7475 },
    zoom: 12,
    activeLayerIds: ["osm-poi"]
  }).run(
    request("kolik tady žije obyvatel?", { externalModel: false, preciseLocation: false }),
    collect().emit
  );
  assert.ok(answer);
  const card = answer.cards.find((entry) => entry.type === "facts");
  assert.ok(card && card.type === "facts");
  const [item] = card.items;
  assert.ok(item);
  assert.equal(item.label, "Počet obyvatel");
  assert.match(item.value, /181/);
  assert.match(item.note ?? "", /2025/, "a statistic without its year cannot be checked");
  assert.deepEqual(item.sourceIds, ["wikidata:fixture"]);
  assert.ok(answer.sources.some((source) => source.sourceId === "wikidata:fixture"));
});

test("a layer the model emits is built from the rows it cited, or it is not offered", async () => {
  const { runtime } = scriptedRuntime([
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
    (input) => ({
      text: "",
      finishReason: "tool-call",
      toolCalls: [
        {
          id: "call-2",
          name: "emit_layer",
          arguments: {
            text: "Vrstva se dvěma kempy v okolí.",
            name: "Kempy u vody",
            placeIds: [...placeIdsFromHistory(input), "poi:invented"]
          }
        }
      ]
    })
  ]);

  const sink = collect();
  const answer = await service(runtime).run(request("vytvoř vrstvu s kempy"), sink.emit);
  assert.ok(answer);
  const card = answer.cards.find((entry) => entry.type === "layer-draft");
  assert.ok(card && card.type === "layer-draft");
  assert.equal(card.featureCount, 2, "the invented id never becomes a point on the map");
  assert.equal(card.manifest.source.type, "inline");
  assert.ok((card.manifest.attribution ?? []).length > 0, "the layer carries its attribution");
  assert.ok(
    !answer.cards.some((entry) => entry.type === "places"),
    "the same places are not listed twice next to the layer"
  );
});

test("a layer selection may only name layers a tool listed for this user", async () => {
  const { runtime } = scriptedRuntime([
    {
      text: "",
      finishReason: "tool-call",
      toolCalls: [{ id: "call-1", name: "list_available_layers", arguments: {} }]
    },
    {
      text: "",
      finishReason: "tool-call",
      toolCalls: [
        {
          id: "call-2",
          name: "select_layers",
          arguments: {
            text: "Zapnula jsem vrstvu s kempy.",
            title: "Kempování",
            layerIds: ["osm-poi", "secret-layer"],
            filters: { openNow: true, tags: ["kemp"] }
          }
        }
      ]
    }
  ]);

  const answer = await service(runtime).run(
    request("zapni mi vrstvy pro kempování"),
    collect().emit
  );
  assert.ok(answer);
  assert.equal(answer.intent, "command");
  const card = answer.cards.find((entry) => entry.type === "layer");
  assert.ok(card && card.type === "layer");
  assert.deepEqual(card.layerIds, ["osm-poi"], "a layer outside the projection is dropped");
  assert.deepEqual(card.filters, { openNow: true, tags: ["kemp"] });
});

test("an edit to an open plan arrives as a diff to confirm, never as a write", async () => {
  const { runtime } = scriptedRuntime([
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
    (input) => ({
      text: "",
      finishReason: "tool-call",
      toolCalls: [
        {
          id: "call-2",
          name: "apply_plan_commands",
          arguments: {
            text: "Přidal bych Kemp U Řeky jako druhou zastávku.",
            summary: "Přidat Kemp U Řeky na druhé místo.",
            edits: [{ op: "add-stop", placeId: placeIdsFromHistory(input)[0], atIndex: 1 }]
          }
        }
      ]
    })
  ]);

  const proposed: unknown[] = [];
  const { registry, available } = createChatToolRegistry({
    providers: {
      placeSearch: createMemoryPlaceSearchSource(() => FIXTURES),
      layers: () => [
        { layerId: "osm-poi", name: "OSM POI", categories: ["stay.camp_site"], access: "public" }
      ]
    },
    mapContext: {
      center: { longitude: 13.3775, latitude: 49.7475 },
      zoom: 13,
      activeLayerIds: ["osm-poi"]
    }
  });
  const chat = new AiChatService({
    registry,
    conversations: new AiConversationStore(),
    availableTools: available,
    runtime,
    planEditor: {
      async propose(input) {
        proposed.push(input);
        return {
          proposalId: "proposal-1",
          planId: input.planId,
          diff: {
            baseRevision: 1,
            previewRevision: 2,
            changedPlanFields: [],
            addedStopIds: ["ai-stop-1"],
            removedStopIds: [],
            movedStopIds: [],
            updatedStopIds: [],
            affectedSegmentIds: []
          }
        };
      }
    }
  });

  const base = request("přidej kemp na den 2 do plánu");
  const answer = await chat.run(
    {
      ...base,
      context: { ...base.context, planId: "plan-1" },
      projection: { ...projection, allowedPlanIds: new Set(["plan-1"]) }
    },
    collect().emit
  );
  assert.ok(answer);
  const card = answer.cards.find((entry) => entry.type === "plan-edit");
  assert.ok(card && card.type === "plan-edit");
  assert.equal(card.proposalId, "proposal-1");
  assert.deepEqual(card.diff.addedStopIds, ["ai-stop-1"]);
  assert.equal(proposed.length, 1, "the chat proposes once and applies nothing");
});

test("without an open plan the model is not even offered the plan-edit tool", async () => {
  const { runtime, requests } = scriptedRuntime([
    {
      text: "",
      finishReason: "tool-call",
      toolCalls: [{ id: "c", name: "submit_answer", arguments: { text: "Otevři nejdřív plán." } }]
    }
  ]);
  await service(runtime).run(request("přidej kutnou horu do plánu"), collect().emit);
  const offered = new Set((requests[0]?.tools ?? []).map((tool) => tool.name));
  assert.ok(!offered.has("apply_plan_commands"));
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
