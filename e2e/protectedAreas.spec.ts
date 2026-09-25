import { catalogSwitch, openCatalogSettings } from "./fixtures/mapPanel";
import { expect, test } from "./fixtures/offlineTest";

/**
 * §6.6 wave A / §23: protected areas, from the European source rather than a national one.
 *
 * Natura 2000 arrives as WMS, which MapLibre consumes by substituting the tile extent into the
 * URL. That is the part worth pinning: if the placeholder is encoded, or the CRS and version do
 * not match what the service expects, the requests still go out and simply return nothing —
 * a layer that looks switched on and draws an empty map.
 */

function wmsRequests(page: import("@playwright/test").Page): string[] {
  const urls: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("Natura2000Sites")) urls.push(request.url());
  });
  return urls;
}

const SOURCE_ID = "source-tile-natura2000";

test.describe("chráněná území", () => {
  test("the tile extent reaches the service as a real bbox, not the placeholder", async ({
    page
  }) => {
    const urls = wmsRequests(page);

    await page.goto("/?layers=natura2000&lng=13.3775&lat=49.7475&z=10");
    await expect(page.getByTestId("mode-bar")).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => urls.length, { timeout: 20_000 }).toBeGreaterThan(0);

    const params = new URL(urls[0]!).searchParams;
    expect(params.get("request")).toBe("GetMap");
    expect(params.get("version")).toBe("1.3.0");
    expect(params.get("crs")).toBe("EPSG:3857");
    expect(params.get("transparent")).toBe("true");

    // Four finite web-mercator metres, in the axis order 1.3.0 wants for EPSG:3857.
    const bbox = params.get("bbox")!.split(",").map(Number);
    expect(bbox).toHaveLength(4);
    expect(bbox.every((value) => Number.isFinite(value))).toBe(true);
    expect(bbox[2]).toBeGreaterThan(bbox[0]!);
    expect(bbox[3]).toBeGreaterThan(bbox[1]!);
  });

  test("both directives are drawn by default, habitats beneath birds", async ({ page }) => {
    const urls = wmsRequests(page);

    await page.goto("/?layers=natura2000&lng=13.3775&lat=49.7475&z=10");
    await expect.poll(() => urls.length, { timeout: 30_000 }).toBeGreaterThan(0);

    // WMS paints the list front to back, so the smaller bird areas must come last to stay visible.
    expect(new URL(urls[0]!).searchParams.get("layers")).toBe("2,1");
  });

  test("choosing one directive asks the service for only that layer", async ({ page }) => {
    const urls = wmsRequests(page);

    await page.goto("/?layers=natura2000&lng=13.3775&lat=49.7475&z=10");
    await expect(page.getByTestId("mode-bar")).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => urls.length, { timeout: 20_000 }).toBeGreaterThan(0);

    // Both directives start on; leaving only the bird areas means switching the habitats off.
    await openCatalogSettings(page, "natura2000");
    await page.getByTestId("filter-natura2000-directive-habitats").click();

    await expect
      .poll(() => new URL(urls.at(-1)!).searchParams.get("layers"), { timeout: 20_000 })
      .toBe("1");
  });

  test("the legend uses the service's own swatches and admits its coverage", async ({ page }) => {
    await page.goto("/?layers=natura2000&lng=13.3775&lat=49.7475&z=10");

    const legend = page.getByTestId("legend-stack");
    await expect(legend).toBeVisible({ timeout: 20_000 });
    await expect(legend).toContainText("Natura 2000");

    const expand = page.getByTestId("legend-expand");
    if (await expand.count()) await expand.click();
    await expect(legend).toContainText("Ptačí oblasti");
    await expect(legend).toContainText("Přírodní stanoviště");
    // A blank map outside the EU is the data's limit, not a failure, so the key says so.
    await expect(legend).toContainText("Jen EU");
  });

  test("switching it off leaves no source behind", async ({ page }) => {
    await page.goto("/?layers=natura2000&lng=13.3775&lat=49.7475&z=10");
    await expect(page.getByTestId("mode-bar")).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(() => page.evaluate((id) => Boolean(window.__maposMap?.getSource(id)), SOURCE_ID), {
        timeout: 20_000
      })
      .toBe(true);

    await (await catalogSwitch(page, "natura2000")).click();

    await expect
      .poll(() => page.evaluate((id) => Boolean(window.__maposMap?.getSource(id)), SOURCE_ID))
      .toBe(false);
  });
});
