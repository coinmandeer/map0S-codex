import { expect, test } from "./fixtures/offlineTest";
import { openBasemaps } from "./fixtures/mapPanel";

/**
 * §6.6 wave A: 3D terrain from the Tilezen DEM.
 *
 * The reason this sits beside the 3D buildings switch rather than in the Vrstvy drawer is that
 * it changes what the map *is* rather than what is drawn on it. The reason it is not disabled
 * for raster backgrounds — unlike buildings, which need the background to carry outlines — is
 * that the elevation comes from its own global source, so it works over imagery too. Both of
 * those are what these check.
 */

test.describe("3D terrain", () => {
  test("terrain applies over a raster background, unlike extruded buildings", async ({ page }) => {
    await page.goto("/?lng=13.3775&lat=49.7475&z=10");
    await openBasemaps(page);

    // Aerial imagery carries no building outlines, so buildings are unavailable over it while
    // terrain must not be: that difference is the whole design.
    await page.getByTestId("basemap-group-satellite").click();
    await page.getByTestId("basemap-eox-s2cloudless").click();

    await expect(page.getByTestId("toggle-buildings-3d")).toBeDisabled();
    const terrainToggle = page.getByTestId("toggle-terrain-3d");
    await expect(terrainToggle).toBeEnabled();

    await terrainToggle.click();

    await expect
      .poll(
        () =>
          page.evaluate(() => ({
            terrain: Boolean(window.__maposMap?.getTerrain()),
            hillshade: Boolean(window.__maposMap?.getLayer("mapos-hillshade"))
          })),
        { timeout: 20_000 }
      )
      .toEqual({ terrain: true, hillshade: true });

    // Relief needs an angle to read as relief.
    await expect
      .poll(() => page.evaluate(() => window.__maposMap?.getPitch() ?? 0), { timeout: 20_000 })
      .toBeGreaterThan(10);
  });

  test("the DEM declares terrarium encoding, not MapLibre's default", async ({ page }) => {
    await page.goto("/?lng=13.3775&lat=49.7475&z=10");
    await openBasemaps(page);
    await page.getByTestId("toggle-terrain-3d").click();

    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const source = window.__maposMap?.getStyle()?.sources?.["mapos-terrain-dem"];
            if (!source || source.type !== "raster-dem") return null;
            return { encoding: source.encoding ?? "mapbox", tileSize: source.tileSize };
          }),
        { timeout: 20_000 }
      )
      // Tilezen pixels mean `(R * 256 + G + B / 256) - 32768` metres. Reading them as Mapbox's
      // encoding produces heights that are wrong rather than absent, so nothing would look
      // broken — which is exactly why it is worth asserting.
      .toEqual({ encoding: "terrarium", tileSize: 256 });
  });

  test("switching it off releases the mesh and its source", async ({ page }) => {
    await page.goto("/?lng=13.3775&lat=49.7475&z=10");
    await openBasemaps(page);
    const toggle = page.getByTestId("toggle-terrain-3d");

    await toggle.click();
    await expect
      .poll(() => page.evaluate(() => Boolean(window.__maposMap?.getTerrain())), {
        timeout: 20_000
      })
      .toBe(true);

    await toggle.click();
    await expect
      .poll(() =>
        page.evaluate(() => ({
          terrain: Boolean(window.__maposMap?.getTerrain()),
          hillshade: Boolean(window.__maposMap?.getLayer("mapos-hillshade")),
          source: Boolean(window.__maposMap?.getSource("mapos-terrain-dem"))
        }))
      )
      .toEqual({ terrain: false, hillshade: false, source: false });
  });

  test("the choice survives a background switch", async ({ page }) => {
    await page.goto("/?lng=13.3775&lat=49.7475&z=10");
    await openBasemaps(page);
    await page.getByTestId("toggle-terrain-3d").click();
    await expect
      .poll(() => page.evaluate(() => Boolean(window.__maposMap?.getTerrain())), {
        timeout: 20_000
      })
      .toBe(true);

    // A style switch wipes everything the style holds, terrain included, so it has to be put
    // back rather than only applied when the switch is flipped.
    await page.getByTestId("basemap-carto-dark").click();

    await expect
      .poll(() => page.evaluate(() => Boolean(window.__maposMap?.getTerrain())), {
        timeout: 20_000
      })
      .toBe(true);
  });
});
