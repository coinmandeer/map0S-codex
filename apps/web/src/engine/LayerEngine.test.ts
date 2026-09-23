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
import {
  registerLayer,
  registerLayerV2,
  unregisterLayer,
  resetLayerRegistry
} from "../layers/registry";
import { TaskRegistry } from "../tasks/TaskRegistry";
import { fetchLayerFeatures, LayerEngine, runBounded } from "./LayerEngine";
import { createDataLayer } from "../layers/dataLayer";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("restored partial filters retain defaults and explicit user overrides", async (t) => {
  resetLayerRegistry();
  const events = new EventTarget();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events)
    }
  });
  let received: unknown;
  registerLayer({
    kind: "pins",
    viewportCost: "cheap",
    manifest: {
      id: "default-test",
      name: "Defaults",
      icon: "x",
      color: "#000000",
      description: "Defaults",
      category: "user"
    },
    defaultFilters: { visualization: "wind", model: "best_match", valueLabels: true },
    create: () => ({
      async update(_bbox, filters) {
        received = filters;
        return collection("a");
      },
      setData() {},
      setVisible() {},
      setOpacity() {},
      detach() {}
    })
  });
  const store = {
    view: { zoom: 8 },
    activeLayers: {
      "default-test": { visible: true, opacity: 1, filters: { valueLabels: false } }
    },
    session: null,
    activeTag: null,
    countryCode: null,
    enabledPoiSources: [],
    setVisibleFeatures() {},
    setLayerLoading() {},
    setLayerNotice() {},
    setSearchHerePending() {},
    markSourcesLoading() {},
    applySourceMeta() {}
  } as unknown as MapStore;
  const engine = new LayerEngine({} as never, "/api", store, new TaskRegistry());
  t.after(() => engine.destroy());
  engine.refresh([13, 49, 15, 51], true);
  await waitFor(() => received !== undefined);
  assert.deepEqual(received, { visualization: "wind", model: "best_match", valueLabels: false });
});

test("legacy feature pages are joined before one accepted map commit", async (t) => {
  const urls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    urls.push(url);
    const second = url.includes("cursor=page2");
    return new Response(
      JSON.stringify({
        ...collection(second ? "b" : "a"),
        query: {
          status: second ? "complete" : "partial",
          truncated: !second,
          nextCursor: second ? null : "page2"
        }
      })
    );
  });
  const result = await fetchLayerFeatures("/api", "fixture", [0, 0, 1, 1], {});
  assert.deepEqual(
    result.features.map((f) => f.properties.id),
    ["a", "b"]
  );
  assert.equal(result.query?.status, "complete");
  assert.equal(urls.length, 2);
});

test("v2 pages are joined without dropping remaining features", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    const item = featureV1ToV2(collection(calls === 1 ? "a" : "b").features[0]!, {
      providerId: "fixture",
      attribution: "Fixture",
      retrievedAt: "2026-09-05T00:00:00.000Z"
    });
    return new Response(
      JSON.stringify({
        data: { type: "FeatureCollection", features: [item] },
        meta: {
          limit: 100,
          returned: 1,
          truncated: calls === 1,
          nextCursor: calls === 1 ? "page2" : null,
          cache: "miss",
          sources: []
        },
        notices: []
      })
    );
  });
  const result = await fetchLayerFeatures("/api", "fixture", [0, 0, 1, 1], {}, undefined, 2);
  assert.deepEqual(
    result.features.map((f) => f.properties.id),
    ["a", "b"]
  );
  assert.equal(result.query?.status, "complete");
  assert.equal(calls, 2);
});

