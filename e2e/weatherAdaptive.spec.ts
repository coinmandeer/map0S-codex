import type { Page } from "@playwright/test";
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

async function selectWeather(page: Page, id: "temperature" | "clouds") {
  if (!(await page.getByTestId("overflow-menu").isVisible())) {
    await page.getByTestId("overflow-btn").click();
  }
  await page.locator(`label:has([data-testid="weather-visualization-${id}"])`).click();
  await expect(page.getByTestId(`weather-visualization-${id}`)).toBeChecked();
  await page.keyboard.press("Escape");
}

test.describe("adaptive weather map UI", () => {
  test("keeps one coloured source stable and exposes equal hover/tap cell detail", async ({
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
      .poll(() => page.evaluate(() => Boolean(window.__maposMap?.getLayer("raster-weather-grid"))))
      .toBe(true);
    await page.screenshot({ path: "e2e/screenshots/1440-weather-regional.png", fullPage: true });

    await page.evaluate(() => {
      const scope = window as typeof window & {
        __weatherMapBefore?: Window["__maposMap"];
        __weatherSourceBefore?: unknown;
        __weatherStyleLoads?: number;
      };
      scope.__weatherMapBefore = window.__maposMap;
      scope.__weatherSourceBefore = window.__maposMap?.getSource("source-weather-grid");
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
            scope.__weatherSourceBefore === window.__maposMap?.getSource("source-weather-grid"),
          styleLoads: scope.__weatherStyleLoads,
          gridLayers:
            window.__maposMap
              ?.getStyle()
              .layers?.filter((layer) => layer.id === "raster-weather-grid").length ?? 0
        };
      })
    ).toEqual({ sameMap: true, sameSource: true, styleLoads: 0, gridLayers: 1 });

    const panel = page.getByTestId("discover-panel");
    if (await panel.isVisible()) await panel.getByRole("button", { name: "Zavřít" }).click();
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
    await expect.poll(() => gridRequests.length).toBeGreaterThan(localRequestBaseline);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const map = window.__maposMap;
          if (!map?.getLayer("fill-weather-sectors")) return 0;
          const source = map.getSource("source-weather-sectors") as
            { serialize?: () => { data?: GeoJSON.FeatureCollection } } | undefined;
          return (
            source
              ?.serialize?.()
              .data?.features.filter((feature) => feature.properties?.kind === "sector").length ?? 0
          );
        })
      )
      .toBeGreaterThan(0);

    const point = await page.evaluate(() => {
      const map = window.__maposMap!;
      const source = map.getSource("source-weather-sectors") as {
        serialize: () => { data: GeoJSON.FeatureCollection };
      };
      const sectors = source
        .serialize()
        .data.features.filter((feature) => feature.properties?.kind === "sector");
      const geometry = sectors[Math.floor(sectors.length / 2)]!.geometry as GeoJSON.Polygon;
      const ring = geometry.coordinates[0]!;
      const lng = (Math.min(...ring.map(([x]) => x)) + Math.max(...ring.map(([x]) => x))) / 2;
      const lat = (Math.min(...ring.map(([, y]) => y)) + Math.max(...ring.map(([, y]) => y))) / 2;
      const projected = map.project([lng, lat]);
      const rect = map.getCanvas().getBoundingClientRect();
      return { x: rect.left + projected.x, y: rect.top + projected.y };
    });
    await expect
      .poll(() =>
        page.evaluate(({ x, y }) => {
          const map = window.__maposMap!;
          const rect = map.getCanvas().getBoundingClientRect();
          return map.queryRenderedFeatures([x - rect.left, y - rect.top], {
            layers: ["fill-weather-sectors"]
          }).length;
        }, point)
      )
      .toBeGreaterThan(0);
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
});
