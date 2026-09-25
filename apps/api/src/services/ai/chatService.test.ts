import assert from "node:assert/strict";
import test from "node:test";
import {
  AiChatService,
  classifyChatIntent,
  explicitTripDestination,
  type AiChatEvent
} from "./chatService.js";
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
    ["conversation", "intent", "tool_start", "tool_result", "token", "sources", "card", "done"]
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
    ["conversation", "intent", "tool_start", "tool_result", "sources", "card", "done"]
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
            filters: { openNow: true, tags: ["kemp"] },
            opacityByLayer: { "osm-poi": 0.4, "secret-layer": 0.8 },
            time: "2026-09-24T22:00:00Z"
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
  assert.deepEqual(card.opacityByLayer, { "osm-poi": 0.4 });
  assert.equal(card.time, "2026-09-24T22:00:00Z");
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

test("selected area is bound to place tools and center statistics are unavailable", async () => {
  const area = {
    id: '["gisco","ES","lau","43148"]',
    revision: "a".repeat(64),
    name: "Tarragona",
    level: "lau" as const,
    country: "ES",
    source: "gisco",
    code: "43148",
    bbox: [1, 40, 2, 42] as [number, number, number, number]
  };
  const received: unknown[] = [];
  const { registry, available } = createChatToolRegistry({
    providers: {
      placeSearch: {
        async search(query) {
          received.push(query.area);
          return { places: [], sources: [] };
        }
      },
      layers: () => [],
      regionContext: async () => {
        throw new Error("must not reverse geocode selected area");
      },
      stats: async () => {
        throw new Error("must not substitute center statistics");
      }
    },
    mapContext: {
      center: { longitude: 1.2, latitude: 41.1 },
      zoom: 12,
      activeLayerIds: ["osm-poi"],
      area
    }
  });
  assert.equal(available.has("get_stats"), false);
  assert.equal(available.has("get_region_context"), false);
  const result = await registry.invoke(
    "search_places",
    { categories: ["camp_site"], bbox: [1, 40, 2, 42], limit: 3 },
    { actor, projection }
  );
  assert.equal(result.status, "succeeded", JSON.stringify(result));
  assert.deepEqual(received, [area]);
});

test("a fresh chat service restores durable conversation and advances its compare-and-swap revision", async () => {
  const documents = new Map<string, import("./conversation.js").AiConversation>();
  const persistence: import("./conversationPersistence.js").ConversationPersistence = {
    async load(owner, id) {
      const doc = documents.get(id);
      if (!doc || doc.ownerUserId !== owner) throw new Error("not found");
      return structuredClone(doc);
    },
    async save(document, revision) {
      const prior = documents.get(document.id);
      assert.equal(prior?.revision ?? null, revision);
      documents.set(document.id, structuredClone(document));
    }
  };
  const factory = () =>
    createAiChatTurnFactory({
      conversations: new AiConversationStore(),
      persistence,
      providers: createFixtureChatToolProviders({ fixtures: () => FIXTURES })
    })({
      center: { longitude: 13.3775, latitude: 49.7475 },
      zoom: 13,
      activeLayerIds: ["osm-poi"]
    });
  const sink = collect();
  await factory().run(
    request("najdi kemp", { externalModel: false, preciseLocation: false }),
    sink.emit
  );
  const done = sink.events.find((event) => event.type === "done");
  assert(done?.type === "done");
  assert.equal(documents.get(done.conversation.id)?.revision, done.conversation.revision);
  const next = collect();
  await factory().run(
    {
      ...request("najdi bar", { externalModel: false, preciseLocation: false }),
      conversation: {
        mode: "existing",
        conversationId: done.conversation.id,
        baseRevision: done.conversation.revision
      }
    },
    next.emit
  );
  const second = next.events.find((event) => event.type === "done");
  assert(second?.type === "done");
  assert.equal(second.conversation.revision, done.conversation.revision + 2);
  const record = documents.get(second.conversation.id)!;
  assert(
    record.messages
      .filter((message) => message.role === "assistant")
      .every((message) => message.dataClass === "account-private")
  );
});

