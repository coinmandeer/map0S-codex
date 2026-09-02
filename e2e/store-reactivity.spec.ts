import { expect, test } from "./fixtures/offlineTest";

/** Guards the bug that motivated making the store's layer state immutable: `setLayerFilters`
 *  used to mutate the entry in place, leaving `activeLayers` referentially identical, so
 *  `useSyncExternalStore` skipped the render. The map overlay changed and the controls driving
 *  it did not — the pill stayed unhighlighted and the legend never appeared. */
const weatherOption = (page: import("@playwright/test").Page, id: string) =>
  page.locator(`label:has([data-testid="weather-visualization-${id}"])`);

test.describe("legacy weather deep links keep weather as an additive Discover layer", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/?mode=weather");
    await expect(page).toHaveURL(/[?&]mode=discover(?:&|$)/);
    await expect(page.getByTestId("discover-panel")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("global-timeline")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("overflow-btn").click();
    await expect(page.getByTestId("overflow-menu")).toBeVisible();
  });

  test("the migrated link starts with a usable radar control and legend", async ({ page }) => {
    await expect(page.getByTestId("weather-visualization-radar")).toBeChecked();
    await expect(page.getByTestId("weather-legend")).toBeVisible();
  });

  test("selecting another variable keeps one exclusive map visualization", async ({ page }) => {
    await weatherOption(page, "temperature").click();
    await expect(page.getByTestId("weather-visualization-temperature")).toBeChecked();
    await expect(page.getByTestId("weather-visualization-radar")).not.toBeChecked();
    await expect(page.getByTestId("weather-legend")).toBeVisible();

    await weatherOption(page, "wind").click();
    await expect(page.getByTestId("weather-visualization-temperature")).not.toBeChecked();
    await expect(page.getByTestId("weather-visualization-wind")).toBeChecked();
  });

  test("radar can be restored after a numeric variable", async ({ page }) => {
    await weatherOption(page, "temperature").click();
    await expect(page.getByTestId("weather-visualization-temperature")).toBeChecked();

    await weatherOption(page, "radar").click();
    await expect(page.getByTestId("weather-visualization-radar")).toBeChecked();
    await expect(page.getByTestId("weather-visualization-temperature")).not.toBeChecked();
    await expect(page.getByTestId("global-timeline")).toContainText("Srážkový radar");
  });
});
