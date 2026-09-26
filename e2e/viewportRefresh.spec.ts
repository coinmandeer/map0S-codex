import { expect, test, type Page } from "./fixtures/offlineTest";

const EMPTY = { type: "FeatureCollection", features: [] };

/**
 * Layers used to load once and then sit still: panning to the next village kept showing the pins
 * of the village behind you, with a Search here button where the new places should have been.
 * An ordinary pan now refetches; only a jump far enough to be a different question waits to be
 * asked, and the question floats over the map instead of hiding in the Map status popover.
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
    const requested = await recordPoiRequests(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/?layers=osm-poi&lng=13.3775&lat=49.7475&z=14");
    await expect.poll(() => requested.length, { timeout: 30_000 }).toBeGreaterThan(0);

    // Plzeň to Prague at street zoom: an Overpass query per move like this would be waste.
    await page.evaluate(() => {
      window.__maposMap?.jumpTo({ center: [14.42, 50.08], zoom: 14 });
    });
    // The question floats over the map; nothing has to be opened to find it.
    const button = page.getByTestId("search-here");
    await expect(button).toBeVisible({ timeout: 20_000 });
    await expect(button).toHaveText(/Search this area/);
    const asked = requested.length;
    await button.click();
    await expect.poll(() => requested.length, { timeout: 20_000 }).toBeGreaterThan(asked);
    expect(centre(requested.at(-1)!)[0]).toBeCloseTo(14.42, 1);
    await expect(button).toHaveCount(0);
  });

  test("a long drag offers Search this area and pressing it loads the new view", async ({
    page
  }) => {
    const requested = await recordPoiRequests(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/?layers=osm-poi&lng=13.3775&lat=49.7475&z=14");
    await expect.poll(() => requested.length, { timeout: 30_000 }).toBeGreaterThan(0);
    await settle(page, requested);

    const before = requested.length;
    await dragMap(page, -1200, 0);
    const button = page.getByTestId("search-here");
    await expect(button).toBeVisible({ timeout: 20_000 });
    expect(requested.length, "a move of more than a screen waits to be asked").toBe(before);

    await button.click();
    await expect.poll(() => requested.length, { timeout: 20_000 }).toBeGreaterThan(before);
    const view = await page.evaluate(() => window.__maposMap!.getCenter().toArray());
    expect(centre(requested.at(-1)!)[0]).toBeCloseTo(view[0]!, 1);
    await expect(button).toHaveCount(0);
  });

  test("a place picked in search loads at the destination without asking", async ({ page }) => {
    const requested = await recordPoiRequests(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/?layers=osm-poi&lng=13.3775&lat=49.7475&z=14");
    await expect.poll(() => requested.length, { timeout: 30_000 }).toBeGreaterThan(0);

    await page.getByTestId("place-search").fill("Praha");
    await page.getByRole("option", { name: /Praha/ }).first().click();
    // The request waits for the flight to land instead of reloading the view being left, so
    // Prague's pins arrive by themselves.
    await expect
      .poll(() => requested.some((url) => Math.abs(centre(url)[0] - 14.42) < 0.1), {
        timeout: 20_000
      })
      .toBe(true);
    await settle(page, requested);
    await expect(page.getByTestId("search-here")).toHaveCount(0);
  });

  test("with manual refresh a drag loads nothing until the reader asks", async ({ page }) => {
    const requested = await recordPoiRequests(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/?layers=osm-poi&lng=13.3775&lat=49.7475&z=14");
    await expect.poll(() => requested.length, { timeout: 30_000 }).toBeGreaterThan(0);

    await page.getByTestId("settings-btn").click();
    const toggle = page.getByTestId("search-here-toggle");
    await toggle.click();
    await expect(toggle).toBeChecked();
    await page.keyboard.press("Escape");
    await settle(page, requested);

    const before = requested.length;
    // Past the fetched tiles but under a screen: the automatic mode would refetch this by itself.
    await dragMap(page, -700, 0);
    const button = page.getByTestId("search-here");
    await expect(button).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(800);
    expect(requested.length).toBe(before);

    await button.click();
    await expect.poll(() => requested.length, { timeout: 20_000 }).toBeGreaterThan(before);
    await expect(button).toHaveCount(0);
  });
});

async function recordPoiRequests(page: Page): Promise<string[]> {
  const requested: string[] = [];
  await page.route("**/layers/osm-poi/features**", async (route) => {
    requested.push(route.request().url());
    // Without this the browser answers the identical follow-up URL from its memory cache and
    // the refetch never reaches this handler.
    await route.fulfill({ json: EMPTY, headers: { "cache-control": "no-store" } });
  });
  return requested;
}

/** Centre of the bbox a layer request asked for. */
function centre(url: string): [number, number] {
  const [w, s, e, n] = new URL(url).searchParams.get("bbox")!.split(",").map(Number);
  return [(w! + e!) / 2, (s! + n!) / 2];
}

/** Waits until requests stop and the map is idle, so a count taken next means something. */
async function settle(page: Page, requested: string[]) {
  await expect
    .poll(
      async () => {
        const count = requested.length;
        await page.waitForTimeout(800);
        return (
          requested.length === count &&
          (await page.evaluate(() => !window.__maposMap!.isMoving() && window.__maposMap!.loaded()))
        );
      },
      { timeout: 30_000 }
    )
    .toBe(true);
}

/** A real pointer drag, which is what marks a move as the reader's own. */
async function dragMap(page: Page, dx: number, dy: number) {
  const box = (await page.locator(".maplibregl-canvas").boundingBox())!;
  // Start near the edge the drag moves away from, so the whole gesture stays on screen.
  const x = dx < 0 ? box.x + box.width - 40 : box.x + 40;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 12 });
  // Stop before releasing so the drag ends without inertia carrying the map further.
  await page.waitForTimeout(150);
  await page.mouse.up();
  // Released over the side panel, MapLibre ends the drag on the next pointer move (as it does
  // for a real mouse, which never stands perfectly still).
  await page.mouse.move(x + dx + 2, y + dy + 2);
}

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