test("feature questions share overview acquisition, expose geometry early and preserve partial limitations", async () => {
  const { OverviewService } = await import("./overviewService.js");
  let calls = 0;
  const overview = new OverviewService({
    detail: async () => {
      calls++;
      return {
        place: {
          id: "osm:node:1",
          name: "Parkoviště",
          category: "parking",
          lng: 1,
          lat: 2,
          sources: []
        },
        fields: { name: "Parkoviště", category: "parking" },
        source: {
          sourceId: "record:osm:node:1",
          label: "OSM",
          providerId: "osm",
          url: "https://www.openstreetmap.org/node/1"
        }
      };
    },
    collect: async () => {
      throw new Error("Web je nedostupný.");
    }
  });
  const factory = createAiChatTurnFactory({
    overview,
    conversations: new AiConversationStore(),
    providers: createFixtureChatToolProviders({ fixtures: () => FIXTURES })
  });
  const input = {
    ...request("Co je to za místo?", { externalModel: false, preciseLocation: false }),
    context: { ...request("").context, featureRef: { layerId: "osm-poi", featureId: "osm:node:1" } }
  };
  const sink = collect();
  const answer = await factory({
    center: { longitude: 1, latitude: 2 },
    zoom: 13,
    activeLayerIds: ["osm-poi"]
  }).run(input, sink.emit);
  assert.equal(calls, 1);
  assert(sink.events.find((event) => event.type === "card" && event.card.type === "places"));
  assert(answer?.cards.some((card) => card.type === "places"));
  assert(
    answer?.cards.some(
      (card) =>
        card.type === "facts" &&
        card.title === "Omezení přehledu" &&
        card.items.some((item) => item.value.includes("nedostupný"))
    )
  );
  assert(answer?.sources.length);
});

test("statistical questions use grounded service before the model and keep follow-up history", async () => {
  const { runtime, requests } = scriptedRuntime([
    { text: "irrelevant location", finishReason: "stop" }
  ]);
  const conversations = new AiConversationStore();
  const { registry } = createChatToolRegistry({
    providers: createFixtureChatToolProviders({ fixtures: () => FIXTURES }),
    mapContext: { center: { longitude: 1.25, latitude: 41.12 }, zoom: 12, activeLayerIds: [] }
  });
  const histories: string[][] = [];
  const service = new AiChatService({
    registry,
    conversations,
    runtime,
    statistics: async (message, history) => {
      histories.push([...history]);
      return {
        execution: "deterministic",
        intent: "question",
        text: `Statistika: ${message}`,
        cards: [],
        sources: [],
        followUps: []
      };
    }
  });
  const first = collect();
  await service.run(request("chudoba v CR"), first.emit);
  const done = first.events.find((e) => e.type === "done");
  assert(done?.type === "done");
  await service.run(
    {
      ...request("a nezaměstnanost?"),
      conversation: {
        mode: "existing",
        conversationId: done.conversation.id,
        baseRevision: done.conversation.revision
      }
    },
    collect().emit
  );
  assert.deepEqual(histories, [[], ["chudoba v CR"]]);
  assert.equal(requests.length, 0);
});
test("an unsupported nonlocal question never becomes a description of the current location", async () => {
  const turn = createAiChatTurnFactory({
    conversations: new AiConversationStore(),
    providers: createFixtureChatToolProviders({
      fixtures: () => FIXTURES,
      discover: createOfflineDiscoverContextService()
    })
  });
  const answer = await turn({
    center: { longitude: 13.37, latitude: 49.74 },
    zoom: 12,
    activeLayerIds: []
  }).run(
    request("kde je největší chudoba v CR", { externalModel: false, preciseLocation: false }),
    collect().emit
  );
  assert(answer);
  assert.doesNotMatch(answer.text, /Jsi v|Oblast ve výřezu/);
  assert.match(answer.text, /nemám ověřenou odpověď/);
});

