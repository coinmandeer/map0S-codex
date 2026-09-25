import { expect, test } from "./fixtures/offlineTest";
import { openCatalogSettings } from "./fixtures/mapPanel";

/** §2.2: there is exactly one settings editor per layer, opened inline under its row in the
 *  shared Vrstvy panel. The old floating "Filtry vrstev" strip over the map is gone, so this
 *  spec asserts the single editor writes through to the map's own request. */
for (const width of [390, 1440]) {
  test(`layer settings edit the same state at ${width}px`, async ({ page }) => {
    const requested: string[] = [];
    await page.route("**/layers/refuge-restrooms/features**", (route) => {
      requested.push(route.request().url());
      return route.fulfill({
        json: { type: "FeatureCollection", features: [], query: { status: "complete" } }
      });
    });

    await page.setViewportSize({ width, height: 900 });
    await page.goto("/?layers=refuge-restrooms&lng=14.42&lat=50.08&z=12");
    // Refuge is its own row next to the OSM toilets; its inline settings expose the facet.
    await openCatalogSettings(page, "refuge-restrooms");
    const toggle = page.getByTestId("filter-refuge-restrooms-accessible");
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-checked", "false");

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect
      .poll(() => requested.some((url) => new URL(url).searchParams.get("accessible") === "true"), {
        timeout: 20_000
      })
      .toBe(true);
  });
}
