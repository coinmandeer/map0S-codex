import assert from "node:assert/strict";
import { test } from "node:test";
import {
  featureV1ToV2,
  type Bbox,
  type FeatureCollection,
  type GeoFeature
} from "@mapos/layer-sdk";
import type { MapStore } from "../store/mapStore";
import { emit } from "../lib/events";
import { registerLayer, registerLayerV2, resetLayerRegistry } from "../layers/registry";
import { TaskRegistry } from "../tasks/TaskRegistry";
import { fetchLayerFeatures, LayerEngine, runBounded } from "./LayerEngine";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate: () => boolean, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for LayerEngine");
    await wait(10);
  }
}

function collection(id: string): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [14, 50] },
        properties: { id, name: id, layerId: "session-test" }
      }
    ]
  };
}

test("an identity change clears private data and rejects the previous session's late response", async () => {
  const browserEvents = new EventTarget();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      addEventListener: browserEvents.addEventListener.bind(browserEvents),
      removeEventListener: browserEvents.removeEventListener.bind(browserEvents),
      dispatchEvent: browserEvents.dispatchEvent.bind(browserEvents)
    }
  });
  Object.defineProperty(globalThis, "CustomEvent", {
    configurable: true,
    value: class<T> extends Event {
      detail: T;

      constructor(type: string, init?: CustomEventInit<T>) {
        super(type);
        this.detail = init?.detail as T;
      }
    }
  });

  resetLayerRegistry();
  const requests: Array<{
    signal?: AbortSignal;
    resolve: (value: FeatureCollection) => void;
  }> = [];
  const rendered: string[][] = [];

  registerLayer({
    kind: "pins",
    viewportCost: "cheap",
    manifest: {
      id: "session-test",
      name: "Session test",
      icon: "t",
      color: "#000000",
      description: "Session isolation fixture",
      category: "user"
    },
    create: () => ({
      update: (_bbox, _filters, signal) =>
        new Promise<FeatureCollection>((resolve) => requests.push({ signal, resolve })),
      setData: (data) => rendered.push(data.features.map((feature) => feature.properties.id)),
      setVisible: () => {},
      setOpacity: () => {},
      detach: () => {}
    })
  });

  let userId = "user-a";
  const activeLayers = {
    "session-test": { visible: true, opacity: 1, filters: { privateQuery: "secret-filter" } }
  };
  const loading = new Map<string, boolean>();
  const visible = new Map<string, GeoFeature[]>();
  const store = {
    get session() {
      return { id: userId };
    },
    activeLayers,
    activeTag: null,
    countryCode: null,
    enabledPoiSources: [],
    setVisibleFeatures: (layerId: string, features: GeoFeature[]) => visible.set(layerId, features),
    setLayerLoading: (layerId: string, value: boolean) => loading.set(layerId, value),
    setLayerNotice: () => {},
    setSearchHerePending: () => {},
    markSourcesLoading: () => {},
    applySourceMeta: () => {}
  } as unknown as MapStore;

  let taskSequence = 0;
  const tasks = new TaskRegistry({ id: (type) => `task:${type}:${++taskSequence}` });
  const engine = new LayerEngine({} as never, "/api", store, tasks);
  engine.syncLayers(activeLayers);
  const bbox: Bbox = [13.9, 49.9, 14.1, 50.1];
  engine.refresh(bbox, true);
  await waitFor(() => requests.length === 1);
  assert.equal(requests.length, 1, "session A starts one layer request");
  const sessionATask = tasks.active()[0]!;
  assert.equal(sessionATask.type, "layer-query");
  assert.equal(sessionATask.layerId, "session-test");
  assert.equal(sessionATask.requestKey, null);
  const taskSnapshot = JSON.stringify(tasks.snapshot());
  assert.doesNotMatch(taskSnapshot, /user-a|13\.9|49\.9|14\.1|50\.1|secret-filter/);

  userId = "user-b";
  emit("session-changed", { userId, xpTotal: 0 });
  assert.equal(requests[0]!.signal?.aborted, true, "the old request is aborted at the boundary");
  assert.equal(tasks.get(sessionATask.id)?.status, "stale");
  assert.deepEqual(rendered.at(-1), [], "session A's rendered collection is removed immediately");
  assert.equal(requests.length, 2, "visible layers reload for session B without a map move");

  // Simulate a handle that ignores AbortSignal and completes after the user changed.
  requests[0]!.resolve(collection("secret-from-a"));
  await wait(0);
  assert.ok(
    rendered.every((ids) => !ids.includes("secret-from-a")),
    "a late response from session A is never rendered"
  );
  assert.equal(loading.get("session-test"), true, "the old request cannot clear B's loading state");

  requests[1]!.resolve(collection("place-for-b"));
  await wait(0);
  assert.deepEqual(rendered.at(-1), ["place-for-b"]);
  assert.deepEqual(
    visible.get("session-test")?.map((feature) => feature.properties.id),
    ["place-for-b"]
  );
  assert.equal(loading.get("session-test"), false);
  assert.equal(tasks.snapshot().find((task) => task.id !== sessionATask.id)?.status, "succeeded");

  engine.destroy();
});

test("the layer scheduler never exceeds its bounded concurrency", async () => {
  let active = 0;
  let peak = 0;
  const completed: number[] = [];
  const releases: Array<() => void> = [];
  const jobs = Array.from({ length: 10 }, (_, index) => async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise<void>((resolve) => releases.push(resolve));
    completed.push(index);
    active--;
  });

  const running = runBounded(jobs, 4);
  await waitFor(() => releases.length === 4);
  assert.equal(peak, 4);
  while (completed.length < jobs.length) {
    const release = releases.shift();
    release?.();
    await wait(0);
  }
  await running;
  assert.equal(completed.length, 10);
  assert.ok(peak <= 4);
});