test("explicit question about the selected area shares the exact overview rather than reverse geocoding", async () => {
  const { OverviewService } = await import("./overviewService.js");
  let code = "";
  const overview = new OverviewService({
    detail: async () => {
      throw new Error("unexpected POI");
    },
    area: async (id, revision) => {
      code = id;
      return {
        id,
        revision,
        source: "gisco-lau-cz",
        country: "CZ",
        level: "lau",
        code: "CZ_554782",
        name: "Praha",
        bbox: [14, 49, 15, 51]
      };
    }
  });
  const factory = createAiChatTurnFactory({
    overview,
    conversations: new AiConversationStore(),
    providers: createFixtureChatToolProviders({ fixtures: () => FIXTURES })
  });
  const turn = factory({
    center: { longitude: 1, latitude: 41 },
    zoom: 10,
    activeLayerIds: ["osm-poi"]
  });
  const base = request("Co víš o této oblasti?", { externalModel: false, preciseLocation: false });
  const answer = await turn.run(
    {
      ...base,
      context: { ...base.context, areaRef: { areaId: "verified-praha", boundaryRevision: "r1" } }
    },
    collect().emit
  );
  assert.equal(code, "verified-praha");
  assert.match(answer!.text, /Praha/);
  assert(!answer!.text.includes("Plzeň"));
});

// Catalog and geometry tool results must remain parseable, even at the context limit.
test("tool serialization preserves complete catalog JSON and rejects oversized data", async () => {
  const { serializeToolResult } = await import("./chatService.js");
  const catalog = {
    layers: Array.from({ length: 40 }, (_, i) => ({
      layerId: `layer-${i}`,
      description: "a".repeat(200)
    })),
    nextOffset: 40
  };
  assert.deepEqual(JSON.parse(serializeToolResult(catalog)), catalog);
  assert.equal(
    JSON.parse(serializeToolResult({ data: "a".repeat(140000) })).error,
    "result_too_large"
  );
});

test("Málaga planning from Prague resolves the destination before place search and routing", async () => {
  const providers = createFixtureChatToolProviders({
    fixtures: () => [
      { osmId: "node/101", category: "viewpoint", name: "Mirador uno", lng: -4.421, lat: 36.72 },
      { osmId: "node/102", category: "viewpoint", name: "Mirador dos", lng: -4.42, lat: 36.73 }
    ]
  });
  providers.resolveLocation = async (query) => {
    assert.equal(query, "Malagy");
    return [{ name: "Málaga", longitude: -4.421, latitude: 36.72 }];
  };
  let routed = false;
  let previewed = false;
  providers.routeMatrix = async (stops) =>
    stops.map((_, i) => stops.map((_, j) => (i === j ? 0 : 3600)));
  providers.routePlan = async (stops, profile, signal) => {
    assert.equal(profile, "foot");
    assert.ok(stops.every((s) => s.longitude < -4 && s.latitude < 37));
    assert.equal(signal?.aborted ?? false, false);
    assert.equal(previewed, true, "verified stops are delivered before routing starts");
    routed = true;
    return {
      coordinates: stops.map((s) => [s.longitude, s.latitude]),
      distanceM: 6500,
      durationS: 7200,
      provider: "osm",
      profile
    };
  };
  const make = createAiChatTurnFactory({ providers, conversations: new AiConversationStore() });
  const context = {
    center: { longitude: 14.42, latitude: 50.08 },
    zoom: 13,
    activeLayerIds: ["osm-poi"]
  };
  const service = make(context);
  const input = request("hezký výlet v okolí Malagy", {
    externalModel: false,
    preciseLocation: false
  });
  input.context.mapCenter = { ...context.center };
  const answer = await service.run(input, (event) => {
    if (event.type === "map_preview") {
      previewed = true;
      assert.ok(event.answer.cards.some((c) => c.type === "plan" && c.stops.length >= 2));
    }
  });
  const card = answer?.cards.find((c) => c.type === "plan");
  assert.ok(card && card.type === "plan");
  assert.equal(routed, true);
  assert.ok(card.route && card.route.distanceM > 0 && card.route.coordinates.length >= 2);
  assert.equal(
    context.center.longitude,
    -4.421,
    "tool context changes with the resolved destination"
  );
});

