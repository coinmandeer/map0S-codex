import type { FeatureCollection } from "geojson";
import { expect, test } from "./fixtures/offlineTest";

test("planning shell and synthetic API boot with zero external network", async ({
  page,
  offlineNetwork
}) => {
  await page.goto("/?mode=planning&lng=13.3775&lat=49.7475&z=14");

  await expect(page.getByTestId("mode-bar")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("planning-panel")).toBeVisible();
  await expect(page.getByTestId("map-container")).toBeVisible();

  const evidence = await page.evaluate(async () => {
    const [health, config, grid, route] = await Promise.all([
      fetch("/api/health").then((response) => response.json()),
      fetch("/api/config").then((response) => response.json()),
      fetch("/api/weather/grid?bbox=13,49,14,50&variable=wind&cols=3&rows=2").then((response) =>
        response.json()
      ),
      fetch("/api/routing?from=13.37,49.74&to=13.4,49.76&profile=foot").then((response) =>
        response.json()
      )
    ]);
    return { health, config, grid, route };
  });

  expect(evidence.health).toMatchObject({
    status: "ok",
    service: "mapos-v3-memory",
    fixtureMode: "offline"
  });
  expect(evidence.config.fixtureMode).toBe("offline");
  expect(evidence.grid).toMatchObject({
    variable: "wind",
    sampleCount: 6,
    generatedAt: "2026-09-01T12:00:00.000Z"
  });
  expect(evidence.route).toMatchObject({
    provider: "osm",
    profile: "foot",
    coordinates: [
      [13.37, 49.74],
      [13.3778, 49.7504],
      [13.3892, 49.7554],
      [13.4, 49.76]
    ]
  });
  expect(offlineNetwork.fulfilledFixtures.length).toBeGreaterThan(0);
});

test("local dot preview survives unrelated state changes and closes on Escape", async ({
  page
}) => {
  await page.goto("/?mode=discover&lng=13.3775&lat=49.7475&z=14");
  await expect(page.getByTestId("map-container")).toBeVisible();
  await page.waitForFunction(() => window.__maposMap?.isStyleLoaded());
  await page.waitForLoadState("networkidle");
  await page.evaluate(async () => {
    const map = window.__maposMap!;
    const { registerInteractivePins } = await import(
      /* @vite-ignore */ "/src/map/interactivePins.ts"
    );
    const center = map.getCenter();
    map.addSource("preview-fixture", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            id: "preview-fixture",
            geometry: {
              type: "Point",
              coordinates: [center.lng, center.lat]
            },
            properties: {
              id: "preview-fixture",
              name: "Lokální náhled",
              category: "cafe",
              website: "https://example.org/",
              image: "https://example.org/not-loaded.jpg"
            }
          }
        ]
      }
    });
    map.addLayer({
      id: "preview-fixture-dot",
      type: "circle",
      source: "preview-fixture",
      paint: { "circle-radius": 16, "circle-color": "#2255aa" }
    });
    registerInteractivePins(map, "osm-poi", ["preview-fixture-dot"]);
    const screen = map.project(center);
    return { x: screen.x, y: screen.y };
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__maposMap!.queryRenderedFeatures({ layers: ["preview-fixture-dot"] }).length
      )
    )
    .toBeGreaterThan(0);
  const point = await page.evaluate(() => {
    const map = window.__maposMap!;
    const feature = map.queryRenderedFeatures({ layers: ["preview-fixture-dot"] })[0];
    if (feature.geometry.type !== "Point") throw new Error("Expected a point");
    const p = map.project(feature.geometry.coordinates as [number, number]);
    return { x: p.x, y: p.y };
  });
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.screenshot({ path: "output/playwright/pin-preview-before-20260907.png" });
  await page.mouse.move(point.x, point.y);
  await expect(page.locator(".pin-preview-title")).toHaveText("Lokální náhled");
  expect(requests.filter((url) => /not-loaded|\/info\/|\/ai\/|\/features/.test(url))).toEqual([]);
  await page.evaluate(async () => {
    const { getMapStore } = await import(/* @vite-ignore */ "/src/store/mapStore.ts");
    getMapStore().showToast("Test běžné aktualizace");
  });
  await expect(page.locator(".pin-preview-title")).toBeVisible();
  await page.screenshot({ path: "output/playwright/pin-preview-20260907.png" });
  await page.mouse.move(point.x + 180, point.y + 80);
  await expect(page.locator(".pin-preview-card")).toHaveCount(0);
  await page.mouse.move(point.x, point.y);
  await expect(page.locator(".pin-preview-title")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".pin-preview-card")).toHaveCount(0);
});

