import assert from "node:assert/strict";
import test from "node:test";
import {
  MAP_AI_TOOL_NAMES,
  createMapAiToolRegistry,
  type AiNearestPoiRecord,
  type MapAiToolHandler,
  type MapAiToolHandlers,
  type MapAiToolName
} from "./toolCatalog.js";
import type { AiToolContext, AiToolDomain, AiToolTrace } from "./toolRegistry.js";

const permissions = new Set([
  "map:read",
  "layers:read",
  "layers:draft",
  "saved-places:read",
  "poi:read",
  "route:read",
  "weather:read",
  "events:read",
  "web:read",
  "plans:draft"
]);

const allowedContext: AiToolContext = {
  actor: {
    authenticated: true,
    userId: "user-1",
    permissions,
    entitlementIds: new Set(["events-pro"])
  },
  projection: {
    allowedLayerIds: new Set(["public-poi", "events-public"]),
    allowedPlanIds: new Set(["plan-1"]),
    allowedFeatureFieldsByLayer: new Map([["public-poi", new Set(["title", "rating", "openNow"])]]),
    allowedDataClasses: new Set(["public", "account-private"]),
    allowPreciseLocation: true
  }
};

const source = (sourceId: string, label = "Fixture source") => ({
  sourceId,
  label,
  url: `https://fixture.test/${encodeURIComponent(sourceId)}`,
  providerId: "fixture",
  retrievedAt: "2026-09-01T10:00:00.000Z"
});

const inputs: Record<MapAiToolName, Record<string, unknown>> = {
  get_current_map_context: {},
  list_available_layers: {},
  query_layer: {
    layerId: "public-poi",
    bbox: [14.3, 50, 14.6, 50.2],
    filters: { openNow: true, minRating: 4, tags: ["outdoor"] },
    limit: 10
  },
  search_places: {
    query: "kemp",
    categories: ["stay.camp_site"],
    near: { longitude: 14.42, latitude: 50.08 },
    radiusMeters: 10_000,
    limit: 10
  },
  set_layer_selection_draft: { layerIds: ["public-poi"] },
  query_saved_places: { query: "hrad", limit: 5 },
  get_feature_detail: {
    layerId: "public-poi",
    featureId: "poi-1",
    fields: ["title", "rating"]
  },
  find_nearest_poi: {
    reference: {
      source: "map-center",
      longitude: 14.42,
      latitude: 50.08
    },
    layerIds: ["public-poi"],
    category: "food.bar",
    activeFilters: { openNow: true, minRating: 4, tags: ["outdoor"] },
    radiusMeters: 1_000,
    limit: 5
  },
  route_segment: {
    from: { longitude: 14.42, latitude: 50.08 },
    to: { longitude: 14.5, latitude: 50.1 },
    profile: "car"
  },
  get_weather: {
    point: { longitude: 14.42, latitude: 50.08 },
    at: "2026-09-01T12:00:00.000Z"
  },
  search_events: {
    layerIds: ["events-public"],
    bbox: [14.3, 50, 14.6, 50.2],
    from: "2026-09-01T00:00:00.000Z",
    to: "2026-09-02T00:00:00.000Z",
    limit: 10
  },
  web_search: { query: "festivaly Plzeň září 2026", maxResults: 3 },
  web_fetch: { url: "https://fixture.test/festivaly" },
  create_plan_draft: {
    planId: "plan-1",
    goal: "Přidej dvě zdrojované zastávky.",
    sourceIds: ["osm:near"]
  }
};