test("adding a cafe updates the draft while retaining locks, endpoints, order and bike profile", async () => {
  const { planV1ToV2 } = await import("@mapos/layer-sdk");
  const draft = planV1ToV2({
    id: "draft",
    name: "Málaga",
    departureAt: new Date().toISOString(),
    variant: "fast",
    visibility: "private",
    vehicle: { profile: "bike" },
    stops: [
      { id: "start", name: "Start", lng: -4.42, lat: 36.72, dwellMinutes: 0 },
      { id: "locked", name: "Pevná zastávka", lng: -4.41, lat: 36.72, dwellMinutes: 30 },
      { id: "finish", name: "Cíl", lng: -4.4, lat: 36.72, dwellMinutes: 0 }
    ]
  });
  draft.stops[1]!.locked = true;
  const providers = createFixtureChatToolProviders({
    fixtures: () => [
      { osmId: "node/coffee", category: "cafe", name: "Café", lng: -4.415, lat: 36.72 }
    ]
  });
  providers.routeMatrix = async (stops, profile) => {
    assert.equal(profile, "bike");
    assert.ok(stops.length <= 10);
    return stops.map((a) => stops.map((b) => Math.abs(a.longitude - b.longitude) * 100000));
  };
  providers.routePlan = async (stops, profile) => ({
    coordinates: stops.map((s) => [s.longitude, s.latitude]),
    distanceM: 2500,
    durationS: 900,
    provider: "osm",
    profile
  });
  const make = createAiChatTurnFactory({ providers, conversations: new AiConversationStore() });
  const input = request("přidej kavárnu", { externalModel: false, preciseLocation: false });
  const answer = await make({
    center: input.context.mapCenter,
    zoom: 13,
    activeLayerIds: ["osm-poi"]
  }).run({ ...input, context: { ...input.context, tripDraft: draft } }, collect().emit);
  const card = answer?.cards.find((c) => c.type === "plan");
  assert.ok(card && card.type === "plan" && card.draft);
  assert.equal(card.profile, "bike");
  assert.equal(card.draft.stops.length, 4);
  assert.deepEqual(
    card.draft.stops
      .filter((s) => s.id !== card.draft!.stops.find((s) => s.name === "Café")?.id)
      .map((s) => s.id),
    ["start", "locked", "finish"]
  );
  assert.equal(card.draft.stops.find((s) => s.id === "locked")?.locked, true);
  assert.equal(draft.stops.length, 3, "saved/input document is not mutated");
  assert.equal(card.draft.revision, draft.revision + 1);
});

test("requested radius uses the geometry tool and emits a sourced polygon without a model", async () => {
  const answer = await service().run(
    request("ukaž okruh 10 km", { externalModel: false, preciseLocation: false }),
    collect().emit
  );
  assert.ok(answer);
  assert.equal(answer.execution, "deterministic");
  assert.equal(answer.mapResults?.length, 1);
  assert.equal(answer.mapResults![0]!.data.features[0]!.geometry.type, "Polygon");
  assert.equal(answer.mapResults![0]!.derived?.method, "geodesic-buffer");
  assert.match(answer.text, /Nejde o dojezdovou oblast/);
});

test("explicit radius origin wins over the viewport without interpreting here as a place", () => {
  assert.equal(explicitTripDestination("Zobraz oblast 10 km od Málagy"), "Málagy");
  assert.equal(explicitTripDestination("Show area 5 km from Málaga"), "Málaga");
  assert.equal(explicitTripDestination("Zobraz oblast 10 km od nás"), null);
});

