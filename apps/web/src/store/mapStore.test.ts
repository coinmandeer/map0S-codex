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
    history: {
      replaceState: (_state: unknown, _title: string, url: string) => {
        stub.location.search = new URL(url, "http://localhost").search;
      }
    }
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
    activateLayerId: "weather-radar",
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

test("a layer switched on starts from its plugin's defaults, and keeps the user's own values after", () => {
  const { "weather-radar": _removed, ...rest } = store.activeLayers;
  store.restoreAppearance({
    layers: rest,
    basemapId: store.state.basemapId,
    basemapLabels: store.state.basemapLabels,
    buildings3d: store.state.buildings3d,
    terrain3d: store.state.terrain3d,
    poiSources: store.state.poiSources
  });
  store.activateLayer("weather-radar");
  assert.equal(
    store.activeLayers["weather-radar"]?.opacity,
    0.7,
    "weather is an overlay and must not start opaque"
  );
  store.setLayerOpacity("weather-radar", 0.42);
  store.toggleLayer("weather-radar");
  store.toggleLayer("weather-radar");
  assert.equal(
    store.activeLayers["weather-radar"]?.opacity,
    0.42,
    "the user's own opacity survives toggling off and on"
  );
});

test("toggling a layer off replaces the reference and drops the entry", () => {
  const before = store.activeLayers;
  assert.ok(before.weather?.visible, "precondition: weather is on");

  store.toggleLayer("weather");

  assert.notEqual(before, store.activeLayers);
  assert.equal(store.activeLayers.weather?.visible, false, "the layer is off");
  assert.ok(store.activeLayers.weather, "the entry survives so its filters and selection do");
  assert.ok(before.weather?.visible, "old snapshot still has the layer");
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

test("game starts on the full board and the game panel opens on demand", () => {
  store.setMode("game");
  assert.equal(
    store.sidebarOpen,
    false,
    "the arcade board is whole until the player asks for the panel"
  );
  store.setSidebarOpen(true);
  assert.equal(store.sidebarOpen, true, "the game panel is the shared left context and can open");

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
  assert.ok(
    store.activeLayers["weather-radar"],
    "the legacy Weather route becomes an additive layer"
  );
});

/** Auto-login greets the guest on startup; whatever the user does in the next three seconds used
 *  to have its toast wiped by that greeting's expiry. */
test("a later toast keeps its own countdown instead of inheriting the earlier one's", async () => {
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  store.showToast("Vítej", { durationMs: 60 });
  await wait(30);
  store.showToast("Filtr #gastro", { durationMs: 400 });

  await wait(60); // The greeting's dismissal would land in here.
  assert.equal(
    store.toast?.message,
    "Filtr #gastro",
    "the older countdown must not clear a newer message"
  );
});

test("unchanged camera events preserve the snapshot and avoid notifications", () => {
  const original = store.view;
  let calls = 0;
  const unsubscribe = store.subscribe(() => {
    calls++;
  });
  try {
    store.setView({ ...original });
    store.setView({});
    assert.equal(store.view, original);
    assert.equal(calls, 0);
    store.setView({ zoom: original.zoom + 0.25 });
    assert.equal(calls, 1);
    assert.equal(store.view.zoom, original.zoom + 0.25);
    assert.equal(store.view.lng, original.lng);
  } finally {
    unsubscribe();
    store.setView(original);
  }
});

test("repeated loading flags, empty layers and source reports wake nobody", () => {
  let calls = 0;
  const unsubscribe = store.subscribe(() => {
    calls++;
  });
  try {
    store.setLayerLoading("osm-poi", true);
    store.setLayerLoading("osm-poi", true);
    store.setLayerLoading("osm-poi", false);
    store.setLayerLoading("osm-poi", false);
    assert.equal(calls, 2, "only real loading transitions notify");

    calls = 0;
    store.setVisibleFeatures("osm-poi", []);
    store.setVisibleFeatures("osm-poi", []);
    assert.equal(calls, 1, "an empty layer staying empty is not a change");

    calls = 0;
    const report = [{ source: "osm", state: "ready", count: 3 }] as Parameters<
      typeof store.applySourceMeta
    >[0];
    store.applySourceMeta(report);
    store.applySourceMeta(structuredClone(report));
    assert.equal(calls, 1, "a repeated source report is not a change");
    store.applySourceMeta([{ ...report[0]!, count: 4 }]);
    assert.equal(calls, 2);
  } finally {
    unsubscribe();
  }
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

test("progressive source metadata keeps pending providers visibly loading", () => {
  store.applySourceMeta([
    { source: "osm", state: "ready", count: 10 },
    { source: "wikipedia", state: "loading", count: 0 }
  ]);
  assert.equal(store.sourceStatus.wikipedia?.state, "loading");
  store.applySourceMeta([
    { source: "osm", state: "ready", count: 10 },
    { source: "wikipedia", state: "ready", count: 3 }
  ]);
  assert.equal(store.sourceStatus.wikipedia?.state, "ready");
});

test("statistics route planning to Discover, replace only the fill, and resume after planning", () => {
  store.setMode("planning");
  if (!store.activeLayers.weather?.visible) store.toggleLayer("weather");
  const plan = store.activePlan;
  store.activateLayer("theme-gdp");
  assert.equal(store.mode, "discover");
  assert.equal(store.activeLayers.weather?.visible, true);
  store.setLayerFilters("theme-gdp", { period: "2022" });
  store.activateLayer("theme-population");
  assert.equal(store.activeLayers["theme-gdp"]?.visible, false);
  assert.equal(store.activeLayers["theme-gdp"]?.filters.period, "2022");
  assert.equal(store.activeLayers["theme-population"]?.visible, true);
  store.setMode("planning");
  assert.equal(store.activeLayers["theme-population"]?.visible, false);
  assert.equal(store.activePlan, plan);
  store.setMode("discover");
  assert.equal(store.activeLayers["theme-population"]?.visible, true);
  assert.equal(store.activeLayers["theme-gdp"]?.visible, false);
});

test("area selection survives camera movement and modes, with explicit clearing", () => {
  const area = {
    id: JSON.stringify(["fixture", "CZ", "lau", "123"]),
    revision: "a".repeat(64),
    name: "Obec",
    level: "lau" as const,
    country: "CZ",
    source: "fixture",
    code: "123",
    bbox: [14, 49, 15, 50] as [number, number, number, number]
  };
  store.setAreaSelection(area);
  store.setView({ lng: 16, lat: 51, zoom: 8 });
  assert.deepEqual(store.areaSelection, area);
  store.setMode("planning");
  assert.deepEqual(store.areaSelection, area);
  store.setBoundaryLevel("lau");
  assert.equal(store.boundaryLevel, "lau");
  store.setAreaSelection(null);
  assert.equal(store.areaSelection, null);
  store.setBoundaryLevel("auto");
});

test("Global has its own stack and restores the ordinary world's layers", () => {
  store.setExperience("default");
  store.setMode("discover");
  const previous = Object.keys(store.activeLayers)
    .filter((id) => store.activeLayers[id]?.visible)
    .sort();
  const area = {
    id: "fixture-area",
    revision: "a".repeat(64),
    name: "Obec",
    level: "lau" as const,
    country: "CZ",
    source: "fixture",
    code: "123",
    bbox: [14, 49, 15, 50] as [number, number, number, number]
  };
  store.setAreaSelection(area);
  store.setExperience("global");
  assert.equal(store.areaSelection, null);
  assert.equal(store.experienceId, "global");
  assert.equal(store.mode, "discover");
  assert.equal(store.activeLayers["eonet"]?.visible, true);
  assert.equal(store.activeLayers["earthquakes"]?.visible, true);
  assert.notEqual(store.activeLayers["osm-poi"]?.visible, true);
  store.setExperience("default");
  assert.deepEqual(
    Object.keys(store.activeLayers)
      .filter((id) => store.activeLayers[id]?.visible)
      .sort(),
    previous
  );
  assert.deepEqual(store.areaSelection, area);
  store.setAreaSelection(null);
});

test("temporary answers replace each other, preserve original layers and resolve source details", async () => {
  const { answerResultManifest } = await import("../layers/aiMapResults");
  const { getLayerManifestV2, allLayerPlugins } = await import("../layers/registry");
  store.setExperience("default");
  store.setMode("discover");
  const before = Object.keys(store.activeLayers).sort();
  const place = {
    id: "123",
    layerId: "osm-poi",
    title: "Place",
    longitude: 14,
    latitude: 50,
    sourceId: "osm"
  };
  const manifest = answerResultManifest("Results", [place], [{ sourceId: "osm", label: "OSM" }]);
  let previous: string | undefined;
  for (let i = 0; i < 20; i++) {
    const id = store.showAnswerResults(manifest);
    if (previous) assert.equal(getLayerManifestV2(previous), undefined);
    assert.equal(allLayerPlugins().filter((p) => p.manifest.id.startsWith("ai-answer-")).length, 1);
    previous = id;
  }
  const feature = getLayerManifestV2(previous!)!.source.inline!.features[0]!;
  store.selectPin({
    layerId: previous!,
    feature: {
      type: "Feature",
      geometry: { type: "Point", coordinates: [14, 50] },
      properties: { id: feature.id, name: feature.title, layerId: previous! }
    }
  });
  assert.equal(store.selectedPin?.layerId, "osm-poi");
  assert.equal(store.selectedPin?.feature.properties.id, "123");
  assert.equal(
    window.location.search.includes("ai-answer-"),
    false,
    "transient answers never persist in the URL"
  );
  store.hideAnswerResults();
  assert.deepEqual(Object.keys(store.activeLayers).sort(), before);
  assert.equal(
    window.location.search.includes("ai-answer-"),
    false,
    "dismissed results must leave the shared URL"
  );
  assert.equal(allLayerPlugins().filter((p) => p.manifest.id.startsWith("ai-answer-")).length, 0);
  store.selectPin(null);
});

test("preset undo restores its fields but preserves a later manual opacity edit", () => {
  if (store.activeLayers["osm-poi"]?.visible) store.toggleLayer("osm-poi");
  const before = structuredClone(store.activeLayers["osm-poi"]);
  const undo = store.applyPreset({ id: "undo-test", layers: ["osm-poi"], categories: ["cafe"] });
  store.setLayerOpacity("osm-poi", 0.42);
  undo();
  assert.equal(store.activeLayers["osm-poi"]?.visible, false);
  assert.equal(store.activeLayers["osm-poi"]?.opacity, 0.42);
  assert.deepEqual(store.activeLayers["osm-poi"]?.filters, before?.filters ?? {});
  undo();
  assert.equal(store.activeLayers["osm-poi"]?.opacity, 0.42);
});

test("a shared plan link keeps its mode when the camera rewrites the URL", async () => {
  installBrowserStub();
  const location = (window as unknown as { location: { search: string; hash?: string } }).location;
  location.search = "?mode=planning";
  location.hash = "#plan=abc";
  const { MapStore } = await import("./mapStore");
  const store = new MapStore();
  store.setView({ lng: 14.42, lat: 50.08, zoom: 12 });
  assert.equal(new URLSearchParams(window.location.search).get("mode"), "planning");
  // Ordinary navigation still keeps only the camera.
  location.hash = "";
  store.setView({ lng: 14.43, lat: 50.08, zoom: 12 });
  assert.equal(new URLSearchParams(window.location.search).get("mode"), null);
});

test("the timeline filling in this week does not turn an applied preset into Custom", async () => {
  installBrowserStub();
  const { MapStore } = await import("./mapStore");
  const store = new MapStore();
  store.applyPreset({ id: "city-test", layers: ["osm-poi", "events"], categories: ["cafe"] });
  assert.equal(store.activePresetId, "city-test");
  store.setLayerFilters("events", {
    ...store.activeLayers.events?.filters,
    from: "2026-09-25T00:00:00.000Z",
    to: "2026-10-02T23:59:59.999Z"
  });
  assert.equal(store.activePresetId, "city-test");
  // A real change to the preset's layers still counts as leaving it.
  store.setLayerOpacity("events", 0.3);
  assert.equal(store.activePresetId, null);
});

test("activating a route network commits requested filters in the same state change", async () => {
  installBrowserStub();
  const { MapStore } = await import("./mapStore");
  const store = new MapStore();
  const notifications: unknown[] = [];
  const off = store.subscribe(() =>
    notifications.push(store.activeLayers["waymarked-trails"]?.filters)
  );
  store.activateLayer("waymarked-trails", { activity: ["cycling"] });
  assert.equal(store.activeLayers["waymarked-trails"]?.visible, true);
  assert.deepEqual(store.activeLayers["waymarked-trails"]?.filters, { activity: ["cycling"] });
  assert(notifications.every((filters) => JSON.stringify(filters) === '{"activity":["cycling"]}'));
  off();
});

test("the retired camping layer turns on its categories in the POI layer, never a duplicate", async () => {
  installBrowserStub();
  const { MapStore } = await import("./mapStore");
  const store = new MapStore();
  if (store.activeLayers["osm-poi"]?.visible) store.toggleLayer("osm-poi");
  store.activateLayer("vanlife");
  assert.equal(store.activeLayers.vanlife, undefined);
  assert.equal(store.activeLayers["osm-poi"]?.visible, true);
  const categories = store.activeLayers["osm-poi"]?.filters.categories as string[];
  for (const category of ["camp_site", "caravan_site", "dump_station"])
    assert.ok(categories.includes(category), category);
});

test("a saved stack or preset carrying the retired id restores as the POI layer", async () => {
  installBrowserStub();
  const { MapStore } = await import("./mapStore");
  const store = new MapStore();
  const appearance = store.captureAppearance();
  store.restoreAppearance({
    ...appearance,
    layers: {
      vanlife: { visible: true, selected: true, opacity: 1, filters: { categories: ["camp_site"] } }
    }
  });
  assert.deepEqual(Object.keys(store.activeLayers), ["osm-poi"]);
  assert.deepEqual(store.activeLayers["osm-poi"]?.filters.categories, ["camp_site"]);
});

test("refresh clears 3D and persisted world overlays while retaining basemap and saved preferences", async () => {
  const { MapStore } = await import("./mapStore.js");
  const keys = new Map<string, string>();
  for (const key of ["mapos:buildings-3d", "mapos:terrain-3d", "mapos:experience"])
    keys.set(key, window.localStorage.getItem(key) ?? "");
  window.localStorage.setItem("mapos:buildings-3d", "1");
  window.localStorage.setItem("mapos:terrain-3d", "1");
  window.localStorage.setItem("mapos:experience", "aavegotchi");
  const next = new MapStore();
  assert.equal(next.state.buildings3d, false);
  assert.equal(next.state.terrain3d, false);
  assert.equal(next.state.experienceId, "default");
  for (const [key, value] of keys) {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  }
});

test("opening straight into game mode starts the game scene", async () => {
  installBrowserStub();
  (globalThis as { window: { location: { search: string } } }).window.location.search =
    "?mode=game";
  const { MapStore } = await import("./mapStore");
  const store = new MapStore();
  assert.equal(store.mode, "game");
  assert.ok(store.activeLayers.game?.visible, "a ?mode=game link must not show an empty board");
});