function fixtureHandlers(onCall: (name: string) => void = () => undefined): MapAiToolHandlers {
  const handler =
    (name: keyof MapAiToolHandlers, output: unknown): MapAiToolHandler =>
    async () => {
      onCall(name);
      return structuredClone(output);
    };
  return {
    get_current_map_context: handler("get_current_map_context", {
      center: { longitude: 14.42, latitude: 50.08 },
      zoom: 13,
      activeLayerIds: ["public-poi", "private-other"]
    }),
    list_available_layers: handler("list_available_layers", {
      layers: [
        {
          layerId: "public-poi",
          name: "Veřejná místa",
          categories: ["food.bar"],
          access: "public"
        },
        {
          layerId: "private-other",
          name: "Cizí soukromá místa",
          categories: ["secret"],
          access: "owner"
        }
      ]
    }),
    query_layer: handler("query_layer", {
      features: [
        {
          id: "poi-1",
          layerId: "public-poi",
          title: "Povolené místo",
          longitude: 14.42,
          latitude: 50.081,
          sourceId: "osm:near"
        },
        {
          id: "hidden-1",
          layerId: "private-other",
          title: "Cizí místo",
          longitude: 14.43,
          latitude: 50.082,
          sourceId: "private:hidden"
        }
      ],
      sources: [source("osm:near"), source("private:hidden")]
    }),
    search_places: handler("search_places", {
      places: [
        {
          id: "camp-1",
          layerId: "public-poi",
          title: "Kemp U Řeky",
          category: "stay.camp_site",
          longitude: 14.42,
          latitude: 50.081,
          distanceMeters: 120,
          sourceId: "osm:near"
        },
        {
          id: "camp-hidden",
          layerId: "private-other",
          title: "Cizí kemp",
          category: "stay.camp_site",
          longitude: 14.43,
          latitude: 50.082,
          sourceId: "private:hidden"
        }
      ],
      sources: [source("osm:near"), source("private:hidden")]
    }),
    set_layer_selection_draft: handler("set_layer_selection_draft", {
      draftId: "layers-draft-1",
      layerIds: ["public-poi", "private-other"]
    }),
    query_saved_places: handler("query_saved_places", {
      places: [{ id: "saved-1", title: "Můj hrad", longitude: 14.4, latitude: 50.1 }]
    }),
    get_feature_detail: handler("get_feature_detail", {
      feature: {
        id: "poi-1",
        layerId: "public-poi",
        fields: { title: "Povolené místo", rating: 4.8, privateNote: "nesmí ven" }
      },
      sources: [source("osm:near")]
    }),
    route_segment: handler("route_segment", {
      distanceMeters: 8_100,
      durationSeconds: 900,
      geometry: [
        { longitude: 14.42, latitude: 50.08 },
        { longitude: 14.5, latitude: 50.1 }
      ],
      source: source("route:fixture")
    }),
    get_weather: handler("get_weather", {
      at: "2026-09-01T12:00:00.000Z",
      summary: "Jasno",
      temperatureC: 23,
      source: source("weather:fixture")
    }),
    search_events: handler("search_events", {
      events: [
        {
          id: "event-1",
          layerId: "events-public",
          title: "Koncert",
          startsAt: "2026-09-01T18:00:00.000Z",
          sourceId: "events:fixture"
        },
        {
          id: "event-hidden",
          layerId: "private-other",
          title: "Soukromá akce",
          startsAt: "2026-09-01T19:00:00.000Z",
          sourceId: "events:hidden"
        }
      ],
      sources: [source("events:fixture"), source("events:hidden")]
    }),
    web_search: handler("web_search", {
      results: [
        {
          title: "Festivaly v Plzni",
          url: "https://fixture.test/festivaly",
          excerpt: "Přehled festivalů na září."
        }
      ]
    }),
    web_fetch: handler("web_fetch", {
      url: "https://fixture.test/festivaly",
      title: "Festivaly v Plzni",
      text: "Program festivalu začíná 12. září."
    }),
    create_plan_draft: handler("create_plan_draft", {
      draftId: "plan-draft-1",
      planId: "plan-1",
      summary: "Dvě zastávky připravené k potvrzení.",
      sourceIds: ["osm:near"]
    })
  };
}

function nearestRecords(): AiNearestPoiRecord[] {
  return [
    {
      id: "far",
      layerId: "public-poi",
      title: "Vzdálenější bar",
      category: "food.bar",
      longitude: 14.42,
      latitude: 50.083,
      rating: 4.9,
      openNow: true,
      tags: ["outdoor"],
      source: source("osm:far")
    },
    {
      id: "near",
      layerId: "public-poi",
      title: "Nejbližší bar",
      category: "food.bar",
      longitude: 14.42,
      latitude: 50.081,
      rating: 4.5,
      openNow: true,
      tags: ["outdoor", "food"],
      source: source("osm:near")
    },
    {
      id: "closed",
      layerId: "public-poi",
      title: "Zavřený bar",
      category: "food.bar",
      longitude: 14.42,
      latitude: 50.0805,
      rating: 5,
      openNow: false,
      tags: ["outdoor"],
      source: source("osm:closed")
    },
    {
      id: "wrong-layer",
      layerId: "private-other",
      title: "Cizí bar",
      category: "food.bar",
      longitude: 14.42,
      latitude: 50.0801,
      rating: 5,
      openNow: true,
      tags: ["outdoor"],
      source: source("private:bar")
    },
    {
      id: "wrong-category",
      layerId: "public-poi",
      title: "Kavárna",
      category: "food.cafe",
      longitude: 14.42,
      latitude: 50.0802,
      rating: 5,
      openNow: true,
      tags: ["outdoor"],
      source: source("osm:cafe")
    }
  ];
}