test("night-sky planning compares bounded real candidates for the upcoming astronomical night", async () => {
  const providers = createFixtureChatToolProviders({
    fixtures: () => [
      { osmId: "node/201", category: "viewpoint", name: "Bright hill", lng: 13.379, lat: 49.749 },
      { osmId: "node/202", category: "viewpoint", name: "Dark hill", lng: 13.4, lat: 49.749 },
      { osmId: "node/203", category: "viewpoint", name: "Unknown hill", lng: 13.42, lat: 49.749 },
      { osmId: "node/204", category: "viewpoint", name: "Further hill", lng: 13.45, lat: 49.749 }
    ]
  });
  const nightStart = new Date(Date.now() + 2 * 3600000).toISOString();
  const calls: { lng: number; at: string }[] = [];
  providers.nightSky = async (lng, _lat, at) => {
    calls.push({ lng, at });
    return {
      at,
      timezone: "Europe/Prague",
      localTime: at,
      nightStart,
      nightEnd: new Date(Date.parse(nightStart) + 8 * 3600000).toISOString(),
      moonAltitudeDeg: -12,
      moonIlluminatedFraction: 0.2,
      cloudCoverPercent: 10,
      skyBrightness:
        lng > 13.41
          ? null
          : {
              value: lng > 13.39 ? 0.1 : 5,
              unit: "mcd/m²",
              modelYear: 2015,
              component: "artificial-zenith",
              sourceId: "falchi-world-atlas"
            },
      limitations: [],
      sources: ["falchi-world-atlas", "astronomy-suncalc", "open-meteo"].map((sourceId) => ({
        sourceId,
        label: sourceId,
        url: "https://example.org",
        retrievedAt: at
      }))
    };
  };
  const make = createAiChatTurnFactory({ providers, conversations: new AiConversationStore() });
  const input = request("chci pozorovat noční oblohu", {
    externalModel: false,
    preciseLocation: false
  });
  input.projection = {
    ...projection,
    allowedLayerIds: new Set([
      "osm-poi",
      "carto-dark",
      "sky-brightness",
      "dark-sky",
      "weather-clouds"
    ])
  };
  const result = await make({
    center: input.context.mapCenter,
    zoom: 13,
    activeLayerIds: ["osm-poi"]
  }).run(input, collect().emit);
  assert.ok(result);
  assert.equal(
    calls.length,
    5,
    "one center lookup, one night adjustment, and only three candidates"
  );
  assert.ok(
    calls.slice(1).every((c) => c.at === new Date(Date.parse(nightStart) + 3600000).toISOString())
  );
  const places = result.cards.find((c) => c.type === "places");
  assert.equal(places?.type === "places" ? places.places[0]?.title : null, "Dark hill");
  const facts = result.cards.find(
    (c) => c.type === "facts" && c.title === "Porovnání doložených vyhlídek"
  );
  assert.equal(facts?.type === "facts" ? facts.items.length : 0, 3);
  assert.match(JSON.stringify(facts), /bez dat/);
  assert.match(result.text, /první hodinu/);
});

test("the production catalogue accepts Czech aliases and preserves numerical capability metadata", async () => {
  const { layerCatalog } = await import("./chatComposition.js");
  const catalog = layerCatalog();
  const providers = createFixtureChatToolProviders({ fixtures: () => [] });
  providers.layers = () => catalog;
  const { registry } = createChatToolRegistry({
    providers,
    mapContext: { center: { longitude: 0, latitude: 0 }, zoom: 2, activeLayerIds: [] }
  });
  const context = {
    actor,
    projection: { ...projection, allowedLayerIds: new Set(catalog.map((c) => c.layerId)) }
  };
  for (let offset = 0; offset < catalog.length; offset += 40) {
    const result = await registry.invoke("list_available_layers", { offset, limit: 40 }, context);
    assert.equal(result.status, "succeeded", JSON.stringify(result));
  }
  const result = await registry.invoke<{
    layers: import("./chatTools.js").AiChatLayerDescriptor[];
  }>("list_available_layers", { query: "světelný smog" }, context);
  assert.equal(result.status, "succeeded", JSON.stringify(result));
  if (result.status !== "succeeded") return;
  assert.deepEqual(result.value.layers.find((l) => l.layerId === "dark-sky")?.data?.operations, [
    "display"
  ]);
  assert.ok(
    result.value.layers
      .find((l) => l.layerId === "sky-brightness")
      ?.data?.operations.includes("query-point")
  );
});

