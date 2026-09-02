import { expect, test } from "./fixtures/offlineTest";

/** A 1x1 transparent PNG, so the spec never depends on anyone's tile servers being up. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

/** Every tile request the picker can produce, answered locally. */
async function stubTiles(page: import("@playwright/test").Page) {
  for (const pattern of [
    "**/basemap/**",
    "**/tiles.maps.eox.at/**",
    "**/server.arcgisonline.com/**",
    "**/tile.openstreetmap.org/**"
  ]) {
    await page.route(pattern, (route) => route.fulfill({ contentType: "image/png", body: PNG }));
  }
}

async function selectBasemap(
  page: import("@playwright/test").Page,
  id: string,
  group: "street" | "outdoor" | "satellite" | "terrain"
) {
  const accordion = page.locator(`[data-basemap-group="${group}"]`);
  if ((await accordion.getAttribute("open")) === null) {
    await page.getByTestId(`basemap-group-${group}`).click();
  }
  await page.getByTestId(`basemap-${id}`).click();
}

test.describe("basemap picker", () => {
  test("switching the background swaps the tiles and survives a reload", async ({ page }) => {
    await stubTiles(page);
    const tileRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("tiles.maps.eox.at")) tileRequests.push(request.url());
    });

    await page.goto("/");
    await page.getByTestId("basemap-btn").click();
    await expect(page.getByTestId("tiles-sheet")).toBeVisible();

    await selectBasemap(page, "eox-s2cloudless", "satellite");
    await expect.poll(() => tileRequests.length, { timeout: 15_000 }).toBeGreaterThan(0);

    // The choice is the user's, so it outlives the tab.
    await page.reload();
    await page.getByTestId("basemap-btn").click();
    await expect(page.getByTestId("basemap-eox-s2cloudless")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  test("credits follow the background that is actually drawn", async ({ page }) => {
    await stubTiles(page);
    await page.goto("/");
    await page.getByTestId("basemap-btn").click();
    await selectBasemap(page, "eox-s2cloudless", "satellite");
    await page.keyboard.press("Escape");

    await expect(page.locator(".maplibregl-ctrl-attrib-inner")).toContainText("Sentinel-2", {
      timeout: 15_000
    });
  });

  test("labels and 3D buildings are offered only where they mean something", async ({ page }) => {
    await stubTiles(page);
    await page.goto("/");
    await page.getByTestId("basemap-btn").click();

    // A vector street map: no imagery to label, but buildings to extrude.
    await selectBasemap(page, "carto-voyager", "street");
    await expect(page.getByTestId("toggle-basemap-labels")).toBeDisabled();
    await expect(page.getByTestId("toggle-buildings-3d")).toBeEnabled();

    // Satellite imagery: the other way round.
    await selectBasemap(page, "eox-s2cloudless", "satellite");
    await expect(page.getByTestId("toggle-basemap-labels")).toBeEnabled();
    await expect(page.getByTestId("toggle-buildings-3d")).toBeDisabled();
  });

  test("3D tilts the camera, and a background without buildings puts it back down", async ({
    page
  }) => {
    await stubTiles(page);
    await page.goto("/");
    const pitch = () => page.evaluate(() => window.__maposMap?.getPitch() ?? 0);

    await page.getByTestId("basemap-btn").click();
    await page.getByTestId("toggle-buildings-3d").click();
    // Extrusions are invisible from straight above, so switching them on has to supply the view.
    await expect.poll(pitch).toBeGreaterThan(30);

    await selectBasemap(page, "eox-s2cloudless", "satellite");
    await expect.poll(pitch).toBe(0);
  });

  test("place sources stay under World while the background remains a single Mapové podklady choice", async ({
    page
  }) => {
    await stubTiles(page);
    await page.goto("/");
    await page.getByTestId("basemap-btn").click();

    await expect(page.getByTestId("layer-source-osm")).toHaveCount(0);

    // Backgrounds in Tiles deselect each other.
    await selectBasemap(page, "osm-carto", "street");
    await expect(page.getByTestId("basemap-osm-carto")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("basemap-carto-voyager")).toHaveAttribute(
      "aria-pressed",
      "false"
    );

    await page.keyboard.press("Escape");
    await page.getByTestId("overflow-btn").click();
    await page.getByTestId("experience-selector").locator("summary").click();
    const osm = page.getByTestId("layer-source-osm");
    const wikipedia = page.getByTestId("layer-source-wikipedia");
    await expect(osm).toHaveAttribute("aria-pressed", "true");
    await expect(wikipedia).toHaveAttribute("aria-pressed", "true");
    await wikipedia.click();
    await expect(wikipedia).toHaveAttribute("aria-pressed", "false");
    await wikipedia.click();
    await expect(wikipedia).toHaveAttribute("aria-pressed", "true");
    await expect(osm).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("basemap-osm-carto")).toHaveCount(0);
  });

  test("a background whose key the server lacks is not offered", async ({ page }) => {
    await stubTiles(page);
    await page.goto("/");
    await page.getByTestId("basemap-btn").click();

    // The e2e server runs without tile keys, so the keyed providers must be absent rather than
    // present and failing tile by tile.
    await expect(page.getByTestId("basemap-google-satellite")).toHaveCount(0);
    await expect(page.getByTestId("basemap-carto-voyager")).toBeVisible();
  });

  test("a failed background falls back visibly and restores active overlays", async ({ page }) => {
    await stubTiles(page);
    await page.goto("/");
    await expect
      .poll(() => page.evaluate(() => window.__maposMap?.isStyleLoaded() ?? false))
      .toBe(true);

    await page.getByTestId("basemap-btn").click();
    await page.getByTestId("overflow-cyclosm").click();
    await expect
      .poll(() => page.evaluate(() => Boolean(window.__maposMap?.getLayer("raster-tile-cyclosm"))))
      .toBe(true);

    await page.evaluate(() => {
      const map = window.__maposMap;
      if (!map) throw new Error("Map is not available");
      map.fire("error", {
        sourceId: "basemap",
        error: new Error("simulated basemap tile failure")
      } as never);
    });
    await expect(page.getByTestId("toast")).toContainText("nouzovou mapu");
    await expect(page.getByTestId("toast")).toContainText("vrstvy zůstaly zapnuté");
    await expect
      .poll(() => page.evaluate(() => window.__maposMap?.getStyle().name ?? ""))
      .toBe("MapOS Tourist Fallback");
    await expect
      .poll(() => page.evaluate(() => Boolean(window.__maposMap?.getLayer("raster-tile-cyclosm"))))
      .toBe(true);
  });
});
