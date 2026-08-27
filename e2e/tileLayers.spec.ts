import { expect, test } from "@playwright/test";

/** A 1x1 transparent PNG, so the specs never depend on the real tile servers being up. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

async function stubTiles(page: import("@playwright/test").Page) {
  for (const pattern of [
    "**/*.tile-cyclosm.openstreetmap.fr/**",
    "**/tile.waymarkedtrails.org/**",
    "**/*.tiles.openrailwaymap.org/**",
    "**/tiles.openseamap.org/**",
    "**/*.tile.opentopomap.org/**",
    "**/tiles.opensnowmap.org/**"
  ]) {
    await page.route(pattern, (route) => route.fulfill({ contentType: "image/png", body: PNG }));
  }
}

test.describe("keyless tile overlays", () => {
  test("each registered overlay appears in the layers menu", async ({ page }) => {
    await stubTiles(page);
    await page.goto("/");
    await page.getByTestId("overflow-btn").click();
    await expect(page.getByTestId("overflow-menu")).toBeVisible();

    for (const id of [
      "cyclosm",
      "waymarked-trails",
      "openrailwaymap",
      "openseamap",
      "opentopomap",
      "opensnowmap"
    ]) {
      await expect(page.getByTestId(`overflow-${id}`)).toBeVisible();
    }
  });

  test("toggling an overlay requests its tiles and keeps the map alive", async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (err) => pageErrors.push(err));

    const requested: string[] = [];
    await page.route("**/*.tile-cyclosm.openstreetmap.fr/**", (route) => {
      requested.push(route.request().url());
      return route.fulfill({ contentType: "image/png", body: PNG });
    });

    await page.goto("/");
    await page.getByTestId("overflow-btn").click();
    await page.getByTestId("overflow-cyclosm").click();

    await expect.poll(() => requested.length, { timeout: 15_000 }).toBeGreaterThan(0);
    expect(pageErrors, pageErrors.map((e) => e.message).join("\n")).toHaveLength(0);
  });

  test("turning an overlay off removes it from the map", async ({ page }) => {
    await stubTiles(page);
    await page.goto("/");
    await page.getByTestId("overflow-btn").click();
    await page.getByTestId("overflow-opentopomap").click();

    const layerId = "raster-tile-opentopomap";
    await expect
      .poll(() => page.evaluate((id) => Boolean(window.__maposMap?.getLayer(id)), layerId), {
        timeout: 15_000
      })
      .toBe(true);

    await page.getByTestId("overflow-opentopomap").click();
    // Detach has to actually remove source and layer; leaving them behind would keep MapLibre
    // fetching tiles for an overlay the user switched off.
    await expect
      .poll(() => page.evaluate((id) => Boolean(window.__maposMap?.getLayer(id)), layerId), {
        timeout: 15_000
      })
      .toBe(false);
  });
});