test("night-sky destination excludes the Czech vicinity phrase", () => {
  assert.equal(explicitTripDestination("chci pozorovat noční oblohu v okolí Malagy"), "Malagy");
  assert.equal(explicitTripDestination("pozorovat hvězdy v Praze"), "Praze");
  assert.equal(explicitTripDestination("stargazing near Málaga"), "Málaga");
});

test("model can edit an unsaved working trip without a saved-plan permission or write", async () => {
  const { planV1ToV2 } = await import("@mapos/layer-sdk");
  const draft = planV1ToV2({
    id: "unsaved",
    departureAt: "2026-09-24T10:00:00Z",
    name: "Výlet",
    visibility: "private",
    variant: "fast",
    vehicle: { profile: "foot" },
    stops: [
      { id: "start", name: "Start", lng: 14, lat: 50, dwellMinutes: 0 },
      { id: "view", name: "Vyhlídka", lng: 14.01, lat: 50, dwellMinutes: 15 },
      { id: "cafe", name: "Kavárna", lng: 14.02, lat: 50, dwellMinutes: 15 },
      { id: "end", name: "Cíl", lng: 14.03, lat: 50, dwellMinutes: 0 }
    ]
  });
  const { runtime, requests } = scriptedRuntime([
    {
      text: "",
      finishReason: "tool-call",
      toolCalls: [
        {
          id: "edit",
          name: "apply_plan_commands",
          arguments: {
            text: "Přesunul jsem vyhlídku za kavárnu.",
            summary: "Nové pořadí",
            edits: [{ op: "move-stop", stopId: "view", toIndex: 2 }]
          }
        }
      ]
    }
  ]);
  const base = request("přesuň vyhlídku za kavárnu");
  const answer = await service(runtime).run(
    { ...base, context: { ...base.context, tripDraft: draft } },
    collect().emit
  );
  const card = answer?.cards.find((c) => c.type === "plan");
  assert.ok(card?.type === "plan" && card.draft);
  assert.deepEqual(
    card.draft.stops.map((s) => s.id),
    ["start", "cafe", "view", "end"]
  );
  assert.deepEqual(
    draft.stops.map((s) => s.id),
    ["start", "view", "cafe", "end"]
  );
  assert.equal(card.draft.revision, draft.revision + 1);
  const context = requests[0]!.prompt;
  assert.ok(context.includes("working-trip"));
  assert.ok(context.includes('"locked":true'));
  assert.ok(!context.includes("coordinates"));
});

test("web discoveries geocode into grounded pins and an automatically computed route", async () => {
  const { runtime } = scriptedRuntime([
    {
      text: "",
      finishReason: "tool-call",
      toolCalls: [{ id: "web", name: "web_search", arguments: { query: "dvě dílny v Praze" } }]
    },
    {
      text: "",
      finishReason: "tool-call",
      toolCalls: [
        {
          id: "a",
          name: "resolve_location",
          arguments: { query: "Dílna A, Praha", asPlace: true }
        },
        { id: "b", name: "resolve_location", arguments: { query: "Dílna B, Praha", asPlace: true } }
      ]
    },
    (input) => ({
      text: "",
      finishReason: "tool-call",
      toolCalls: [
        {
          id: "answer",
          name: "submit_plan",
          arguments: {
            name: "Dílny",
            text: "Trasa mezi ověřenými adresami.",
            stops: placeIdsFromHistory(input).map((placeId) => ({ placeId }))
          }
        }
      ]
    })
  ]);
  const providers = createFixtureChatToolProviders({ fixtures: () => [] });
  providers.web = createFixtureWebTools([
    { url: "https://fixture.test/dilny", title: "Dílny", text: "Dílna A, Praha. Dílna B, Praha." }
  ]);
  providers.resolveLocation = async (query) => [
    { name: query, longitude: query.includes("A,") ? 14.42 : 14.43, latitude: 50.08 }
  ];
  let routed = false;
  providers.routePlan = async (stops, profile) => {
    routed = true;
    assert.equal(stops.length, 2);
    assert.equal(profile, "foot");
    return {
      coordinates: stops.map((s) => [s.longitude, s.latitude]),
      distanceM: 900,
      durationS: 750,
      profile,
      provider: "mapy"
    };
  };
  const context = { center: { longitude: 13.37, latitude: 49.74 }, zoom: 13, activeLayerIds: [] };
  const { registry, available } = createChatToolRegistry({ providers, mapContext: context });
  const service = new AiChatService({
    registry,
    availableTools: available,
    runtime,
    conversations: new AiConversationStore(),
    routePlan: providers.routePlan
  });
  const debug = collect();
  const answer = await service.run(request("Najdi dvě dílny a spoj je pěšky"), debug.emit);

  const plan = answer?.cards.find((c) => c.type === "plan");
  assert.ok(plan?.type === "plan");
  assert.ok(plan.stops.every((s) => s.sourceId === "mapos-geocoder"));
  assert.equal(plan.route?.distanceM, 900);
  assert.equal(routed, true);
  assert.equal(
    context.center.longitude,
    13.37,
    "geocoding a result does not redirect subsequent context"
  );
});

