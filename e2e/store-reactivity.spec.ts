import { expect, test } from "@playwright/test";

/** Guards the bug that motivated making the store's layer state immutable: `setLayerFilters`
 *  used to mutate the entry in place, leaving `activeLayers` referentially identical, so
 *  `useSyncExternalStore` skipped the render. The map overlay changed and the controls driving
 *  it did not — the pill stayed unhighlighted and the legend never appeared. */
test.describe("weather controls reflect the filters they set", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/?mode=weather");
    await page.getByTestId("weather-timeline").waitFor({ timeout: 30_000 });
  });

  test("selecting a variable highlights its pill and shows the legend", async ({ page }) => {
    const temperature = page.getByTestId("weather-var-temperature");
    await expect(temperature).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("weather-legend")).toBeHidden();

    await temperature.click();

    await expect(temperature).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("weather-legend")).toBeVisible();
  });

  test("selecting a second variable moves the highlight", async ({ page }) => {
    await page.getByTestId("weather-var-temperature").click();
    await expect(page.getByTestId("weather-var-temperature")).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    await page.getByTestId("weather-var-wind").click();

    await expect(page.getByTestId("weather-var-temperature")).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    await expect(page.getByTestId("weather-var-wind")).toHaveAttribute("aria-pressed", "true");
  });

  test("the radar toggle reflects its own state", async ({ page }) => {
    const radar = page.getByTestId("weather-radar-toggle");
    await expect(radar).toHaveAttribute("aria-pressed", "true");

    await radar.click();
    await expect(radar).toHaveAttribute("aria-pressed", "false");

    await radar.click();
    await expect(radar).toHaveAttribute("aria-pressed", "true");
  });
});