function fixtureRegistry(
  options: { traces?: AiToolTrace[]; onCall?: (name: string) => void } = {}
) {
  let nearestCalls = 0;
  const registry = createMapAiToolRegistry({
    handlers: fixtureHandlers(options.onCall),
    nearestPoiSource: {
      async query() {
        nearestCalls += 1;
        return nearestRecords();
      }
    },
    ...(options.traces ? { onTrace: (trace) => options.traces!.push(trace) } : {})
  });
  return { registry, nearestCalls: () => nearestCalls };
}

test("all eight source-grounded domains have complete audited contracts", () => {
  const { registry } = fixtureRegistry();
  const descriptors = registry.describe();
  assert.deepEqual(descriptors.map(({ name }) => name).sort(), [...MAP_AI_TOOL_NAMES].sort());
  assert.deepEqual(
    [...new Set(descriptors.map(({ domain }) => domain))].sort(),
    (
      [
        "map",
        "layers",
        "poi",
        "route",
        "weather",
        "events",
        "web",
        "plans"
      ] satisfies AiToolDomain[]
    ).sort()
  );
  for (const descriptor of descriptors) {
    assert.equal(descriptor.inputSchema.type, "object", descriptor.name);
    assert.equal(descriptor.outputSchema.type, "object", descriptor.name);
    assert.ok(descriptor.permissionPolicy.id, descriptor.name);
    assert.ok(descriptor.permissionPolicy.requiredPermissions.length > 0, descriptor.name);
    assert.ok(descriptor.projectionPolicy.dataClasses.length > 0, descriptor.name);
    assert.ok(descriptor.projectionPolicy.outputFields.length > 0, descriptor.name);
    assert.ok(descriptor.timeoutMs > 0 && descriptor.timeoutMs <= 10_000, descriptor.name);
    assert.ok(descriptor.maxResponseBytes > 0, descriptor.name);
    assert.ok(descriptor.quotaCost >= 0, descriptor.name);
    assert.match(descriptor.auditPolicy.eventType, /^ai\.tool\./, descriptor.name);
    assert.ok(
      descriptor.auditPolicy.redactInputPaths.length +
        descriptor.auditPolicy.redactOutputPaths.length >
        0,
      descriptor.name
    );
  }
  assert.deepEqual(
    descriptors.filter(({ effect }) => effect === "draft").map(({ name }) => name),
    ["create_plan_draft", "set_layer_selection_draft"]
  );
});

test("every registered tool passes its deterministic fixture contract", async (t) => {
  const traces: AiToolTrace[] = [];
  const calls: string[] = [];
  const { registry } = fixtureRegistry({ traces, onCall: (name) => calls.push(name) });
  for (const name of MAP_AI_TOOL_NAMES) {
    await t.test(name, async () => {
      const outcome = await registry.invoke(name, inputs[name], allowedContext);
      assert.equal(outcome.status, "succeeded");
      if (outcome.status === "succeeded") {
        assert.ok(JSON.stringify(outcome.value).length > 2);
      }
    });
  }
  assert.equal(traces.length, MAP_AI_TOOL_NAMES.length);
  assert.ok(traces.every((trace) => trace.redacted && trace.status === "succeeded"));
  assert.deepEqual(
    calls.sort(),
    MAP_AI_TOOL_NAMES.filter((name) => name !== "find_nearest_poi").sort()
  );
});

test("registry rechecks permissions and projection before any backend handler", async () => {
  let calls = 0;
  const { registry, nearestCalls } = fixtureRegistry({ onCall: () => (calls += 1) });
  for (const descriptor of registry.describe()) {
    const deniedPermissions = new Set(permissions);
    deniedPermissions.delete(descriptor.permissionPolicy.requiredPermissions[0]!);
    const outcome = await registry.invoke(
      descriptor.name,
      inputs[descriptor.name as MapAiToolName],
      {
        ...allowedContext,
        actor: { ...allowedContext.actor, permissions: deniedPermissions }
      }
    );
    assert.equal(outcome.status, "policy-denied", descriptor.name);
  }
  assert.equal(calls, 0);
  assert.equal(nearestCalls(), 0);

  assert.equal(
    (
      await registry.invoke(
        "query_layer",
        { ...inputs.query_layer, layerId: "private-other" },
        allowedContext
      )
    ).status,
    "policy-denied"
  );
  assert.equal(
    (
      await registry.invoke(
        "get_feature_detail",
        {
          ...inputs.get_feature_detail,
          fields: ["title", "privateNote"]
        },
        allowedContext
      )
    ).status,
    "policy-denied"
  );
  assert.equal(calls, 0);

  assert.equal(
    (
      await registry.invoke("query_saved_places", inputs.query_saved_places, {
        ...allowedContext,
        actor: { ...allowedContext.actor, userId: "" }
      })
    ).status,
    "policy-denied"
  );
  assert.equal(calls, 0);
});