/** A composition whose geocoder answers from a tiny gazetteer and whose router draws straight
 *  lines, so the new "places without ids" paths can be followed end to end. */
function geocodingService(runtime: AiModelRuntime) {
  const providers = createFixtureChatToolProviders({ fixtures: () => [] });
  const gazetteer: Record<string, { longitude: number; latitude: number }> = {
    Vrchlabí: { longitude: 15.6, latitude: 50.63 },
    "Pec pod Sněžkou": { longitude: 15.73, latitude: 50.69 },
    "Obec A": { longitude: 14, latitude: 50 }
  };
  const queries: string[] = [];
  providers.resolveLocation = async (query) => {
    queries.push(query);
    const hit = gazetteer[query];
    return hit ? [{ name: `${query}, Česko`, ...hit }] : [];
  };
  let routed = 0;
  providers.routePlan = async (stops, profile) => {
    routed += 1;
    return {
      coordinates: stops.map((s) => [s.longitude, s.latitude]),
      distanceM: 1000,
      durationS: 600,
      profile,
      provider: "mapy"
    };
  };
  const context = { center: { longitude: 15.6, latitude: 50.6 }, zoom: 10, activeLayerIds: [] };
  const { registry, available } = createChatToolRegistry({ providers, mapContext: context });
  return {
    queries,
    routedCount: () => routed,
    service: new AiChatService({
      registry,
      availableTools: available,
      runtime,
      conversations: new AiConversationStore(),
      routePlan: providers.routePlan
    })
  };
}

test("places named in submit_answer are geocoded by the server and shown without ids", async () => {
  const { runtime } = scriptedRuntime([
    {
      text: "",
      finishReason: "tool-call",
      toolCalls: [
        {
          id: "answer",
          name: "submit_answer",
          arguments: {
            text: "Dvě dobrá výchozí místa.",
            places: [{ name: "Vrchlabí" }, { name: "Pec pod Sněžkou" }, { name: "Atlantida" }]
          }
        }
      ]
    }
  ]);
  const { service, queries } = geocodingService(runtime);
  const answer = await service.run(request("kam vyrazit do Krkonoš?"), collect().emit);
  const card = answer?.cards.find((c) => c.type === "places");
  assert.ok(card?.type === "places");
  assert.deepEqual(
    card.places.map((p) => p.title),
    ["Vrchlabí", "Pec pod Sněžkou"],
    "a name the geocoder cannot find is not drawn"
  );
  assert.ok(card.places.every((p) => p.sourceId === "mapos-geocoder"));
  assert.ok(queries.includes("Atlantida"));
});

