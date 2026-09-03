import { expect, test } from "./fixtures/offlineTest";

/**
 * §6.6 wave A: the OpenInfraMap overlay.
 *
 * This is the first layer whose tile holds several unrelated networks, so what these check is
 * the part that is ours rather than MapLibre's: the voltage colour scale reaches the paint, the
 * network filter decides which sublayers are drawn, and switching off leaves no source behind.
 *
 * OpenInfraMap ships no style, so the colours are ours — which is the whole reason the legend
 * can claim exact values, and the reason it is worth asserting they match.
 */

/** An empty MVT is a zero-byte body — valid, and enough for MapLibre to consider the tile done. */
const EMPTY_MVT = Buffer.alloc(0);

async function stubTiles(page: import("@playwright/test").Page): Promise<string[]> {
  const requested: string[] = [];
  await page.route("**/openinframap.org/tiles/**", (route) => {
    requested.push(route.request().url());
    return route.fulfill({ contentType: "application/x-protobuf", body: EMPTY_MVT });
  });
  return requested;
}

function visibilityOf(page: import("@playwright/test").Page, id: string) {
  return () =>
    page.evaluate((layerId) => {
      const map = window.__maposMap;
      if (!map?.getLayer(layerId)) return "absent";
      return map.getLayoutProperty(layerId, "visibility") ?? "visible";
    }, id);
}

test.describe("infrastruktura", () => {
  test("power lines are coloured by voltage, not by one flat colour", async ({ page }) => {
    const requested = await stubTiles(page);

    await page.goto("/?layers=openinframap&lng=13.3775&lat=49.7475&z=10");
    await expect(page.getByTestId("mode-bar")).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => requested.length, { timeout: 20_000 }).toBeGreaterThan(0);

    const color = await page.evaluate(() =>
      window.__maposMap?.getPaintProperty("vt-openinframap-power-line", "line-color")
    );
    // A string here would mean every line from a village pole to a 400 kV backbone rendered the
    // same, which is the one thing this layer exists to distinguish.
    expect(Array.isArray(color)).toBe(true);
    expect((color as unknown[])[0]).toBe("step");
    expect(color).toContain("#a21caf");
  });

  test("the legend states the voltage scale the paint actually uses", async ({ page }) => {
    await stubTiles(page);
    await page.goto("/?layers=openinframap&lng=13.3775&lat=49.7475&z=10");

    const legend = page.getByTestId("legend-stack");
    await expect(legend).toBeVisible({ timeout: 20_000 });
    await expect(legend).toContainText("barva je napětí");

    const expand = page.getByTestId("legend-expand");
    if (await expand.count()) await expand.click();
    await expect(legend).toContainText("Nad 500 kV");
    await expect(legend).toContainText("Pod zemí");
  });

  test("the network filter decides which sublayers are drawn", async ({ page }) => {
    await stubTiles(page);
    await page.goto("/?layers=openinframap&lng=13.3775&lat=49.7475&z=10");
    await expect(page.getByTestId("mode-bar")).toBeVisible({ timeout: 30_000 });

    // Power is the default, so the grid is on and the pipelines are not: turning the layer on
    // should not put four networks on the map at once.
    await expect
      .poll(visibilityOf(page, "vt-openinframap-power-line"), { timeout: 20_000 })
      .toBe("visible");
    await expect.poll(visibilityOf(page, "vt-openinframap-water-pipeline")).toBe("none");

    await page.getByTestId("layers-btn").click();
    await page.getByTestId("layer-filter-btn-openinframap").click();
    await page.getByTestId("filter-openinframap-network-water").click();

    await expect
      .poll(visibilityOf(page, "vt-openinframap-water-pipeline"), { timeout: 20_000 })
      .toBe("visible");
  });

  test("switching it off leaves nothing behind", async ({ page }) => {
    await stubTiles(page);
    await page.goto("/?layers=openinframap&lng=13.3775&lat=49.7475&z=10");
    await expect
      .poll(() => page.evaluate(() => Boolean(window.__maposMap?.getSource("source-vt-openinframap"))), {
        timeout: 20_000
      })
      .toBe(true);

    await page.getByTestId("layers-btn").click();
    await page.getByTestId("overflow-openinframap").click();
    await page.getByTestId("layers-btn").click();

    await expect
      .poll(() =>
        page.evaluate(() => ({
          source: Boolean(window.__maposMap?.getSource("source-vt-openinframap")),
          layer: Boolean(window.__maposMap?.getLayer("vt-openinframap-power-line"))
        }))
      )
      .toEqual({ source: false, layer: false });
  });
});