test("real data handles commit only accepted responses and opacity does not fetch", async (t) => {
  const events = new EventTarget();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events)
    }
  });
  resetLayerRegistry();
  const writes: string[][] = [];
  const sources = new Map<string, unknown>();
  const layers = new Map<string, unknown>();
  const map = {
    getSource: (id: string) => sources.get(id),
    getLayer: (id: string) => layers.get(id),
    hasImage: () => true,
    addImage() {},
    removeImage() {},
    addSource: (id: string) =>
      sources.set(id, {
        setData: (data: FeatureCollection) => writes.push(data.features.map((f) => f.properties.id))
      }),
    addLayer: (layer: { id: string }) => layers.set(layer.id, layer),
    removeSource: (id: string) => sources.delete(id),
    removeLayer: (id: string) => layers.delete(id),
    setPaintProperty() {},
    setLayoutProperty() {}
  };
  const requests: Array<(response: Response) => void> = [];
  t.mock.method(
    globalThis,
    "fetch",
    () => new Promise<Response>((resolve) => requests.push(resolve))
  );
  registerLayer({
    kind: "pins",
    viewportCost: "cheap",
    manifest: {
      id: "real-data",
      name: "Real",
      icon: "t",
      color: "#000000",
      description: "Real factory",
      category: "user"
    },
    create: () => createDataLayer(map as never, "/api", "real-data", { color: "#000000" })
  });
  const activeLayers = { "real-data": { visible: true, opacity: 1, filters: {} } };
  const store = {
    activeLayers,
    session: null,
    activeTag: null,
    countryCode: null,
    enabledPoiSources: [],
    setVisibleFeatures() {},
    setLayerLoading() {},
    setLayerNotice() {},
    setSearchHerePending() {},
    markSourcesLoading() {},
    applySourceMeta() {}
  } as unknown as MapStore;
  const engine = new LayerEngine(map as never, "/api", store, new TaskRegistry());
  t.after(() => engine.destroy());
  engine.refresh([0, 0, 1, 1], true);
  await waitFor(() => requests.length === 1);
  engine.refresh([2, 2, 3, 3], true);
  await waitFor(() => requests.length === 2);
  requests[1]!(new Response(JSON.stringify(collection("current"))));
  await waitFor(() => writes.length === 1);
  requests[0]!(new Response(JSON.stringify(collection("obsolete"))));
  await wait(10);
  assert.deepEqual(writes, [["current"]]);
  activeLayers["real-data"].opacity = 0.4;
  engine.syncLayers(activeLayers);
  engine.refresh([2, 2, 3, 3]);
  await wait(300);
  assert.equal(requests.length, 2);
  assert.equal(writes.length, 1);
  engine.refresh([4, 4, 5, 5], true);
  await waitFor(() => requests.length === 3);
  activeLayers["real-data"].visible = false;
  engine.syncLayers(activeLayers);
  requests[2]!(new Response(JSON.stringify(collection("disabled"))));
  await wait(10);
  assert.equal(writes.length, 1);
  assert.equal(sources.size, 0);
});

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

test("a pin response rebuilds only its own source", async () => {
  resetLayerRegistry();
  const setDataCalls = new Map<string, number>();
  const activeLayers = {
    "pins-a": { visible: true, opacity: 1, filters: {} },
    "pins-b": { visible: true, opacity: 1, filters: {} }
  };
  for (const id of Object.keys(activeLayers)) {
    registerLayer({
      kind: "pins",
      viewportCost: "cheap",
      manifest: {
        id,
        name: id,
        icon: "place",
        color: "#000000",
        description: "Pin fixture",
        category: "community"
      },
      create: () => ({
        update: async () => collection(id),
        setData: () => setDataCalls.set(id, (setDataCalls.get(id) ?? 0) + 1),
        setVisible: () => {},
        setOpacity: () => {},
        detach: () => {}
      })
    });
  }
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
  const engine = new LayerEngine({} as never, "/api", store, new TaskRegistry());
  engine.syncLayers(activeLayers);
  engine.refresh([13, 49, 14, 50], true);
  await waitFor(() => setDataCalls.size === 2);
  assert.equal(setDataCalls.get("pins-a"), 1);
  assert.equal(setDataCalls.get("pins-b"), 1);
  engine.destroy();
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

for (const hiddenDuringReplacement of [false, true]) {
  test(`a replacement pin source cannot reuse old features (hidden: ${hiddenDuringReplacement})`, async (t) => {
    resetLayerRegistry();
    const writes: string[][] = [];
    let requests = 0;
    const register = (revision: string) =>
      registerLayer({
        kind: "pins",
        viewportCost: "cheap",
        manifest: {
          id: "source-change",
          name: "Source",
          icon: "t",
          color: "#000000",
          description: "Source replacement",
          category: "user"
        },
        create: () => ({
          update: async () => {
            requests++;
            return collection(revision);
          },
          setData: (data) => writes.push(data.features.map((feature) => feature.properties.id)),
          setVisible() {},
          setOpacity() {},
          detach() {}
        })
      });
    register("old-source");
    const activeLayers = { "source-change": { visible: true, opacity: 1, filters: {} } };
    const store = {
      activeLayers,
      session: null,
      activeTag: null,
      countryCode: null,
      enabledPoiSources: [],
      setVisibleFeatures() {},
      setLayerLoading() {},
      setLayerNotice() {},
      setSearchHerePending() {},
      markSourcesLoading() {},
      applySourceMeta() {}
    } as unknown as MapStore;
    const engine = new LayerEngine({} as never, "/api", store, new TaskRegistry());
    t.after(() => engine.destroy());
    engine.refresh([0, 0, 1, 1], true);
    await waitFor(() => writes.length === 1);
    if (hiddenDuringReplacement) {
      activeLayers["source-change"].visible = false;
      engine.syncLayers(activeLayers);
    }
    unregisterLayer("source-change");
    register("new-source");
    activeLayers["source-change"].visible = true;
    engine.syncLayers(activeLayers);
    engine.refresh([0, 0, 1, 1]);
    await waitFor(() => writes.length === 2);
    assert.equal(requests, 2);
    assert.deepEqual(writes, [["old-source"], ["new-source"]]);
  });
}

test("a replacement publication recreates an active renderer with the same layer ID", () => {
  resetLayerRegistry();
  let attached = 0,
    detached = 0;
  const register = () =>
    registerLayerV2({
      manifest: {
        schema: "mapos.layer-manifest",
        schemaVersion: "2.0.0",
        sdkRange: "^2.0.0",
        id: "theme-publication",
        name: "Publication",
        description: "Publication replacement fixture",
        capabilities: [],
        category: "statistics",
        geometryKinds: ["Polygon"],
        renderer: { type: "choropleth" },
        source: { type: "vector-tiles", tileTemplate: "https://example.test/{z}/{x}/{y}.pbf" },
        queryPolicy: { strategy: "tile" },
        attribution: [{ label: "Fixture" }]
      },
      create: () => {
        attached++;
        return {
          update: async () => null,
          setVisible() {},
          setOpacity() {},
          detach() {
            detached++;
          }
        };
      }
    });
  register();
  const activeLayers = { "theme-publication": { visible: true, opacity: 1, filters: {} } };
  const store = {
    activeLayers,
    session: null,
    setVisibleFeatures() {},
    setLayerNotice() {},
    setSearchHerePending() {},
    setLayerLoading() {}
  } as unknown as MapStore;
  const engine = new LayerEngine({} as never, "/api", store, new TaskRegistry());
  engine.syncLayers(activeLayers);
  assert.equal(attached, 1);
  unregisterLayer("theme-publication");
  register();
  engine.syncLayers(activeLayers);
  assert.equal(attached, 2);
  assert.equal(detached, 1);
  engine.destroy();
});

test("regional POIs neither load nor retry at continent zoom, then load after zooming in", async (t) => {
  resetLayerRegistry();
  const events = new EventTarget();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events)
    }
  });
  let requests = 0;
  registerLayer({
    kind: "pins",
    viewportCost: "cheap",
    minQueryZoom: 8,
    manifest: {
      id: "regional",
      name: "Regional",
      icon: "x",
      color: "#000000",
      description: "Regional POIs",
      category: "user"
    },
    create: () => ({
      async update() {
        requests++;
        return collection("nearby");
      },
      setData() {},
      setVisible() {},
      setOpacity() {},
      detach() {}
    })
  });
  const store = {
    view: { zoom: 4 },
    activeLayers: { regional: { visible: true, opacity: 1, filters: {} } },
    session: null,
    activeTag: null,
    countryCode: null,
    enabledPoiSources: [],
    setVisibleFeatures() {},
    setLayerLoading() {},
    setLayerNotice() {},
    setSearchHerePending() {},
    markSourcesLoading() {},
    applySourceMeta() {}
  } as unknown as MapStore;
  const engine = new LayerEngine({} as never, "/api", store, new TaskRegistry());
  t.after(() => engine.destroy());
  engine.refresh([0, 0, 30, 60], true);
  engine.refreshLayer("regional", [0, 0, 30, 60]);
  await wait(20);
  assert.equal(requests, 0);
  store.view.zoom = 9;
  engine.refresh([0, 0, 1, 1], true);
  await waitFor(() => requests === 1);
});

