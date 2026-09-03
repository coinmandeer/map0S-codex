import assert from "node:assert/strict";
import test from "node:test";
import { AI_CONVERSATION_MODEL_CONTEXT_BYTE_LIMIT, AiConversationStore } from "./conversation.js";
import { ProviderNeutralAiOrchestrator } from "./orchestrator.js";
import {
  createMapAiToolRegistry,
  type MapAiToolHandler,
  type MapAiToolHandlers
} from "./toolCatalog.js";
import type { AiToolContext, AiToolTrace } from "./toolRegistry.js";

const unavailable: MapAiToolHandler = async () => {
  throw new Error("unused fixture handler");
};

const handlers: MapAiToolHandlers = {
  get_current_map_context: unavailable,
  list_available_layers: unavailable,
  query_layer: unavailable,
  search_places: unavailable,
  set_layer_selection_draft: unavailable,
  query_saved_places: unavailable,
  get_feature_detail: unavailable,
  route_segment: unavailable,
  get_weather: unavailable,
  search_events: unavailable,
  get_region_context: unavailable,
  get_stats: unavailable,
  web_search: unavailable,
  web_fetch: unavailable,
  create_plan_draft: unavailable
};

function fixtureStore() {
  let id = 0;
  let tick = 0;
  return new AiConversationStore(
    () => new Date(1_780_000_000_000 + tick++ * 1_000),
    () => "orchestration-" + ++id
  );
}

const context: AiToolContext = {
  actor: {
    authenticated: true,
    userId: "user-1",
    permissions: new Set(["poi:read"]),
    entitlementIds: new Set<string>()
  },
  projection: {
    allowedLayerIds: new Set(["bars-public"]),
    allowedPlanIds: new Set<string>(),
    allowedFeatureFieldsByLayer: new Map(),
    allowedDataClasses: new Set(["public"]),
    allowPreciseLocation: false
  }
};

test("natural-language nearest-bar orchestration invokes the authorized tool and stores citations", async () => {
  const traces: AiToolTrace[] = [];
  let sourceCalls = 0;
  const registry = createMapAiToolRegistry({
    handlers,
    nearestPoiSource: {
      async query(input) {
        sourceCalls += 1;
        assert.equal(input.category, "food.bar");
        assert.deepEqual(input.layerIds, ["bars-public"]);
        return [
          {
            id: "closed",
            layerId: "bars-public",
            title: "Zavřený bar",
            category: "food.bar",
            longitude: 14.42,
            latitude: 50.0802,
            rating: 5,
            openNow: false,
            tags: ["outdoor"],
            source: {
              sourceId: "osm:closed",
              label: "OpenStreetMap fixture",
              url: "https://www.openstreetmap.org/node/1"
            }
          },
          {
            id: "nearest",
            layerId: "bars-public",
            title: "Nejbližší bar",
            category: "food.bar",
            longitude: 14.42,
            latitude: 50.081,
            rating: 4.7,
            openNow: true,
            tags: ["outdoor"],
            source: {
              sourceId: "osm:nearest",
              label: "OpenStreetMap fixture",
              url: "https://www.openstreetmap.org/node/2"
            }
          },
          {
            id: "farther",
            layerId: "bars-public",
            title: "Druhý bar",
            category: "food.bar",
            longitude: 14.42,
            latitude: 50.083,
            rating: 4.9,
            openNow: true,
            tags: ["outdoor"],
            source: {
              sourceId: "osm:farther",
              label: "OpenStreetMap fixture",
              url: "https://www.openstreetmap.org/node/3"
            }
          }
        ];
      }
    },
    onTrace: (trace) => traces.push(trace)
  });
  const conversations = fixtureStore();
  const orchestrator = new ProviderNeutralAiOrchestrator(registry, conversations);

  const outcome = await orchestrator.run({
    ownerUserId: "user-1",
    conversation: { mode: "new", scope: { type: "global" } },
    prompt: "Najdi mi nejbližší bar.",
    promptDataClass: "public",
    actor: context.actor,
    projection: context.projection,
    mapContext: {
      reference: { source: "map-center", longitude: 14.42, latitude: 50.08 },
      activeLayerIds: ["bars-public"],
      activeFilters: { openNow: true, minRating: 4, tags: ["outdoor"] },
      radiusMeters: 1_000,
      limit: 3
    }
  });

  assert.equal(outcome.status, "succeeded");
  if (outcome.status !== "succeeded") return;
  assert.equal(outcome.answer.execution, "deterministic-tool");
  assert.equal(outcome.answer.toolName, "find_nearest_poi");
  assert.deepEqual(
    outcome.answer.results.map(({ id, distanceMeters, source }) => ({
      id,
      distanceMeters,
      sourceId: source.sourceId
    })),
    [
      { id: "nearest", distanceMeters: 111, sourceId: "osm:nearest" },
      { id: "farther", distanceMeters: 334, sourceId: "osm:farther" }
    ]
  );
  assert.match(outcome.answer.text, /Nejblíž je Nejbližší bar \(111 m\)/);
  assert.deepEqual(
    outcome.answer.citations.map(({ sourceId }) => sourceId),
    ["osm:nearest", "osm:farther"]
  );
  assert.equal(sourceCalls, 1);
  assert.equal(traces.length, 1);
  assert.equal(traces[0]?.toolName, "find_nearest_poi");
  assert.equal(traces[0]?.status, "succeeded");

  const stored = conversations.get("user-1", outcome.conversation.id);
  assert.deepEqual(
    stored.messages.map(({ role }) => role),
    ["user", "assistant"]
  );
  assert.deepEqual(stored.messages[1]?.toolNames, ["find_nearest_poi"]);
  assert.deepEqual(
    stored.messages[1]?.citations.map(({ sourceId }) => sourceId),
    ["osm:nearest", "osm:farther"]
  );
  const projected = conversations.projectForModel("user-1", stored.id, ["public"]);
  assert.ok(
    Buffer.byteLength(JSON.stringify(projected), "utf8") <= AI_CONVERSATION_MODEL_CONTEXT_BYTE_LIMIT
  );
});

test("orchestration does not dispatch unsupported or unauthorized text to the POI source", async () => {
  let sourceCalls = 0;
  const registry = createMapAiToolRegistry({
    handlers,
    nearestPoiSource: {
      async query() {
        sourceCalls += 1;
        return [];
      }
    }
  });
  const orchestrator = new ProviderNeutralAiOrchestrator(registry, fixtureStore());

  assert.deepEqual(
    await orchestrator.run({
      ownerUserId: "user-1",
      conversation: { mode: "new", scope: { type: "global" } },
      prompt: "Jaké je počasí?",
      promptDataClass: "public",
      actor: context.actor,
      projection: context.projection,
      mapContext: {
        reference: { source: "map-center", longitude: 14.42, latitude: 50.08 },
        activeLayerIds: ["bars-public"],
        activeFilters: {}
      }
    }),
    { status: "unsupported-intent" }
  );

  const denied = await orchestrator.run({
    ownerUserId: "user-1",
    conversation: { mode: "new", scope: { type: "global" } },
    prompt: "Najdi nejbližší bar.",
    promptDataClass: "public",
    actor: { ...context.actor, permissions: new Set<string>() },
    projection: context.projection,
    mapContext: {
      reference: { source: "map-center", longitude: 14.42, latitude: 50.08 },
      activeLayerIds: ["bars-public"],
      activeFilters: {}
    }
  });
  assert.equal(denied.status, "tool-failed");
  if (denied.status === "tool-failed") assert.equal(denied.toolStatus, "policy-denied");
  assert.equal(sourceCalls, 0);
});
