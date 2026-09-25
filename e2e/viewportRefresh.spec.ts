import { expect, test } from "./fixtures/offlineTest";

const EMPTY = { type: "FeatureCollection", features: [] };

/**
 * Layers used to load once and then sit still: panning to the next village kept showing the pins
 * of the village behind you, with a Search here button where the new places should have been.
 * An ordinary pan now refetches; only a jump far enough to be a different question waits to be
 * asked.
 */
test.describe("viewport refresh", () => {
  test("an ordinary pan refetches without asking", async ({ page }) => {
    const requested: string[] = [];
    await page.route("**/layers/osm-poi/features**", async (route) => {
      requested.push(route.request().url());
      // Without this the browser answers the identical follow-up URL from its memory cache and
      // the refetch never reaches this handler.
      await route.fulfill({ json: EMPTY, headers: { "cache-control": "no-store" } });
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/?layers=osm-poi&lng=13.3775&lat=49.7475&z=14");
    await expect.poll(() => requested.length, { timeout: 30_000 }).toBeGreaterThan(0);

    const initial = requested.length;
    // Cross a tile-snapped cache boundary while staying within the automatic refresh distance.
    await page.evaluate(() => {
      window.__maposMap?.panBy([650, 180], { duration: 0 });
    });
    await expect.poll(() => requested.length, { timeout: 20_000 }).toBeGreaterThan(initial);
    await expect(page.getByTestId("search-here")).toHaveCount(0);
  });

  test("a jump across the country asks first, and asking refetches", async ({ page }) => {
    const requested: string[] = [];
    await page.route("**/layers/osm-poi/features**", async (route) => {
      requested.push(route.request().url());
      // Without this the browser answers the identical follow-up URL from its memory cache and
      // the refetch never reaches this handler.
      await route.fulfill({ json: EMPTY, headers: { "cache-control": "no-store" } });
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/?layers=osm-poi&lng=13.3775&lat=49.7475&z=14");
    await expect.poll(() => requested.length, { timeout: 30_000 }).toBeGreaterThan(0);

    // Plzeň to Prague at street zoom: an Overpass query per move like this would be waste.
    await page.evaluate(() => {
      window.__maposMap?.jumpTo({ center: [14.42, 50.08], zoom: 14 });
    });
    await page.getByRole("button", { name: "Map status", exact: true }).click();
    const button = page.getByTestId("search-here");
    await expect(button).toBeVisible({ timeout: 20_000 });

    // The button disables itself while the layer is in flight; asking again is only meaningful
    // once the previous answer has landed.
    await expect(button).toBeEnabled({ timeout: 20_000 });
    const asked = requested.length;
    await button.click();
    await expect.poll(() => requested.length, { timeout: 20_000 }).toBeGreaterThan(asked);
    await expect(button).toHaveCount(0);
  });
});

test("partial POI results render immediately and later sources appear without moving the map", async ({
  page
}) => {
  let calls = 0;
  let release!: () => void;
  const later = new Promise<void>((resolve) => {
    release = resolve;
  });
  const point = (id: string, lng: number) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [lng, 49.7475] },
    properties: { id, name: id, category: "castle", layerId: "osm-poi" }
  });
  await page.route("**/layers/osm-poi/features**", async (route) => {
    calls++;
    const first = calls === 1;
    if (!first) await later;
    await route.fulfill({
      headers: { "cache-control": "no-store" },
      json: {
        type: "FeatureCollection",
        features: first
          ? [point("Local place", 13.3775)]
          : [point("Local place", 13.3775), point("Later place", 13.3785)],
        query: first
          ? { status: "partial", retryAfterMs: 1000, cacheTtlMs: 0 }
          : { status: "complete" },
        meta: {
          merged: 0,
          sources: [
            { source: "osm", state: "ready", count: 1 },
            { source: "wikipedia", state: first ? "loading" : "ready", count: first ? 0 : 1 }
          ]
        }
      }
    });
  });
  try {
    await page.goto("/?layers=osm-poi&lng=13.3775&lat=49.7475&z=16");
    const names = () =>
      page.evaluate(
        () => window.__maposMap?.queryRenderedFeatures().map((f) => f.properties?.name) ?? []
      );
    await expect.poll(names).toContain("Local place");
    expect(await names()).not.toContain("Later place");
    release();
    await expect.poll(names, { timeout: 15000 }).toContain("Later place");
    expect(calls).toBeGreaterThanOrEqual(2);
  } finally {
    release();
  }
});
