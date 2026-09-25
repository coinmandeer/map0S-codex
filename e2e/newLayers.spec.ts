import { expect, test, type Page } from "./fixtures/offlineTest";
import { catalogSwitch } from "./fixtures/mapPanel";

/** The layers drawer now starts collapsed, so every group has to be opened before its rows exist
 *  in the DOM. Expanding by the group's own label keeps the test about behaviour, not internals. */
async function openLayers(page: Page) {
  await page.getByTestId("layers-btn").click();
  await expect(page.getByTestId("overflow-menu")).toBeVisible();
}

test.describe("new layers", () => {
  test("MeshCore nodes render as points once the layer is on", async ({ page }) => {
    await page.goto("/?lng=14.42&lat=50.08&z=10");
    await openLayers(page);
    await page.getByRole("button", { name: "Community" }).click();
    await page.getByTestId("community-switch-meshcore").click();

    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const map = window.__maposMap;
            if (!map?.getLayer("pins-meshcore-dot")) return -1;
            return map.querySourceFeatures("source-meshcore").length;
          }),
        { timeout: 20_000 }
      )
      .toBeGreaterThan(0);
  });

  test("sky darkness adds a keyless raster overlay", async ({ page }) => {
    await page.goto("/?lng=14.42&lat=50.08&z=8");
    await (await catalogSwitch(page, "dark-sky")).click();

    await expect
      .poll(
        () => page.evaluate(() => Boolean(window.__maposMap?.getLayer("raster-tile-dark-sky"))),
        { timeout: 20_000 }
      )
      .toBe(true);
  });

  test("each weather quantity is its own layer and several can be on together", async ({
    page
  }) => {
    await page.goto("/?lng=14.42&lat=50.08&z=8");
    await (await catalogSwitch(page, "weather-radar")).click();
    await (await catalogSwitch(page, "weather-temperature")).click();

    await page.getByTestId("layers-search").fill("");
    await page.getByTestId("layers-view-active").click();
    await expect(page.getByTestId("active-switch-weather-radar")).toBeChecked();
    await expect(page.getByTestId("active-switch-weather-temperature")).toBeChecked();
  });
});