test("server-model raster follows viewport and reports samples rather than empty POIs", async () => {
  resetLayerRegistry();
  const { layerV1ToV2 } = await import("@mapos/layer-sdk");
  const { layerActivity } = await import("../tasks/layerActivity");
  const base = layerV1ToV2(
    {
      id: "model-test",
      name: "Model",
      icon: "m",
      color: "#123456",
      description: "Model",
      category: "environment"
    },
    { kind: "raster" }
  );
  let updates = 0;
  registerLayerV2({
    manifest: {
      ...base,
      source: { type: "server-adapter", adapterId: "model-grid" },
      queryPolicy: { strategy: "viewport", searchHere: "never", cacheTtlSeconds: 0 }
    },
    viewportCost: "cheap",
    create: () => ({
      async update() {
        updates++;
        return {
          type: "FeatureCollection",
          features: [],
          query: { status: "complete", cacheTtlMs: 0, rendered: { count: 12, unit: "samples" } }
        };
      },
      setVisible() {},
      setOpacity() {},
      detach() {}
    })
  });
  const activeLayers = { "model-test": { visible: true, opacity: 1, filters: {} } };
  const store = {
    view: { zoom: 8 },
    activeLayers,
    session: null,
    activeTag: null,
    countryCode: null,
    enabledPoiSources: [],
    setVisibleFeatures() {},
    setLayerLoading() {},
    setLayerNotice() {},
    setSearchHerePending() {},
    markSourcesLoading() {},
    applySourceMeta() {}
  } as unknown as MapStore;
  const engine = new LayerEngine({} as never, "/api", store, new TaskRegistry());
  engine.syncLayers(activeLayers);
  engine.refresh([1, 40, 2, 41], true);
  await waitFor(() => updates === 1);
  engine.refresh([3, 40, 4, 41], true);
  await waitFor(() => updates === 2);
  await waitFor(() => layerActivity.get("model-test")?.phase === "ready");
  assert.equal(layerActivity.get("model-test")?.count, 12);
  assert.equal(layerActivity.get("model-test")?.unit, "samples");
  engine.destroy();
});