test("a newer request replaces the previous visible failure for the same layer", async () => {
  resetLayerRegistry();
  let updates = 0;
  registerLayer({
    kind: "pins",
    viewportCost: "cheap",
    manifest: {
      id: "failure-test",
      name: "Failure test",
      icon: "t",
      color: "#000000",
      description: "Repeated failure fixture",
      category: "community"
    },
    create: () => ({
      update: async () => {
        updates += 1;
        throw new Error("fixture outage");
      },
      setVisible: () => {},
      setOpacity: () => {},
      detach: () => {}
    })
  });

  const activeLayers = { "failure-test": { visible: true, opacity: 1, filters: {} } };
  const store = {
    session: null,
    activeLayers,
    activeTag: null,
    countryCode: null,
    enabledPoiSources: [],
    setVisibleFeatures: () => {},
    setLayerLoading: () => {},
    setLayerNotice: () => {},
    setSearchHerePending: () => {},
    markSourcesLoading: () => {},
    applySourceMeta: () => {}
  } as unknown as MapStore;
  let sequence = 0;
  const tasks = new TaskRegistry({ id: (type) => `task:${type}:${++sequence}` });
  const engine = new LayerEngine({} as never, "/api", store, tasks);
  engine.syncLayers(activeLayers);

  const bbox: Bbox = [13.9, 49.9, 14.1, 50.1];
  engine.refresh(bbox, true);
  await waitFor(() => updates === 1 && tasks.snapshot().some((task) => task.status === "failed"));
  assert.equal(
    tasks.snapshot().filter((task) => task.layerId === "failure-test" && task.status === "failed")
      .length,
    1
  );

  engine.refresh(bbox, true);
  await waitFor(() => updates === 2);
  await waitFor(
    () =>
      tasks.snapshot().filter((task) => task.layerId === "failure-test" && task.status === "failed")
        .length === 1
  );
  assert.equal(
    tasks.snapshot().filter((task) => task.layerId === "failure-test" && task.status === "failed")
      .length,
    1,
    "the obsolete failure is dismissed when the replacement starts"
  );

  engine.destroy();
});

test("a global layer reuses its session-scoped collection across map moves", async () => {
  resetLayerRegistry();
  let updates = 0;
  registerLayerV2({
    manifest: {
      schema: "mapos.layer-manifest",
      schemaVersion: "2.0.0",
      sdkRange: "^2.0.0",
      id: "global-test",
      name: "Global test",
      description: "Test collection",
      category: "user",
      geometryKinds: ["Point"],
      renderer: { type: "symbols" },
      source: { type: "user-data" },
      queryPolicy: { strategy: "global", maxResultsPerViewport: 100 },
      attribution: [{ label: "Fixture" }],
      capabilities: ["query"]
    },
    viewportCost: "cheap",
    create: () => ({
      update: async () => {
        updates += 1;
        return collection(`global-${updates}`);
      },
      setData: () => {},
      setVisible: () => {},
      setOpacity: () => {},
      detach: () => {}
    })
  });

  const activeLayers = { "global-test": { visible: true, opacity: 1, filters: {} } };
  const store = {
    session: { id: "user-global" },
    activeLayers,
    activeTag: null,
    countryCode: null,
    enabledPoiSources: [],
    setVisibleFeatures: () => {},
    setLayerLoading: () => {},
    setLayerNotice: () => {},
    setSearchHerePending: () => {},
    markSourcesLoading: () => {},
    applySourceMeta: () => {}
  } as unknown as MapStore;
  const engine = new LayerEngine({} as never, "/api", store, new TaskRegistry());
  engine.syncLayers(activeLayers);

  engine.refresh([13, 49, 14, 50], false);
  await waitFor(() => updates === 1);
  await wait(0);
  engine.refresh([17, 48, 18, 49], false);
  await wait(350);
  assert.equal(updates, 1, "a pan does not reload a viewport-independent private collection");

  engine.refresh([17, 48, 18, 49], true);
  await waitFor(() => updates === 2);
  engine.destroy();
});

test("the v2 web client requests the capped endpoint and adapts its envelope for the renderer", async () => {
  const legacy = collection("quake-1").features[0]!;
  legacy.properties.layerId = "earthquakes";
  legacy.properties.category = "earthquake";
  legacy.properties.magnitude = 3.2;
  const v2 = featureV1ToV2(legacy, {
    providerId: "usgs",
    attribution: "USGS",
    retrievedAt: "2026-09-01T08:00:00.000Z",
    rights: "open",
    kind: "event"
  });
  const previousFetch = globalThis.fetch;
  let requestedUrl = "";
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(
      JSON.stringify({
        data: { type: "FeatureCollection", features: [v2] },
        meta: {
          limit: 100,
          returned: 1,
          truncated: false,
          nextCursor: null,
          cache: "miss",
          sources: [{ providerId: "usgs", state: "ready" }]
        },
        notices: []
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    const result = await fetchLayerFeatures(
      "/api",
      "earthquakes",
      [14, 49, 15, 51],
      { days: 30 },
      undefined,
      2
    );
    assert.match(requestedUrl, /^\/api\/v2\/layers\/earthquakes\/features\?/);
    assert.match(requestedUrl, /limit=100/);
    assert.equal(result.features[0]?.properties.id, "quake-1");
    assert.equal(result.features[0]?.properties.magnitude, 3.2);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