test("plan stops given by name become a routed plan", async () => {
  const { runtime } = scriptedRuntime([
    {
      text: "",
      finishReason: "tool-call",
      toolCalls: [
        {
          id: "plan",
          name: "submit_plan",
          arguments: {
            name: "Krkonoše",
            text: "Z Vrchlabí do Pece.",
            stops: [{ name: "Vrchlabí" }, { name: "Pec pod Sněžkou", note: "cíl" }]
          }
        }
      ]
    }
  ]);
  const { service, routedCount } = geocodingService(runtime);
  const answer = await service.run(request("naplánuj trasu z Vrchlabí do Pece"), collect().emit);
  const plan = answer?.cards.find((c) => c.type === "plan");
  assert.ok(plan?.type === "plan");
  assert.deepEqual(
    plan.stops.map((s) => s.title),
    ["Vrchlabí", "Pec pod Sněžkou"]
  );
  assert.equal(plan.route?.distanceM, 1000);
  assert.equal(routedCount(), 1);
});

test("a prose answer keeps its text and turns listed places into pins and a route", async () => {
  const { runtime } = scriptedRuntime([
    {
      text: "Doporučená trasa:\n- **Vrchlabí** – start u zámku\n- **Pec pod Sněžkou** – cíl\n\nPočítej se 4 hodinami.",
      finishReason: "stop",
      toolCalls: []
    }
  ]);
  const { service } = geocodingService(runtime);
  const answer = await service.run(request("jaká je hezká trasa v Krkonoších?"), collect().emit);
  assert.ok(answer);
  assert.equal(answer.execution, "model-tool-loop");
  assert.match(answer.text, /\n- \*\*Vrchlabí\*\*/u, "paragraphs and list lines survive");
  const plan = answer.cards.find((c) => c.type === "plan");
  assert.ok(plan?.type === "plan");
  assert.equal(plan.stops.length, 2);
});

test("rejected mapData goes back to the model once instead of ending the turn", async () => {
  const page = "Index 2024, body. Obec A: 12,5 bodů.";
  const { runtime, requests } = scriptedRuntime([
    {
      text: "",
      finishReason: "tool-call",
      toolCalls: [{ id: "fetch", name: "web_fetch", arguments: { url: "https://fixture.test/i" } }]
    },
    {
      text: "",
      finishReason: "tool-call",
      toolCalls: [
        {
          id: "bad",
          name: "submit_answer",
          arguments: {
            text: "Index obcí.",
            mapData: {
              title: "Index",
              unit: "body",
              time: "2024",
              rows: [
                {
                  placeName: "Obec A",
                  value: 99,
                  sourceUrl: "https://fixture.test/i",
                  quote: "Obec A: 99 bodů."
                }
              ]
            }
          }
        }
      ]
    },
    {
      text: "",
      finishReason: "tool-call",
      toolCalls: [
        {
          id: "good",
          name: "submit_answer",
          arguments: {
            text: "Index obcí.",
            mapData: {
              title: "Index",
              unit: "body",
              time: "2024",
              rows: [
                {
                  placeName: "Obec A",
                  value: 12.5,
                  sourceUrl: "https://fixture.test/i",
                  quote: "Obec A: 12,5 bodů."
                }
              ]
            }
          }
        }
      ]
    }
  ]);
  // The fixture web tools only serve pages they were given.
  const providers = createFixtureChatToolProviders({ fixtures: () => [] });
  providers.web = createFixtureWebTools([
    { url: "https://fixture.test/i", title: "Index", text: page }
  ]);
  providers.resolveLocation = async (query) =>
    query === "Obec A" ? [{ name: "Obec A, Česko", longitude: 14, latitude: 50 }] : [];
  const { registry, available } = createChatToolRegistry({
    providers,
    mapContext: { center: { longitude: 14, latitude: 50 }, zoom: 9, activeLayerIds: [] }
  });
  const service = new AiChatService({
    registry,
    availableTools: available,
    runtime,
    conversations: new AiConversationStore()
  });
  const answer = await service.run(request("ukaž index obcí na mapě"), collect().emit);
  assert.equal(requests.length, 3, "the model got its correction round");
  const retry = requests[2]!.history?.at(-1);
  assert.equal(retry?.role, "tool");
  assert.match(retry?.content ?? "", /mapData odmítnuto/u);
  assert.equal(answer?.mapResults?.[0]?.data.features[0]?.properties.value, 12.5);
});
