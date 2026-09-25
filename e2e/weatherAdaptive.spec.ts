import type { Page } from "@playwright/test";
import { openCatalogSettings } from "./fixtures/mapPanel";
import { expect, test } from "./fixtures/offlineTest";

test.use({ hasTouch: true });

function weatherGrid(url: string) {
  const params = new URL(url).searchParams;
  const bbox = (params.get("bbox") ?? "13,49,14,50").split(",").map(Number);
  const cols = Number(params.get("cols") ?? 8);
  const rows = Number(params.get("rows") ?? 6);
  const variable = params.get("variable") ?? "temperature";
  const unit = variable === "temperature" ? "°C" : variable === "clouds" ? "%" : "m/s";
  const label =
    variable === "temperature" ? "Teplota" : variable === "clouds" ? "Oblačnost" : "Vítr";
  const values = Array.from({ length: cols * rows }, (_, index) => {
    const row = Math.floor(index / cols);
    const col = index % cols;
    return Number((17 + col * 0.6 - row * 0.35).toFixed(1));
  });
  const sorted = [...values].sort((a, b) => a - b);
  return {
    variable,
    label,
    unit,
    bbox,
    cols,
    rows,
    values,
    min: sorted[0],
    max: sorted.at(-1),
    median: sorted[Math.floor(sorted.length / 2)],
    sampleCount: values.length,
    validAt: "2026-09-02T12:00:00.000Z",
    generatedAt: "2026-09-02T11:55:00.000Z"
  };
}

/** A point on the canvas that really hits a rendered weather sector.
 *
 *  The grid is rebuilt whenever the camera settles, and the camera now carries the chrome's
 *  padding, so a point derived from one serialisation of the source can be stale by the time it
 *  is used. This retries until a sector is both on canvas and hit-testable. */
async function hittableSectorPoint(page: Page): Promise<{ x: number; y: number }> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const point = await page.evaluate(() => {
      const map = window.__maposMap;
      if (!map?.getLayer("fill-weather-temperature-sectors")) return null;
      const source = map.getSource("source-weather-temperature-sectors") as
        { serialize?: () => { data?: GeoJSON.FeatureCollection } } | undefined;
      const sectors = (source?.serialize?.().data?.features ?? []).filter(
        (feature) => feature.properties?.kind === "sector"
      );
      const rect = map.getCanvas().getBoundingClientRect();
      // Middle out: the centre of the viewport is the least likely to be clipped.
      const order = sectors
        .map((sector, index) => ({ sector, index }))
        .sort(
          (a, b) => Math.abs(a.index - sectors.length / 2) - Math.abs(b.index - sectors.length / 2)
        );
      for (const { sector } of order) {
        const ring = (sector.geometry as GeoJSON.Polygon).coordinates[0]!;
        const lng = (Math.min(...ring.map(([x]) => x)) + Math.max(...ring.map(([x]) => x))) / 2;
        const lat = (Math.min(...ring.map(([, y]) => y)) + Math.max(...ring.map(([, y]) => y))) / 2;
        const projected = map.project([lng, lat]);
        if (
          projected.x < 1 ||
          projected.y < 1 ||
          projected.x > rect.width - 1 ||
          projected.y > rect.height - 1
        )
          continue;
        if (
          !map.queryRenderedFeatures([projected.x, projected.y], {
            layers: ["fill-weather-temperature-sectors"]
          }).length
        )
          continue;
        return { x: rect.left + projected.x, y: rect.top + projected.y };
      }
      return null;
    });
    if (point) return point;
    await page.waitForTimeout(250);
  }
  throw new Error("no weather sector became hit-testable");
}

async function selectWeather(page: Page, id: "temperature" | "clouds") {
  if (!(await page.getByTestId("overflow-menu").isVisible()))
    await page.getByTestId("layers-btn").click();
  await page.getByTestId("layers-search").fill("weather");
  const radar = page.getByTestId("weather-switch-weather-radar");
  if (await radar.isChecked()) await radar.click();
  const selected = page.getByTestId(`weather-switch-weather-${id}`);
  if (!(await selected.isChecked())) await selected.click();
  // A second weather field is additive; switching it off must keep the temperature source.
  if (id === "temperature") {
    const clouds = page.getByTestId("weather-switch-weather-clouds");
    if (await clouds.isChecked()) await clouds.click();
  }
  await expect(selected).toBeChecked();
  await page.getByTestId("right-utility-close").click();
}

