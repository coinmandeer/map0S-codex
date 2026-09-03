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
  if ((await accordion.getAttribute("data-open")) === null) {
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
      "aria-checked",
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
    await expect(page.getByTestId("basemap-osm-carto")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("basemap-carto-voyager")).toHaveAttribute(
      "aria-checked",
      "false"
    );

    await page.keyboard.press("Escape");
    await page.getByTestId("layers-btn").click();
    await page.getByTestId("layers-accordion-world").click();
    const osm = page.getByTestId("layer-source-osm");
    const wikipedia = page.getByTestId("layer-source-wikipedia");
    await expect(osm).toHaveAttribute("aria-checked", "true");
    await expect(wikipedia).toHaveAttribute("aria-checked", "true");
    await wikipedia.click();
    await expect(wikipedia).toHaveAttribute("aria-checked", "false");
    await wikipedia.click();
    await expect(wikipedia).toHaveAttribute("aria-checked", "true");
    await expect(osm).toHaveAttribute("aria-checked", "true");
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

  // §6.6 wave A: the card illustrations. Nothing describes a map style like the style itself,
  // so a card prefers its rendered screenshot — but only some backgrounds have one, because a
  // thumbnail is a copy of the provider's cartography and most keyed providers' terms do not
  // let us ship it. Both halves of that matter, so both are checked.
  test("a card shows its rendered picture, and falls back to a schematic without one", async ({
    page
  }) => {
    await stubTiles(page);
    await page.goto("/");
    await page.getByTestId("basemap-btn").click();

    const rendered = page.getByTestId("basemap-osm-carto").locator(".basemap-preview-image");
    await expect(rendered).toBeVisible();
    // A broken image is still "visible" to a selector, so this asks the browser whether the
    // file actually decoded — a missing asset would otherwise pass.
    await expect
      .poll(() =>
        rendered.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)
      )
      .toBe(true);

    // NASA's daily mosaic stops at z8, so it renders nothing at the shared viewport the cards
    // are shot over and deliberately ships no thumbnail. Its card draws the schematic rather
    // than a black rectangle, which is what the fallback is for.
    await page.getByTestId("basemap-group-satellite").click();
    const fallback = page.getByTestId("basemap-gibs-viirs");
    await expect(fallback.locator(".basemap-preview-water")).toBeVisible();
    await expect(fallback.locator(".basemap-preview-image")).toHaveCount(0);
  });
});
