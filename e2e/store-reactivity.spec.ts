import { expect, test } from "./fixtures/offlineTest";
import { catalogSwitch } from "./fixtures/mapPanel";

/** Guards the bug that motivated making the store's layer state immutable: `setLayerFilters`
 *  used to mutate the entry in place, leaving `activeLayers` referentially identical, so
 *  `useSyncExternalStore` skipped the render. The map overlay changed and the controls driving
 *  it did not — the pill stayed unhighlighted and the legend never appeared. */
const storeState = (page: import("@playwright/test").Page) =>
  page.evaluate(async () => {
    const { getMapStore } = await import(/* @vite-ignore */ "/src/store/mapStore.ts");
    const store = getMapStore();
    return {
      mode: store.mode,
      visible: Object.entries(store.activeLayers)
        .filter(([, layer]) => layer.visible)
        .map(([id]) => id)
    };
  });

// Weather quantities are separate catalogue layers since the redesign, so the guard is now:
// a switch flipped anywhere is the switch every control shows, immediately.
test.describe("legacy weather deep links keep weather as an additive Discover layer", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/?mode=weather");
    // The URL keeps the camera only; the migrated mode lives in the store.
    await expect.poll(async () => (await storeState(page)).mode).toBe("discover");
    await expect(page.getByTestId("discover-panel")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("global-timeline")).toBeVisible({ timeout: 30_000 });
  });

  test("the migrated link starts with a usable radar control and legend", async ({ page }) => {
    await expect(await catalogSwitch(page, "weather-radar")).toBeChecked();
    // Weather's key rides with the timeline it animates.
    await page.getByTestId("right-utility-close").click();
    await expect(page.getByTestId("weather-legend").first()).toBeVisible();
  });

  test("another quantity is added beside the radar, and both switches say so", async ({ page }) => {
    const temperature = await catalogSwitch(page, "weather-temperature");
    await temperature.click();
    await expect(temperature).toBeChecked();
    await expect
      .poll(async () => (await storeState(page)).visible)
      .toEqual(expect.arrayContaining(["weather-radar", "weather-temperature"]));
    await expect(await catalogSwitch(page, "weather-radar")).toBeChecked();
  });

  test("radar can be switched off and restored", async ({ page }) => {
    const radar = await catalogSwitch(page, "weather-radar");
    await radar.click();
    await expect(radar).not.toBeChecked();
    await expect.poll(async () => (await storeState(page)).visible).not.toContain("weather-radar");

    await radar.click();
    await expect(radar).toBeChecked();
    await expect.poll(async () => (await storeState(page)).visible).toContain("weather-radar");
    await expect(page.getByTestId("global-timeline")).toBeVisible();
  });
});
