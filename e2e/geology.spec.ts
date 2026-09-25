import { catalogSwitch } from "./fixtures/mapPanel";
import { expect, test } from "./fixtures/offlineTest";
import { openAccessibleMapFeature, stubDiscoverContext } from "./fixtures/discoverContext";

/**
 * The geology overlay is the first layer whose colours live in the data rather than in our style,
 * so what these check is that the vector plumbing holds: tiles are asked for, a fill layer reads
 * `color` off the feature, and switching off takes source and layer with it.
 *
 * The AI explanation is not exercised here — end-to-end runs have no model key, and a spec that
 * needs one would be a spec that fails on a fresh clone. What it does check is the promise the
 * panel makes without one: the units still show.
 */

/** An empty MVT is a zero-byte body — valid, and enough for MapLibre to consider the tile done. */
const EMPTY_MVT = Buffer.alloc(0);

test.describe("geologie", () => {
  test("the overlay draws from the tile's own colours", async ({ page }) => {
    const requested: string[] = [];
    await page.route("**/tiles.macrostrat.org/**", (route) => {
      requested.push(route.request().url());
      return route.fulfill({ contentType: "application/x-protobuf", body: EMPTY_MVT });
    });

    await page.goto("/");
    await (await catalogSwitch(page, "geology")).click();

    await expect.poll(() => requested.length, { timeout: 15_000 }).toBeGreaterThan(0);

    const fill = await page.evaluate(() => {
      const layer = window.__maposMap?.getLayer("vt-geology-fill");
      if (!layer) return null;
      return {
        type: layer.type,
        color: window.__maposMap?.getPaintProperty("vt-geology-fill", "fill-color")
      };
    });
    expect(fill?.type).toBe("fill");
    // A flat colour here would mean every rock in Europe rendered the same shade.
    expect(JSON.stringify(fill?.color)).toContain("color");
  });

  test("switching it off leaves nothing behind", async ({ page }) => {
    await page.route("**/tiles.macrostrat.org/**", (route) =>
      route.fulfill({ contentType: "application/x-protobuf", body: EMPTY_MVT })
    );
    await page.goto("/");
    await (await catalogSwitch(page, "geology")).click();

    await expect
      .poll(() => page.evaluate(() => Boolean(window.__maposMap?.getLayer("vt-geology-fill"))), {
        timeout: 15_000
      })
      .toBe(true);

    await (await catalogSwitch(page, "geology")).click();
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              Boolean(window.__maposMap?.getLayer("vt-geology-fill")) ||
              Boolean(window.__maposMap?.getSource("source-vt-geology"))
          ),
        { timeout: 15_000 }
      )
      .toBe(false);
  });

  test("the panel shows the rock even when no model is configured", async ({ page }) => {
    await stubDiscoverContext(page);
    await page.route("**/info/geology**", (route) =>
      route.fulfill({
        json: {
          units: [
            {
              id: "1",
              name: "Barrandien",
              lithology: "pískovec, vedlejší: prachovec",
              description: null,
              period: "ordovik",
              ageRange: [485, 444],
              color: "#A6C7BA"
            }
          ],
          explanation: null,
          model: null,
          attribution: "Macrostrat (CC BY 4.0)"
        }
      })
    );

    await page.route("**/layers/osm-poi/features**", (route) => {
      const [west, south, east, north] = new URL(route.request().url()).searchParams
        .get("bbox")!
        .split(",")
        .map(Number) as [number, number, number, number];
      return route.fulfill({
        json: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [(west + east) / 2, (south + north) / 2] },
              properties: {
                id: "osm:1",
                name: "Vyhlídka",
                category: "viewpoint",
                layerId: "osm-poi"
              }
            }
          ]
        }
      });
    });

    await page.goto("/?layers=osm-poi&mode=discover&lng=13.3775&lat=49.7475&z=13");
    await openAccessibleMapFeature(page, "Vyhlídka");
    await expect(page.getByTestId("pin-detail")).toBeVisible({ timeout: 20_000 });
    // Geology is one of the detail's sections, folded until asked for.
    await page.getByTestId("place-section-geology").locator("summary").click();

    const panel = page.getByTestId("panel-geologie");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("Barrandien");
    await expect(panel).toContainText("ordovik");
  });
});
