import { expect, test } from "./fixtures/offlineTest";

/** Points are placed inside whatever bbox the app asked for — a fixture with fixed coordinates
 *  only renders if the map happens to be looking at them, which makes the test a coin flip. */
function observationsWithin(requestUrl: string, count: number) {
  const bbox = new URL(requestUrl).searchParams.get("bbox")!.split(",").map(Number);
  const [west, south, east, north] = bbox as [number, number, number, number];
  return {
    type: "FeatureCollection",
    features: Array.from({ length: count }, (_, i) => {
      const t = (i + 1) / (count + 1);
      return {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [west + (east - west) * t, south + (north - south) * t]
        },
        properties: {
          id: `inat:${i}`,
          name: `Pozorování ${i}`,
          layerId: "inaturalist",
          category: "observation"
        }
      };
    })
  };
}

test.describe("keyless data layers", () => {
  test("toggling one renders its points on the map", async ({ page }) => {
    await page.route("**/layers/inaturalist/features**", (route) =>
      route.fulfill({ json: observationsWithin(route.request().url(), 5) })
    );

    await page.goto("/?lng=13.3775&lat=49.7475&z=14");
    await page.getByTestId("layers-btn").click();
    await page.getByTestId("overflow-inaturalist").click();

    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const map = window.__maposMap;
            if (!map?.getLayer("pins-inaturalist-dot")) return -1;
            return map.querySourceFeatures("source-inaturalist").length;
          }),
        { timeout: 20_000 }
      )
      .toBeGreaterThan(0);
  });

  test("a source that refuses the viewport explains why", async ({ page }) => {
    await page.route("**/layers/commons-photos/features**", (route) =>
      route.fulfill({
        json: {
          type: "FeatureCollection",
          features: [],
          notice: "Přibliž mapu — fotky se hledají v okruhu do 10 km."
        }
      })
    );

    await page.goto("/");
    await page.getByTestId("layers-btn").click();
    await page.getByTestId("overflow-commons-photos").click();

    // An empty layer and a refused request must not look the same to the user.
    await expect(page.getByTestId("layer-notice")).toContainText("Přibliž mapu", {
      timeout: 20_000
    });
  });

  test("layers needing a key are absent until the server reports it", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("layers-btn").click();
    await expect(page.getByTestId("overflow-menu")).toBeVisible();

    // The dev server holds no keys, so these must not be offered at all.
    await expect(page.getByTestId("overflow-charging-stations")).toHaveCount(0);
    await expect(page.getByTestId("overflow-mapillary")).toHaveCount(0);
    // ...while the keyless ones are.
    await expect(page.getByTestId("overflow-earthquakes")).toBeVisible();
  });
});
