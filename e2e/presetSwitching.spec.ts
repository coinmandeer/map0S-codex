import { expect, test } from "./fixtures/offlineTest";

/**
 * Preset switching is a config swap, not a reload. The wins worth locking in:
 *  1. a source shared between two presets (osm-poi in Výlet ↔ Město) keeps its identity —
 *     the engine updates it in place instead of detaching and re-creating it;
 *  2. a facet swap (Výlet → Město) fetches once because the categories changed, and the
 *     source stays the same object;
 *  3. layers that leave the stack (osm-poi under Planeta) detach without any fetch;
 *  4. switching back to an already-seen preset reattaches from the engine's cache.
 */
test("switching presets keeps shared sources alive and swaps the POI facet without a refetch", async ({
  page,
  browserName
}) => {
  test.skip(browserName !== "chromium", "Chromium-only smoke of engine internals");
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  const poiRequests: string[] = [];
  await page.route("**/layers/osm-poi/features**", async (route) => {
    poiRequests.push(route.request().url());
    await route.continue();
  });

  await page.goto("/?mode=discover&lng=14.42&lat=50.08&z=10");
  await expect.poll(() => page.evaluate(() => !!window.__maposMap?.isStyleLoaded())).toBe(true);

  const applyPreset = (id: string) =>
    page.evaluate(async (id) => {
      const { getMapStore } = await import("/src/store/mapStore.ts");
      const { MAP_PRESETS } = await import("/src/ui/presets.ts");
      getMapStore().applyPreset(MAP_PRESETS.find((preset) => preset.id === id)!);
    }, id);
  const poiSourceId = () =>
    page.evaluate(() => window.__maposMap?.getSource("source-osm-poi") != null);
  const tagPoiSource = () =>
    page.evaluate(() => {
      (
        window.__maposMap!.getSource("source-osm-poi") as unknown as { __presetTag?: string }
      ).__presetTag = "shared";
    });
  const poiSourceTagged = () =>
    page.evaluate(
      () =>
        (window.__maposMap?.getSource("source-osm-poi") as unknown as { __presetTag?: string })
          ?.__presetTag === "shared"
    );

  // Výlet: POI pins up, tourist basemap.
  await applyPreset("day-trip");
  await expect.poll(poiSourceId).toBe(true);
  const categories = await page.evaluate(async () => {
    const { getMapStore } = await import("/src/store/mapStore.ts");
    return getMapStore().activeLayers["osm-poi"]?.filters.categories;
  });
  expect(categories).toContain("castle");
  expect(await page.evaluate(() => location.search)).toContain("preset=day-trip");
  await tagPoiSource();

  // Výlet → Město: same osm-poi source object, one facet fetch, categories swapped.
  const requestsBeforeSwap = poiRequests.length;
  await applyPreset("city");
  await expect.poll(poiSourceTagged).toBe(true);
  await expect.poll(() => poiRequests.length).toBe(requestsBeforeSwap + 1);
  const cityCategories = await page.evaluate(async () => {
    const { getMapStore } = await import("/src/store/mapStore.ts");
    return getMapStore().activeLayers["osm-poi"]?.filters.categories;
  });
  expect(cityCategories).toContain("cafe");
  expect(cityCategories).not.toContain("castle");

  // Město → Planeta: osm-poi leaves the stack and detaches; once the swap settles, no further
  // POI fetch may arrive (pagination of an in-flight response may land around the swap).
  await applyPreset("planet");
  await expect.poll(poiSourceId).toBe(false);
  await page.waitForTimeout(600);
  const requestsAtDetach = poiRequests.length;
  await page.waitForTimeout(600);
  expect(poiRequests.length).toBe(requestsAtDetach);

  // Planeta → Výlet: reattach + fetch for the fresh viewport, preset in URL.
  await applyPreset("day-trip");
  await expect.poll(poiSourceId).toBe(true);
  await expect.poll(() => poiRequests.length).toBeGreaterThan(requestsAtDetach);
  expect(await page.evaluate(() => location.search)).toContain("preset=day-trip");
});
