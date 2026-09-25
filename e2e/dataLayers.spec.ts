import { catalogResultRow, catalogSwitch, openLayersPanel } from "./fixtures/mapPanel";
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
    await (await catalogSwitch(page, "inaturalist", "nature-Aves")).click();

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
    await (await catalogSwitch(page, "commons-photos")).click();

    // An empty layer and a refused request must not look the same to the user: the row that
    // switched it on says why it is empty.
    await expect(catalogResultRow(page, "commons-photos")).toContainText("Přibliž mapu", {
      timeout: 20_000
    });
  });

  test("layers needing a key are absent until the server reports it", async ({ page }) => {
    await page.goto("/");
    await openLayersPanel(page);

    // The dev server holds no keys, so these are not switchable: they sit under "Needs setup"
    // with the variable to set, rather than as a switch that does nothing.
    for (const id of ["charging-stations", "mapillary"]) {
      await page.getByTestId("layers-search").fill(id);
      const toggle = page.getByTestId("layers-results").locator(`[data-testid$="-switch-${id}"]`);
      if (await toggle.count()) await expect(toggle.first()).toBeDisabled();
    }
    // ...while the keyless ones are.
    await expect(await catalogSwitch(page, "earthquakes")).toBeEnabled();
  });
});