test("public exploration owns arrows and stops on blur without GPS rewards", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("mapos:game-tracking", "simulation"));
  await page.goto("/?mode=game&lng=14.425&lat=50.085&z=18");
  await page.getByTestId("game-hud-panel").click();
  await expect(page.getByTestId("game-tracking")).toHaveValue("simulation");
  await page.getByTestId("game-hud-panel").click();
  await page.waitForFunction(() => Boolean(window.render_game_to_text));
  await expect
    .poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text!()).world.session?.mode))
    .toBe("explore");
  expect(await page.evaluate(() => window.__maposMap!.keyboard.isEnabled())).toBe(false);
  const position = () =>
    page.evaluate(() => JSON.parse(window.render_game_to_text!()).world.snapshot?.position);
  await expect.poll(position).toBeTruthy();
  const before = await position();
  const renderedBefore = await page.evaluate(
    () => JSON.parse(window.render_game_to_text!()).player
  );
  await page.locator(".maplibregl-canvas").focus();
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(1800);
  await page.keyboard.up("ArrowUp");
  await expect.poll(position).not.toEqual(before);
  await expect
    .poll(() => page.evaluate(() => JSON.parse(window.render_game_to_text!()).player))
    .not.toEqual(renderedBefore);
  await page.keyboard.down("ArrowUp");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.waitForTimeout(1200);
  const stopped = await position();
  await page.waitForTimeout(1200);
  expect(await position()).toEqual(stopped);
  await page.keyboard.up("ArrowUp");
  await page.screenshot({ path: "output/playwright/public-explore-20260907.png" });
});

test("coincident pins across layers spread locally and keep original coordinates", async ({
  page
}) => {
  await page.goto("/?mode=discover&lng=13.3775&lat=49.7475&z=14");
  await page.waitForFunction(() => window.__maposMap?.isStyleLoaded());
  await page.waitForLoadState("networkidle");
  const center = await page.evaluate(async () => {
    const map = window.__maposMap!;
    const { registerInteractivePins } = await import(
      /* @vite-ignore */ "/src/map/interactivePins.ts"
    );
    for (const layer of map.getStyle().layers ?? [])
      if (layer.id.startsWith("pins-")) map.setLayoutProperty(layer.id, "visibility", "none");
    const center = map.getCenter();
    for (const [owner, category] of [
      ["fixture-cafes", "cafe"],
      ["fixture-castles", "castle"]
    ]) {
      map.addSource(owner, {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              id: owner,
              geometry: { type: "Point", coordinates: [center.lng, center.lat] },
              properties: { id: owner, name: owner, category }
            }
          ]
        }
      });
      map.addLayer({
        id: owner,
        source: owner,
        type: "circle",
        paint: { "circle-radius": 16, "circle-color": "#2255aa" }
      });
      registerInteractivePins(map, owner, [owner]);
    }
    const point = map.project(center);
    return { x: point.x, y: point.y, lng: center.lng, lat: center.lat };
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__maposMap!.queryRenderedFeatures({ layers: ["fixture-cafes", "fixture-castles"] })
            .length
      )
    )
    .toBe(2);
  const screen = await page.evaluate(({ lng, lat }) => {
    const p = window.__maposMap!.project([lng, lat]);
    const r = window.__maposMap!.getContainer().getBoundingClientRect();
    return { x: p.x + r.x, y: p.y + r.y };
  }, center);
  await page.mouse.click(screen.x, screen.y);
  await expect(page.locator(".pin-spread-button")).toHaveCount(2);
  await expect(page.locator(".pin-spread-lines line")).toHaveCount(2);
  const positions = await page.evaluate(() =>
    (
      window.__maposMap!.getSource("fixture-cafes") as unknown as {
        serialize(): { data: FeatureCollection };
      }
    )
      .serialize()
      .data.features.map((feature) => feature.geometry)
  );
  expect(positions[0]).toEqual({ type: "Point", coordinates: [center.lng, center.lat] });
  await page.screenshot({ path: "output/playwright/pin-spread-20260907.png" });
  await page.keyboard.press("Escape");
  await expect(page.locator(".pin-spread-button")).toHaveCount(0);
});

test("CAMS overlay paints model cells and changing pollutant reuses the same data", async ({
  page
}) => {
  let requests = 0;
  await page.route("**/environment/air-quality/grid?*", (route) => {
    requests++;
    const bbox = new URL(route.request().url()).searchParams.get("bbox")!.split(",").map(Number);
    return route.fulfill({
      json: {
        model: "cams_europe",
        sourceResolutionKm: 11,
        validAt: new Date(Math.floor(Date.now() / 3600000) * 3600000).toISOString(),
        status: "complete",
        cells: [{ id: "model-fixture", bbox, values: { pm2_5: 8, pm10: 20, european_aqi: 30 } }]
      }
    });
  });
  await page.goto("/?mode=discover&lng=1.25&lat=41.12&z=12");
  await page.waitForLoadState("networkidle");
  await page.getByTestId("layers-btn").click();
  await page.getByTestId("layers-search").fill("Air quality");
  await page.getByTestId("weather-switch-cams-air-quality").click();
  await page.keyboard.press("Escape");
  await expect
    .poll(() =>
      page.evaluate(() => Boolean(window.__maposMap?.getLayer("fill-cams-air-quality-model")))
    )
    .toBe(true);
  const value = () =>
    page.evaluate(
      () =>
        (
          window.__maposMap!.getSource("source-cams-air-quality-model") as unknown as {
            serialize(): { data: FeatureCollection };
          }
        ).serialize().data.features[0].properties.value
    );
  await expect.poll(value).toBe(8);
  const before = requests;
  await page.evaluate(async () => {
    const { getMapStore } = await import(/* @vite-ignore */ "/src/store/mapStore.ts");
    getMapStore().setLayerFilters("cams-air-quality", { variable: "pm10" });
  });
  await expect.poll(value).toBe(20);
  expect(requests).toBe(before);
  await page.screenshot({ path: "output/playwright/cams-model-20260908.png" });
});
