import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, platform, arch } from "node:os";
import { expect, test } from "./fixtures/offlineTest";
import geojsonvt from "geojson-vt";
import vtpbf from "vt-pbf";

test("Discover renders more than sixteen local regions and hover never loads guide data", async ({
  page
}) => {
  test.setTimeout(100_000);
  const features = Array.from({ length: 25 }, (_, i) => {
    const x = 13 + (i % 5) * 0.2,
      y = 49 + Math.floor(i / 5) * 0.2;
    return {
      type: "Feature",
      properties: {
        id: JSON.stringify(["fixture", "CZ", "adm1", `CZ-${i}`]),
        source: "fixture",
        country: "CZ",
        west: x,
        south: y,
        east: x + 0.2,
        north: y + 0.2,
        code: `CZ-${i}`,
        name: `Region ${i}`,
        level: "adm1",
        kind: "candidate",
        lng: x + 0.1,
        lat: y + 0.1
      },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [x, y],
            [x + 0.2, y],
            [x + 0.2, y + 0.2],
            [x, y + 0.2],
            [x, y]
          ]
        ]
      }
    };
  });
  const index = geojsonvt({ type: "FeatureCollection", features }, { maxZoom: 14, tolerance: 0 });
  const areaRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/layers/") && new URL(request.url()).searchParams.has("areaId"))
      areaRequests.push(request.url());
  });
  let guideRequests = 0;
  let tileRequests = 0;
  let revision = "a".repeat(64);
  await page.route("**/v2/discover/context**", async (route) => {
    guideRequests++;
    await route.fulfill({ status: 503, json: { message: "guide unavailable" } });
  });
  await page.route("**/v2/discover/boundaries", (route) =>
    route.fulfill({
      headers: { "cache-control": "no-store" },
      json: {
        ready: true,
        revision,
        tileTemplate: `/v2/discover/boundaries/${revision}/{level}/{z}/{x}/{y}.mvt`,
        coverage: [{ country: "CZ", level: "adm1", count: 25 }]
      }
    })
  );
  await page.route("**/v2/discover/boundaries/**/*.mvt", (route) => {
    tileRequests++;
    const match = /\/(\d+)\/(\d+)\/(\d+)\.mvt/.exec(route.request().url())!;
    const tile = index.getTile(Number(match[1]), Number(match[2]), Number(match[3]));
    return route.fulfill({
      contentType: "application/vnd.mapbox-vector-tile",
      body: tile ? Buffer.from(vtpbf.fromGeojsonVt({ boundaries: tile })) : Buffer.alloc(0)
    });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?mode=discover&lng=13.5&lat=49.5&z=7");
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const map = window.__maposMap;
          if (!map?.getStyle()?.layers) return 0;
          const layer = map
            .getStyle()
            .layers.find((l) => l.id.startsWith("discover-boundary-") && l.id.endsWith("-fill"));
          if (!layer) return 0;
          return new Set(
            map
              .queryRenderedFeatures({
                layers: map
                  .getStyle()
                  .layers.filter(
                    (l) => l.id.startsWith("discover-boundary-") && l.id.endsWith("-fill")
                  )
                  .map((l) => l.id)
              })
              .map((f) => f.properties.id)
          ).size;
        }),
      { timeout: 30000 }
    )
    .toBe(25);
  await expect.poll(() => guideRequests).toBeGreaterThan(0);
  await page.waitForTimeout(1000);
  const beforeGuide = guideRequests,
    beforeTiles = tileRequests;
  const point = await page.evaluate(() => window.__maposMap!.project([13.5, 49.5]));
  await page.mouse.move(point.x, point.y);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__maposMap!.getFeatureState({
            source: Object.keys(window.__maposMap!.getStyle().sources).find((id) =>
              id.startsWith("discover-boundary-")
            )!,
            sourceLayer: "boundaries",
            id: JSON.stringify(["fixture", "CZ", "adm1", "CZ-12"])
          }).hover
      )
    )
    .toBe(true);
  expect(guideRequests).toBe(beforeGuide);
  expect(tileRequests).toBe(beforeTiles);
  const hoverFrames = await page.evaluate(async () => {
    const map = window.__maposMap!;
    const samples: number[] = [];
    for (let i = 0; i < 30; i++) {
      const lngLat = { lng: 13.45 + (i % 2) * 0.2, lat: 49.5 };
      const point = map.project(lngLat);
      const start = performance.now();
      map.fire("mousemove", { point, lngLat, originalEvent: new MouseEvent("mousemove") });
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      samples.push(performance.now() - start);
    }
    return samples.sort((a, b) => a - b);
  });
  const hoverP95 = hoverFrames[Math.ceil(hoverFrames.length * 0.95) - 1]!;
  mkdirSync("output/performance", { recursive: true });
  writeFileSync(
    "output/performance/area-hover.json",
    JSON.stringify(
      {
        profile: "30 local fixture hover events through next animation frame",
        cpu: cpus()[0]?.model,
        platform: platform(),
        arch: arch(),
        p95Ms: hoverP95,
        samplesMs: hoverFrames
      },
      null,
      2
    )
  );
  expect(hoverP95).toBeLessThan(50);
  revision = "b".repeat(64);
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const source = Object.entries(window.__maposMap!.getStyle().sources).find(([id]) =>
            id.startsWith("discover-boundary-")
          )?.[1];
          return source?.type === "vector" && source.tiles?.[0]?.includes("b".repeat(64));
        }),
      { timeout: 75000, intervals: [1000, 5000] }
    )
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Set(
            window
              .__maposMap!.queryRenderedFeatures({
                layers: window
                  .__maposMap!.getStyle()
                  .layers.filter(
                    (l) => l.id.startsWith("discover-boundary-") && l.id.endsWith("-fill")
                  )
                  .map((l) => l.id)
              })
              .map((f) => f.properties.id)
          ).size
      )
    )
    .toBe(25);
  await page.mouse.click(point.x, point.y);
  await expect(page.getByText("Region 12", { exact: true })).toBeVisible();
  await expect.poll(() => areaRequests.length).toBeGreaterThan(0);
  expect(new URL(areaRequests.at(-1)!).searchParams.get("boundaryRevision")).toBe("b".repeat(64));
  await page.screenshot({ path: "output/playwright/discover-area-selected.png" });
  await page.getByRole("button", { name: "Borders", exact: true }).click();
  await page.getByRole("button", { name: "Zrušit výběr oblasti", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { getMapStore } = await import(/* @vite-ignore */ "/src/store/mapStore.ts");
        return getMapStore().areaSelection;
      })
    )
    .toBeNull();
  await page.keyboard.press("Escape");
  await page.screenshot({ path: "output/playwright/discover-boundaries.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  const close = page.getByRole("button", { name: "Close", exact: true });
  if (await close.isVisible()) await close.click();
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    window.__maposMap!.jumpTo({ center: [13.5, 49.5], zoom: 8 });
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const map = window.__maposMap!;
        return map.queryRenderedFeatures(map.project([13.5, 49.5]), {
          layers: map
            .getStyle()
            .layers.filter(
              (layer) => layer.id.startsWith("discover-boundary-") && layer.id.endsWith("-fill")
            )
            .map((layer) => layer.id)
        }).length;
      })
    )
    .toBeGreaterThan(0);
  const mobilePoint = await page.evaluate(() => window.__maposMap!.project([13.5, 49.5]));
  await page.mouse.click(mobilePoint.x, mobilePoint.y);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { getMapStore } = await import(/* @vite-ignore */ "/src/store/mapStore.ts");
        return getMapStore().areaSelection?.name;
      })
    )
    .toBe("Region 12");
  await page.getByTestId("hamburger-btn").click();
  await expect(page.getByText("Region 12", { exact: true })).toBeVisible();
  const rect = await page.getByRole("region", { name: "Borders" }).boundingBox();
  expect(rect!.x).toBeGreaterThanOrEqual(0);
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "output/playwright/discover-area-mobile.png" });
});
