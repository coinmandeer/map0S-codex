import test from "node:test";
import assert from "node:assert/strict";

test("passive zoom refresh preserves AI panel and camera, theme replacement cannot restore old layer", async () => {
  const bus = new EventTarget(),
    storage = new Map<string, string>();
  const loc = { href: "http://localhost/", pathname: "/", search: "" };
  Object.assign(globalThis, {
    window: {
      URL: globalThis.URL,
      location: loc,
      innerWidth: 1440,
      history: {
        replaceState: (_a: unknown, _b: unknown, url: URL) => {
          loc.href = new URL(String(url), loc.href).href;
        }
      },
      localStorage: {
        getItem: (k: string) => storage.get(k) ?? null,
        setItem: (k: string, v: string) => storage.set(k, v),
        removeItem: (k: string) => storage.delete(k)
      },
      addEventListener: bus.addEventListener.bind(bus),
      removeEventListener: bus.removeEventListener.bind(bus),
      dispatchEvent: bus.dispatchEvent.bind(bus)
    }
  });
  Object.assign(globalThis, { localStorage: window.localStorage });
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/v2/themes") return Response.json({ themes: [] });
    const id = url.pathname.split("/").at(-1)!;
    return Response.json({
      id,
      name: id,
      icon: "bar_chart",
      unit: "%",
      higherIsWorse: true,
      sourceCount: 1,
      period: "2025",
      periods: ["2025"],
      breaks: [{ from: 0, to: 100, color: "#ffffb2" }],
      ready: true,
      revision: "r1",
      coverageBbox: [-60, -20, 70, 80],
      sources: []
    });
  };
  const { getMapStore } = await import("../store/mapStore");
  const { emit, on } = await import("../lib/events");
  const { activateStatistic, attachStatisticsRuntime, statisticsSnapshot, deactivateStatistic } =
    await import("./explorerStore");
  let fits = 0;
  const offFit = on("fit-bounds", () => fits++);
  const detach = attachStatisticsRuntime();
  try {
    await new Promise((resolve) => setTimeout(resolve, 0));
    emit("discover-viewport", { lng: 125, lat: 15, bbox: [120, 10, 130, 20], zoom: 9 });
    await activateStatistic("poverty", "2025", [], { reveal: false, fitCoverage: false });
    assert.equal(statisticsSnapshot().open, false);
    assert(getMapStore().activeLayers["theme-poverty"]?.visible);
    // Cross the runtime's data resolution threshold while deliberately outside source coverage.
    emit("discover-viewport", { lng: 125, lat: 15, bbox: [120, 10, 130, 20], zoom: 5 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(statisticsSnapshot().open, false);
    assert.equal(fits, 0);
    await activateStatistic("unemployment", "2025", [], { reveal: false, fitCoverage: false });
    assert.equal(statisticsSnapshot().activeId, "unemployment");
    assert.notEqual(getMapStore().activeLayers["theme-poverty"]?.visible, true);
    assert.equal(getMapStore().activeLayers["theme-unemployment"]?.visible, true);
    assert.equal(statisticsSnapshot().open, false);
    assert.equal(fits, 0);
  } finally {
    detach();
    offFit();
    deactivateStatistic();
    globalThis.fetch = oldFetch;
  }
});
