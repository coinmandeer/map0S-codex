import test from "node:test";
import assert from "node:assert/strict";

/** The store guards every browser API with `typeof window === "undefined"` except the event
 *  dispatches and localStorage writes in its setters, so a stub of those two is enough to
 *  exercise the state transitions in plain node. */
function installBrowserStub() {
  const storage = new Map<string, string>();
  const stub = {
    innerWidth: 1440,
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k)
    },
    location: { pathname: "/", search: "" },
    history: { replaceState: () => {} }
  };
  (globalThis as Record<string, unknown>).window = stub;
  (globalThis as Record<string, unknown>).localStorage = stub.localStorage;
  (globalThis as Record<string, unknown>).CustomEvent = class {
    constructor(
      public type: string,
      public init?: unknown
    ) {}
  };
  (globalThis as Record<string, unknown>).Event = class {
    constructor(public type: string) {}
  };
}

installBrowserStub();

const { getMapStore } = await import("./mapStore.js");
const store = getMapStore();

/** `useMapStoreSnapshot` reads through `useSyncExternalStore`, which decides whether to
 *  re-render by comparing snapshots with `Object.is`. Every one of these assertions is
 *  therefore a claim about the UI updating, not about object identity for its own sake:
 *  a mutated-in-place entry leaves both references equal and React skips the render.
 *  This regressed once already, on the weather variable pills. */
test("changing a layer filter replaces the activeLayers reference", () => {
  store.toggleLayer("weather");
  const before = store.activeLayers;

  store.setLayerFilters("weather", { variable: "wind" });
  const after = store.activeLayers;

  assert.notEqual(before, after, "activeLayers must be a new object");
  assert.equal(after.weather?.filters.variable, "wind");
});

test("the previous snapshot is left untouched", () => {
  const before = store.activeLayers;
  const beforeFilters = before.weather?.filters;

  store.setLayerFilters("weather", { variable: "temperature" });

  assert.equal(beforeFilters?.variable, "wind", "old snapshot must not be mutated");
  assert.equal(store.activeLayers.weather?.filters.variable, "temperature");
});

test("changing opacity replaces the reference too", () => {
  const before = store.activeLayers;
  const beforeOpacity = before.weather?.opacity;
  store.setLayerOpacity("weather", 0.42);

  assert.notEqual(before, store.activeLayers);
  assert.equal(store.activeLayers.weather?.opacity, 0.42);
  assert.equal(before.weather?.opacity, beforeOpacity, "old snapshot keeps its opacity");
});

test("a layer switched on starts from its plugin's defaults", () => {
  store.toggleLayer("weather");
  assert.equal(Object.hasOwn(store.activeLayers, "weather"), false, "precondition: weather is off");

  store.toggleLayer("weather");
  assert.equal(
    store.activeLayers.weather?.opacity,
    0.6,
    "weather is an overlay and must not start opaque"
  );
});

test("toggling a layer off replaces the reference and drops the entry", () => {
  const before = store.activeLayers;
  assert.ok(before.weather, "precondition: weather is on");

  store.toggleLayer("weather");

  assert.notEqual(before, store.activeLayers);
  assert.equal(store.activeLayers.weather, undefined);
  assert.ok(before.weather, "old snapshot still has the layer");
});

test("subscribers are notified on every layer change", () => {
  let calls = 0;
  const unsubscribe = store.subscribe(() => {
    calls += 1;
  });

  store.toggleLayer("osm-poi");
  store.setLayerOpacity("osm-poi", 0.5);
  store.setLayerFilters("osm-poi", { categories: ["castle"] });

  unsubscribe();
  assert.equal(calls, 3);
});
