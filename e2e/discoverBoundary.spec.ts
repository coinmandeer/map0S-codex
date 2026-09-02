import { expect, test } from "./fixtures/offlineTest";
import { discoverContextFixture, stubDiscoverContext } from "./fixtures/discoverContext";

const boundary = {
  type: "Polygon" as const,
  coordinates: [
    [
      [13.2, 49.6],
      [13.6, 49.6],
      [13.6, 49.9],
      [13.2, 49.9],
      [13.2, 49.6]
    ]
  ]
};

const neighbouringBoundary = {
  type: "Polygon" as const,
  coordinates: [
    [
      [13.62, 49.62],
      [13.82, 49.62],
      [13.82, 49.88],
      [13.62, 49.88],
      [13.62, 49.62]
    ]
  ]
};

test.describe("map-first Discover boundary", () => {
  test("makes the selected preset visible and sends it into the context pipeline", async ({
    page
  }) => {
    const requestedUseCases: string[] = [];
    await page.route("**/v2/discover/context**", (route) => {
      requestedUseCases.push(new URL(route.request().url()).searchParams.get("useCase") ?? "");
      return route.fulfill({
        json: discoverContextFixture({
          statistics: [
            {
              id: "population",
              label: "Počet obyvatel",
              value: 614640,
              unit: "people",
              scope: {
                regionId: "nominatim:relation:439840",
                regionName: "Plzeň",
                level: "locality"
              },
              year: 2025,
              uncertainty: "reported-community-data",
              uncertaintyLabel:
                "Publikovaný údaj z otevřených komunitních dat; může se lišit od aktuální oficiální statistiky.",
              sourceIds: ["wikidata:Q46070"]
            },
            {
              id: "gdp-per-capita",
              label: "Regionální HDP na obyvatele",
              value: 25300,
              unit: "eur-per-person",
              scope: {
                regionId: "nominatim:relation:442466",
                regionName: "Plzeňský kraj",
                level: "admin1",
                geographicCode: "CZ032"
              },
              year: 2024,
              uncertainty: "regional-aggregate",
              uncertaintyLabel:
                "Roční regionální agregát v běžných cenách; není to průměrná mzda domácnosti ani předpověď.",
              sourceIds: ["eurostat:nama_10r_3gdp"]
            }
          ],
          sources: [
            {
              id: "nominatim-osm",
              label: "OpenStreetMap Nominatim",
              attribution: "© OpenStreetMap přispěvatelé",
              url: "https://www.openstreetmap.org/copyright",
              license: "ODbL 1.0",
              fetchedAt: "2026-09-01T12:00:00.000Z"
            },
            {
              id: "wikidata:Q46070",
              label: "Wikidata",
              attribution: "Wikidata contributors",
              url: "https://www.wikidata.org/wiki/Q46070",
              license: "CC0 1.0",
              fetchedAt: "2026-09-01T12:00:00.000Z"
            },
            {
              id: "eurostat:nama_10r_3gdp",
              label: "Eurostat · nama_10r_3gdp",
              attribution: "Eurostat",
              url: "https://ec.europa.eu/eurostat/databrowser/view/nama_10r_3gdp/default/table",
              license: "Eurostat reuse policy",
              fetchedAt: "2026-09-01T12:00:00.000Z"
            }
          ]
        })
      });
    });
    await page.route(/\/api\/layers\/osm-poi\/features/u, (route) =>
      route.fulfill({
        json: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [13.378, 49.748] },
              properties: {
                id: "city-cafe",
                name: "Kavárna u náměstí",
                category: "cafe",
                layerId: "osm-poi"
              }
            }
          ]
        }
      })
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/?mode=discover&lng=13.3775&lat=49.7475&z=10");

    const useCase = page.getByTestId("discover-usecase");
    await expect(useCase).toBeVisible();
    await page.getByTestId("discover-preset-city").click();
    await expect(useCase).toHaveAttribute("data-active-preset", "city");
    await expect(page.getByTestId("discover-preset-city")).toHaveAttribute("aria-pressed", "true");
    await expect(useCase).toContainText("Město");
    await expect(useCase).toContainText("Kavárna u náměstí");
    const statistics = page.getByTestId("discover-statistics");
    await expect(statistics).toContainText("614 640");
    await expect(statistics).toContainText("2025");
    await expect(statistics).toContainText("Wikidata");
    await expect(statistics).toContainText("Regionální HDP na obyvatele");
    await expect(statistics).toContainText("2024");
    await expect(statistics).toContainText("CZ032");
    await expect(statistics).toContainText("Eurostat");
    await expect.poll(() => requestedUseCases.filter((value) => value === "city").length).toBe(1);
    await page.screenshot({ path: "e2e/screenshots/1440-discover-usecase.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await statistics.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "e2e/screenshots/390-discover-usecase.png", fullPage: true });
  });

  test("registers one cancellable context task for the explicit map action", async ({ page }) => {
    let requestCount = 0;
    let releaseRequest!: () => void;
    const requestGate = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    await page.route("**/v2/discover/context**", async (route) => {
      requestCount += 1;
      await requestGate;
      await route.fulfill({ json: discoverContextFixture() });
    });
    await page.route(/\/api\/layers\/osm-poi\/features/u, (route) =>
      route.fulfill({ json: { type: "FeatureCollection", features: [] } })
    );
    await page.goto("/?mode=discover&lng=13.3775&lat=49.7475&z=10");

    const panel = page.getByTestId("discover-panel");
    await panel.getByRole("button", { name: "Zjistit co je tady" }).click();
    const center = page.getByTestId("task-center");
    await expect(center).toBeVisible();
    await expect.poll(() => requestCount).toBe(1);
    await center.getByRole("button", { name: /1 aktivní/u }).click();
    await expect(center.getByTestId("task-center-entry")).toHaveCount(1);
    await expect(center).toContainText("Zjišťuji kontext oblasti");
    await expect(center.getByRole("button", { name: "Zrušit" })).toHaveCount(1);

    releaseRequest();
    await expect(center).toHaveCount(0);
    await expect(panel.getByText("Kontext odpovídá tomuto výřezu.")).toBeVisible();
    expect(requestCount).toBe(1);
  });

  test("keeps a sourced polygon visible after the panel closes and reopens it on click", async ({
    page
  }) => {
    await stubDiscoverContext(page, {
      boundary: {
        status: "ready",
        geometry: boundary,
        reason: "Simplified OpenStreetMap administrative geometry.",
        sourceId: "nominatim-osm"
      }
    });
    await page.route(/\/api\/layers\/osm-poi\/features/u, (route) =>
      route.fulfill({ json: { type: "FeatureCollection", features: [] } })
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/?mode=discover&lng=13.3775&lat=49.7475&z=10");

    const panel = page.getByTestId("discover-panel");
    await expect(panel).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("discover-boundary-ready")).toBeVisible();
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const map = window.__maposMap;
            if (!map?.getLayer("discover-fill")) return 0;
            return map.queryRenderedFeatures(map.project([13.3775, 49.7475]), {
              layers: ["discover-fill"]
            }).length;
          }),
        { timeout: 20_000 }
      )
      .toBeGreaterThan(0);

    await panel.getByRole("button", { name: "Zavřít" }).click();
    await expect(panel).toHaveCount(0);
    const point = await page.evaluate(() => {
      const map = window.__maposMap!;
      const projected = map.project([13.3775, 49.7475]);
      const rect = map.getCanvas().getBoundingClientRect();
      return { x: rect.left + projected.x, y: rect.top + projected.y };
    });
    await page.mouse.click(point.x, point.y);

    await expect(panel).toBeVisible();
    await expect(page.getByTestId("toast")).toContainText("Vybraná oblast: Plzeň");

    await page.getByRole("button", { name: "Ukázat celou" }).click();
    await expect.poll(() => page.evaluate(() => window.__maposMap?.isMoving() ?? true)).toBe(false);
    expect(
      await page.evaluate(() => {
        const bounds = window.__maposMap!.getBounds();
        return bounds.contains([13.2, 49.6]) && bounds.contains([13.6, 49.9]);
      })
    ).toBe(true);
  });

  test("shows one regional catalogue level and selects a neighbouring polygon directly", async ({
    page
  }) => {
    const requestedCenters: number[] = [];
    await page.route("**/v2/discover/context**", (route) => {
      requestedCenters.push(Number(new URL(route.request().url()).searchParams.get("lng")));
      return route.fulfill({
        json: discoverContextFixture({
          boundary: {
            status: "ready",
            geometry: boundary,
            reason: "Simplified OpenStreetMap administrative geometry.",
            sourceId: "nominatim-osm"
          },
          regionCatalogue: {
            nutsLevel: 3,
            truncated: false,
            sourceId: "eurostat-gisco-nuts-2024",
            regions: [
              {
                id: "nuts:CZ041",
                code: "CZ041",
                name: "Karlovarský kraj",
                nutsLevel: 3,
                geometry: neighbouringBoundary,
                sourceId: "eurostat-gisco-nuts-2024"
              }
            ]
          }
        })
      });
    });
    await page.route(/\/api\/layers\/osm-poi\/features/u, (route) =>
      route.fulfill({ json: { type: "FeatureCollection", features: [] } })
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/?mode=discover&lng=13.3775&lat=49.7475&z=10");

    const options = page.getByTestId("discover-region-options");
    await expect(options).toContainText("Karlovarský kraj");
    await expect(options).toContainText("NUTS 3");
    await expect
      .poll(() =>
        page.evaluate(() => {
          const source = window.__maposMap?.getSource("discover-regions") as
            { serialize?: () => { data?: GeoJSON.FeatureCollection } } | undefined;
          return source?.serialize?.().data?.features.map((feature) => feature.properties?.kind);
        })
      )
      .toEqual(["candidate", "selected"]);

    await options.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "e2e/screenshots/1440-discover-regions.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await options.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "e2e/screenshots/390-discover-regions.png", fullPage: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          window.__maposMap!.resize();
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        })
    );
    await expect
      .poll(() =>
        page.evaluate(() => {
          const map = window.__maposMap!;
          return map
            .queryRenderedFeatures(map.project([13.72, 49.75]), { layers: ["discover-fill"] })
            .some((feature) => feature.properties?.kind === "candidate");
        })
      )
      .toBe(true);

    const point = await page.evaluate(() => {
      const projected = window.__maposMap!.project([13.72, 49.75]);
      const rect = window.__maposMap!.getCanvas().getBoundingClientRect();
      return { x: rect.left + projected.x, y: rect.top + projected.y };
    });
    await page.mouse.click(point.x, point.y);
    await expect(page.getByTestId("toast")).toContainText("Přepínám na oblast: Karlovarský kraj");
    await expect
      .poll(() => page.evaluate(() => window.__maposMap!.getCenter().lng))
      .toBeGreaterThan(13.65);
    await expect.poll(() => requestedCenters.some((lng) => lng > 13.65)).toBe(true);
  });

  test("replaces the visible catalogue level when the map crosses a zoom band", async ({
    page
  }) => {
    const requestedZooms: number[] = [];
    await page.route("**/v2/discover/context**", (route) => {
      const zoom = Number(new URL(route.request().url()).searchParams.get("zoom"));
      requestedZooms.push(zoom);
      const countryLevel = zoom <= 4;
      const localityLevel = zoom > 10;
      return route.fulfill({
        json: discoverContextFixture({
          region: countryLevel
            ? {
                id: "nominatim:relation:51684",
                name: "Česko",
                level: "country",
                countryCode: "CZ",
                hierarchy: [{ name: "Česko", level: "country" }]
              }
            : localityLevel
              ? discoverContextFixture().region
              : {
                  id: "nominatim:relation:442466",
                  name: "Plzeňský kraj",
                  level: "admin1",
                  countryCode: "CZ",
                  hierarchy: [
                    { name: "Česko", level: "country" },
                    { name: "Plzeňský kraj", level: "admin1" }
                  ]
                },
          boundary: {
            status: "ready",
            geometry: boundary,
            reason: "Simplified OpenStreetMap administrative geometry.",
            sourceId: "nominatim-osm"
          },
          regionCatalogue: localityLevel
            ? null
            : {
                nutsLevel: countryLevel ? 0 : 3,
                truncated: false,
                sourceId: "eurostat-gisco-nuts-2024",
                regions: [
                  {
                    id: countryLevel ? "nuts:DE" : "nuts:CZ041",
                    code: countryLevel ? "DE" : "CZ041",
                    name: countryLevel ? "Deutschland" : "Karlovarský kraj",
                    nutsLevel: countryLevel ? 0 : 3,
                    geometry: neighbouringBoundary,
                    sourceId: "eurostat-gisco-nuts-2024"
                  }
                ]
              }
        })
      });
    });
    await page.route(/\/api\/layers\/osm-poi\/features/u, (route) =>
      route.fulfill({ json: { type: "FeatureCollection", features: [] } })
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/?mode=discover&lng=13.3775&lat=49.7475&z=4");

    const options = page.getByTestId("discover-region-options");
    await expect(options).toContainText("Deutschland", { timeout: 20_000 });
    await expect(options).toContainText("NUTS 0");

    await page.evaluate(() => window.__maposMap!.jumpTo({ zoom: 7 }));
    await expect(options).toContainText("Karlovarský kraj", { timeout: 20_000 });
    await expect(options).toContainText("NUTS 3");
    await expect(options).not.toContainText("Deutschland");
    await expect
      .poll(() =>
        page.evaluate(() => {
          const source = window.__maposMap?.getSource("discover-regions") as
            { serialize?: () => { data?: GeoJSON.FeatureCollection } } | undefined;
          return source
            ?.serialize?.()
            .data?.features.filter((feature) => feature.properties?.kind === "candidate")
            .map((feature) => feature.properties?.nutsLevel);
        })
      )
      .toEqual([3]);

    await page.evaluate(() => window.__maposMap!.jumpTo({ zoom: 11 }));
    await expect.poll(() => requestedZooms.some((zoom) => zoom >= 11)).toBe(true);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const source = window.__maposMap?.getSource("discover-regions") as
            { serialize?: () => { data?: GeoJSON.FeatureCollection } } | undefined;
          return (
            source
              ?.serialize?.()
              .data?.features.filter((feature) => feature.properties?.kind === "candidate")
              .length ?? -1
          );
        })
      )
      .toBe(0);
    await expect(options).toHaveCount(0);
    await expect(page.getByTestId("discover-panel")).toContainText("město / obec");
    await expect(page.getByTestId("discover-panel")).toContainText("Plzeň");
    expect(requestedZooms.some((zoom) => zoom <= 4)).toBe(true);
    expect(requestedZooms.some((zoom) => zoom >= 7)).toBe(true);
  });

  test("keeps a detailed POI clickable above the regional overlay", async ({ page }) => {
    await stubDiscoverContext(page, {
      boundary: {
        status: "ready",
        geometry: boundary,
        reason: "Simplified OpenStreetMap administrative geometry.",
        sourceId: "nominatim-osm"
      },
      regionCatalogue: {
        nutsLevel: 3,
        truncated: false,
        sourceId: "eurostat-gisco-nuts-2024",
        regions: [
          {
            id: "nuts:CZ041",
            code: "CZ041",
            name: "Karlovarský kraj",
            nutsLevel: 3,
            geometry: neighbouringBoundary,
            sourceId: "eurostat-gisco-nuts-2024"
          }
        ]
      }
    });
    await page.route(/\/api\/layers\/osm-poi\/features/u, (route) =>
      route.fulfill({
        json: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [13.3775, 49.7475] },
              properties: {
                id: "overlay-cafe",
                name: "Kavárna nad hranicí",
                category: "cafe",
                layerId: "osm-poi"
              }
            }
          ]
        }
      })
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/?mode=discover&lng=13.3775&lat=49.7475&z=10");
    await expect(page.getByTestId("discover-boundary-ready")).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const map = window.__maposMap;
          if (!map?.getLayer("pins-osm-poi-pin")) return 0;
          return map.queryRenderedFeatures(map.project([13.3775, 49.7475]), {
            layers: ["pins-osm-poi-pin"]
          }).length;
        })
      )
      .toBeGreaterThan(0);

    const point = await page.evaluate(() => {
      const projected = window.__maposMap!.project([13.3775, 49.7475]);
      const rect = window.__maposMap!.getCanvas().getBoundingClientRect();
      return { x: rect.left + projected.x, y: rect.top + projected.y };
    });
    await page.mouse.click(point.x, point.y);
    await expect(page.getByTestId("pin-detail")).toContainText("Kavárna nad hranicí");
  });
});