test("delegated results are projected again before output validation", async () => {
  const { registry } = fixtureRegistry();
  const map = await registry.invoke<Record<string, unknown>>(
    "get_current_map_context",
    inputs.get_current_map_context,
    allowedContext
  );
  assert.equal(map.status, "succeeded");
  if (map.status === "succeeded") {
    assert.deepEqual(map.value.activeLayerIds, ["public-poi"]);
  }

  const layers = await registry.invoke<{ layers: Array<{ layerId: string }> }>(
    "list_available_layers",
    inputs.list_available_layers,
    allowedContext
  );
  assert.equal(layers.status, "succeeded");
  if (layers.status === "succeeded") {
    assert.deepEqual(
      layers.value.layers.map(({ layerId }) => layerId),
      ["public-poi"]
    );
  }

  const queried = await registry.invoke<{
    features: Array<{ id: string }>;
    sources: Array<{ sourceId: string }>;
  }>("query_layer", inputs.query_layer, allowedContext);
  assert.equal(queried.status, "succeeded");
  if (queried.status === "succeeded") {
    assert.deepEqual(
      queried.value.features.map(({ id }) => id),
      ["poi-1"]
    );
    assert.deepEqual(
      queried.value.sources.map(({ sourceId }) => sourceId),
      ["osm:near"]
    );
  }

  const detail = await registry.invoke<{
    feature: { fields: Record<string, unknown> };
  }>("get_feature_detail", inputs.get_feature_detail, allowedContext);
  assert.equal(detail.status, "succeeded");
  if (detail.status === "succeeded") {
    assert.deepEqual(detail.value.feature.fields, { title: "Povolené místo", rating: 4.8 });
  }
});

test("nearest POI is authorized, actively filtered, sourced and deterministically ordered", async () => {
  const { registry, nearestCalls } = fixtureRegistry();
  const outcome = await registry.invoke<{
    results: Array<{ id: string; distanceMeters: number; source: { sourceId: string } }>;
  }>("find_nearest_poi", inputs.find_nearest_poi, allowedContext);
  assert.equal(outcome.status, "succeeded");
  if (outcome.status !== "succeeded") return;
  assert.deepEqual(
    outcome.value.results.map(({ id, distanceMeters, source: citation }) => ({
      id,
      distanceMeters,
      sourceId: citation.sourceId
    })),
    [
      { id: "near", distanceMeters: 111, sourceId: "osm:near" },
      { id: "far", distanceMeters: 334, sourceId: "osm:far" }
    ]
  );
  assert.equal(nearestCalls(), 1);

  const geolocation = {
    ...inputs.find_nearest_poi,
    reference: {
      ...(inputs.find_nearest_poi.reference as Record<string, unknown>),
      source: "geolocation"
    }
  };
  assert.equal(
    (
      await registry.invoke("find_nearest_poi", geolocation, {
        ...allowedContext,
        projection: { ...allowedContext.projection, allowPreciseLocation: false }
      })
    ).status,
    "policy-denied"
  );
  assert.equal(nearestCalls(), 1);
});

test("schemas reject unknown input and audit traces redact raw private values", async () => {
  const traces: AiToolTrace[] = [];
  const { registry } = fixtureRegistry({ traces });
  assert.equal(
    (
      await registry.invoke(
        "query_saved_places",
        { query: "TOP-SECRET-SEARCH", limit: 2, unexpected: true },
        allowedContext
      )
    ).status,
    "invalid-input"
  );
  assert.doesNotMatch(JSON.stringify(traces), /TOP-SECRET-SEARCH|user-1|saved-places:read/);
  assert.equal(traces[0]?.redacted, true);

  const inheritedRequiredFields = Object.create({ query: "zděděné tajemství", limit: 2 });
  assert.equal(
    (await registry.invoke("query_saved_places", inheritedRequiredFields, allowedContext)).status,
    "invalid-input"
  );
});
