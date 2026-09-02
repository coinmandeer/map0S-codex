import test from "node:test";
import assert from "node:assert/strict";
import type { TripPlan } from "@mapos/layer-sdk";

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

const { getMapStore, parseUrlState } = await import("./mapStore.js");
const store = getMapStore();

test("legacy deep links resolve to canonical modes and preserve weather intent", () => {
  assert.equal(parseUrlState("?mode=mine").modeResolution.mode, "personal");
  assert.deepEqual(parseUrlState("?mode=weather").modeResolution, {
    mode: "discover",
    activateLayerId: "weather",
    source: "legacy",
    rewriteUrl: true
  });
  assert.equal(parseUrlState("?mode=poi").modeResolution.mode, "planning");
});

test("first run starts at a privacy-safe Europe overview, not an invented exact position", () => {
  assert.deepEqual(parseUrlState("").view, { lng: 10.2, lat: 51, zoom: 4 });
});

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

test("changing mode keeps passive overlays but detaches the game when it is left", () => {
  if (!store.activeLayers.weather) store.toggleLayer("weather");
  store.setMode("game");

  assert.ok(store.activeLayers.weather, "an existing overlay survives navigation");
  assert.ok(store.activeLayers.game, "the new mode activates its primary layer");

  store.setMode("planning");
  assert.ok(store.activeLayers.weather, "passive overlays still survive navigation");
  assert.equal(store.activeLayers.game, undefined, "the expensive game scene must be detached");
});

test("game uses the standard left context and it can still be closed for the full board", () => {
  store.setSidebarOpen(false);
  store.setMode("game");
  assert.equal(store.sidebarOpen, true, "game information belongs to the shared left context");
  store.setSidebarOpen(false);
  assert.equal(store.sidebarOpen, false, "the player can expose the full game board explicitly");

  store.setMode("discover");
  assert.equal(store.sidebarOpen, true, "discover still owns the regional navigation panel");
});

test("legacy mode transitions leave only canonical mode state", () => {
  store.setMode("mine");
  assert.equal(store.mode, "personal");
  assert.ok(
    store.activeLayers["my-saved-places"],
    "Personal activates the global saved-places layer"
  );

  store.setMode("weather");
  assert.equal(store.mode, "discover");
  assert.ok(store.activeLayers.weather, "the legacy Weather route becomes an additive layer");
});

/** Auto-login greets the guest on startup; whatever the user does in the next three seconds used
 *  to have its toast wiped by that greeting's expiry. */
test("a later toast keeps its own countdown instead of inheriting the earlier one's", async () => {
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  store.showToast("Vítej", 60);
  await wait(30);
  store.showToast("Filtr #gastro", 400);

  await wait(60); // The greeting's dismissal would land in here.
  assert.equal(store.toast, "Filtr #gastro", "the older countdown must not clear a newer message");
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

test("legacy active plans are mirrored into canonical PlanDocument v2 storage", () => {
  const legacy: TripPlan = {
    id: "legacy-active",
    name: "Legacy active plan",
    departureAt: "2026-09-01T08:00:00.000Z",
    variant: "fast",
    stops: [
      { id: "a", name: "A", lng: 14, lat: 50, dwellMinutes: 0 },
      { id: "b", name: "B", lng: 15, lat: 49, dwellMinutes: 0 }
    ],
    vehicle: { profile: "car" },
    visibility: "private"
  };
  store.setActivePlan(legacy);
  assert.equal(store.activePlanDocument?.schema, "mapos.plan");
  assert.equal(store.activePlanDocument?.segments.length, 1);
  assert.ok(window.localStorage.getItem("mapos:active-plan-v2"));

  const canonical = structuredClone(store.activePlanDocument!);
  canonical.name = "Canonical name";
  canonical.revision = 4;
  store.setActivePlanDocument(canonical);
  assert.equal(store.activePlan?.name, "Canonical name");
  assert.equal(store.activePlanDocument?.revision, 4);
});