test.describe("adaptive weather map UI", () => {
  test("switches forecast models without recreating the map", async ({ page }) => {
    test.setTimeout(120_000);
    const requestedModels: string[] = [];
    await page.route(/\/api\/weather\/grid\?/u, (route) => {
      const url = route.request().url();
      requestedModels.push(new URL(url).searchParams.get("model") ?? "missing");
      return route.fulfill({ json: weatherGrid(url) });
    });
    await page.goto("/?mode=weather&lng=14.42&lat=50.08&z=5");
    await expect(page.getByTestId("mode-bar")).toBeVisible({ timeout: 60_000 });
    await selectWeather(page, "temperature");
    await expect.poll(() => requestedModels.includes("best_match")).toBe(true);
    await page.evaluate(() => {
      (window as typeof window & { __weatherModelMap?: Window["__maposMap"] }).__weatherModelMap =
        window.__maposMap;
    });
    await openCatalogSettings(page, "weather-temperature");
    for (const model of ["icon_seamless", "chmi_aladin_seamless"]) {
      await page.getByTestId("weather-model-weather-temperature").selectOption(model);
      await expect.poll(() => requestedModels.includes(model)).toBe(true);
      await expect(page.getByTestId("weather-model-weather-temperature")).toHaveValue(model);
    }
    await expect(page.getByTestId("weather-settings-weather-temperature")).toContainText(
      /2[,.]3 km/
    );
    expect(
      await page.evaluate(
        () =>
          window.__maposMap ===
          (window as typeof window & { __weatherModelMap?: Window["__maposMap"] }).__weatherModelMap
      )
    ).toBe(true);
  });

  test("keeps an existing coloured source stable and exposes equal hover/tap cell detail", async ({
    page
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const gridRequests: string[] = [];
    await page.route(/\/api\/weather\/grid\?/u, (route) => {
      gridRequests.push(route.request().url());
      return route.fulfill({ json: weatherGrid(route.request().url()) });
    });
    await page.route(/\/api\/layers\/osm-poi\/features/u, (route) =>
      route.fulfill({ json: { type: "FeatureCollection", features: [] } })
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/?mode=weather&lng=13.3775&lat=49.7475&z=5");
    await page.waitForTimeout(1_000);
    expect(pageErrors).toEqual([]);
    await expect(page.getByTestId("mode-bar")).toBeVisible({ timeout: 30_000 });

    await selectWeather(page, "temperature");
    await expect(page.getByTestId("weather-legend")).toContainText("regionální pole", {
      timeout: 20_000
    });
    await expect
      .poll(() =>
        page.evaluate(() => Boolean(window.__maposMap?.getLayer("raster-weather-temperature-grid")))
      )
      .toBe(true);
    await page.screenshot({ path: "e2e/screenshots/1440-weather-regional.png", fullPage: true });

    await page.evaluate(() => {
      const scope = window as typeof window & {
        __weatherMapBefore?: Window["__maposMap"];
        __weatherSourceBefore?: unknown;
        __weatherStyleLoads?: number;
      };
      scope.__weatherMapBefore = window.__maposMap;
      scope.__weatherSourceBefore = window.__maposMap?.getSource("source-weather-temperature-grid");
      scope.__weatherStyleLoads = 0;
      window.__maposMap?.on("style.load", () => {
        scope.__weatherStyleLoads = (scope.__weatherStyleLoads ?? 0) + 1;
      });
    });

    await selectWeather(page, "clouds");
    await expect(page.getByTestId("weather-legend")).toContainText("Oblačnost");
    await selectWeather(page, "temperature");
    await expect(page.getByTestId("weather-legend")).toContainText("Teplota");
    expect(
      await page.evaluate(() => {
        const scope = window as typeof window & {
          __weatherMapBefore?: Window["__maposMap"];
          __weatherSourceBefore?: unknown;
          __weatherStyleLoads?: number;
        };
        return {
          sameMap: scope.__weatherMapBefore === window.__maposMap,
          sameSource:
            scope.__weatherSourceBefore ===
            window.__maposMap?.getSource("source-weather-temperature-grid"),
          styleLoads: scope.__weatherStyleLoads,
          gridLayers:
            window.__maposMap
              ?.getStyle()
              .layers?.filter((layer) => layer.id === "raster-weather-temperature-grid").length ?? 0
        };
      })
    ).toEqual({ sameMap: true, sameSource: true, styleLoads: 0, gridLayers: 1 });

    const panel = page.getByTestId("discover-panel");
    if (await panel.isVisible()) await panel.getByRole("button", { name: "Close" }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    const localRequestBaseline = gridRequests.length;
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          window.__maposMap!.resize();
          window.__maposMap!.jumpTo({ zoom: 11 });
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        })
    );
    // Each camera settles into one bounded replacement; presentation may interpolate it
    // into more cells without pretending those are additional provider measurements.
    await expect.poll(() => gridRequests.length).toBeGreaterThan(localRequestBaseline);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const map = window.__maposMap;
          if (!map?.getLayer("fill-weather-temperature-sectors")) return 0;
          const source = map.getSource("source-weather-temperature-sectors") as
            { serialize?: () => { data?: GeoJSON.FeatureCollection } } | undefined;
          return (
            source
              ?.serialize?.()
              .data?.features.filter((feature) => feature.properties?.kind === "sector").length ?? 0
          );
        })
      )
      .toBeGreaterThan(0);
    await expect
      .poll(() =>
        page.evaluate(() => window.__maposMap!.isSourceLoaded("source-weather-temperature-sectors"))
      )
      .toBe(true);

    // Hover and tap must read the same field. After the phone resize a late padding change (the
    // sheet settling) can still move the camera and replace the grid once, which on a slow runner
    // landed between the two and made them disagree; wait until the requests stop and the map is
    // idle before choosing the point.
    await expect
      .poll(
        async () => {
          const before = gridRequests.length;
          await page.waitForTimeout(1_000);
          return (
            gridRequests.length === before &&
            (await page.evaluate(
              () => !window.__maposMap!.isMoving() && window.__maposMap!.loaded()
            ))
          );
        },
        { timeout: 30_000 }
      )
      .toBe(true);

    const point = await hittableSectorPoint(page);
    await page.mouse.move(point.x, point.y);
    const detail = page.getByTestId("weather-map-detail");
    await expect(detail).toContainText("Náhled v mapě");
    const hoverValue = await detail.locator("strong").innerText();
    await detail.getByRole("button", { name: "Skrýt detail počasí" }).click();

    await page.touchscreen.tap(point.x, point.y);
    await expect(detail).toContainText("Vybrané místo");
    await expect(detail.locator("strong")).toHaveText(hoverValue);
    await expect(detail).toContainText("Teplota");
    await page.screenshot({ path: "e2e/screenshots/390-weather-local-tap.png", fullPage: true });

    expect(gridRequests.length).toBeGreaterThanOrEqual(4);
    expect(gridRequests.every((url) => new URL(url).searchParams.get("cols") !== null)).toBe(true);
  });

  test("loads a bounded grid and prints sector values at city zoom", async ({ page }) => {
    const gridRequests: string[] = [];
    await page.route(/\/api\/weather\/grid\?/u, (route) => {
      gridRequests.push(route.request().url());
      return route.fulfill({ json: weatherGrid(route.request().url()) });
    });
    await page.route(/\/api\/layers\/osm-poi\/features/u, (route) =>
      route.fulfill({ json: { type: "FeatureCollection", features: [] } })
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/?mode=weather&lng=13.3775&lat=49.7475&z=12");

    await selectWeather(page, "temperature");

    await expect.poll(() => gridRequests.length, { timeout: 20_000 }).toBeGreaterThan(0);
    for (const request of gridRequests) {
      const params = new URL(request).searchParams;
      const samples = Number(params.get("cols")) * Number(params.get("rows"));
      expect(samples).toBeGreaterThan(0);
      expect(samples).toBeLessThanOrEqual(400);
    }

    // The numeric labels are real rendered symbols, not just features in the source — this is
    // what regressed when the label font was missing from the basemap's glyph set.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const map = window.__maposMap;
            if (!map?.getLayer("symbol-weather-temperature-values")) return 0;
            return map.queryRenderedFeatures(undefined, {
              layers: ["symbol-weather-temperature-values"]
            }).length;
          }),
        { timeout: 20_000 }
      )
      .toBeGreaterThan(0);
  });
});
