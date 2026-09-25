import { expect, test } from "./fixtures/offlineTest";

test("layer search changes only the requested category; refresh consumes shared state", async ({
  page
}) => {
  await page.goto("/?layers=earthquakes&lng=14.42&lat=50.08&z=12");
  const input = page.getByTestId("place-search");
  await input.fill("kavarny");
  const group = page.getByRole("region", { name: "Vrstvy", exact: true });
  await group.getByRole("switch").first().click();
  await expect(group).toBeVisible();
  const enabled = await page.evaluate(async () => {
    const { getMapStore } = await import(/* @vite-ignore */ "/src/store/mapStore.ts");
    return getMapStore().activeLayers["osm-poi"];
  });
  expect(enabled?.filters).toBeTruthy();
  expect(JSON.stringify(enabled?.filters)).toContain("cafe");
  expect(JSON.stringify(enabled?.filters)).not.toContain("church");
  const slider = group.getByRole("slider").first();
  await slider.focus();
  await slider.press("ArrowLeft");
  const view = await page.evaluate(async () => {
    const { getMapStore } = await import(/* @vite-ignore */ "/src/store/mapStore.ts");
    const s = getMapStore();
    return { view: s.view, basemap: s.captureAppearance().basemapId };
  });
  await page.reload();
  await expect(input).toHaveValue("");
  const after = await page.evaluate(async () => {
    const { getMapStore } = await import(/* @vite-ignore */ "/src/store/mapStore.ts");
    const s = getMapStore();
    return {
      layers: Object.values(s.activeLayers).filter((l) => l.visible).length,
      view: s.view,
      basemap: s.captureAppearance().basemapId
    };
  });
  expect(after.layers).toBe(0);
  expect(after.basemap).toBe(view.basemap);
  expect(after.view.lng).toBeCloseTo(view.view.lng, 3);
  expect(after.view.lat).toBeCloseTo(view.view.lat, 3);
});

test("search opens the left conversation; history restores results without another model run", async ({
  page
}) => {
  let chats = 0;
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/v2/ai/chat" && r.method() === "POST") chats++;
  });
  await page.goto("/?lng=13.3775&lat=49.7475&z=13");
  const input = page.getByTestId("place-search");
  await input.fill("nejbližší bar");
  await page.getByRole("button", { name: "Probrat s AI: nejbližší bar", exact: true }).click();
  await expect(page.getByTestId("ai-panel")).toBeVisible();
  await expect(page.getByTestId("ai-card-places")).toBeVisible();
  await expect(page.getByTestId("ai-results-hide")).toBeVisible();
  await expect
    .poll(() => page.getByLabel("Historie konverzací").locator("option").count())
    .toBeGreaterThan(1);
  expect(chats).toBe(1);
  const question = await page.getByTestId("ai-panel-thread").innerText();
  const savedManual = page.waitForResponse((response) => {
    const request = response.request();
    return (
      request.method() === "PATCH" &&
      request.url().includes("/ai/conversations/") &&
      request.postDataJSON()?.workspace?.appearance?.layers?.["land-cover"]?.opacity === 0.25 &&
      response.ok()
    );
  });
  await page.evaluate(async () => {
    const { getMapStore } = await import(/* @vite-ignore */ "/src/store/mapStore.ts");
    getMapStore().setLayerVisible("land-cover", true);
    getMapStore().setLayerOpacity("land-cover", 0.25);
  });
  await savedManual;
  await page.reload();
  await expect(input).toBeVisible();
  await input.focus();
  await page
    .getByRole("button", { name: "Pokračovat v konverzaci / historie", exact: true })
    .click();
  await expect(page.getByTestId("ai-panel-thread")).toContainText("nejbližší bar");
  await expect(page.getByTestId("ai-card-places")).toBeVisible();
  expect(await page.getByTestId("ai-panel-thread").innerText()).toContain("nejbližší bar");
  expect(question).toContain("nejbližší bar");
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { getMapStore } = await import(/* @vite-ignore */ "/src/store/mapStore.ts");
        const layer = getMapStore().activeLayers["land-cover"];
        return layer?.visible && layer.opacity === 0.25;
      })
    )
    .toBe(true);
  expect(chats).toBe(1);
  await page.locator(".ai-session-menu > summary").click();
  page.once("dialog", (dialog) => dialog.accept("Plzeň — můj výlet"));
  await page.getByRole("button", { name: "Přejmenovat", exact: true }).click();
  await expect(page.getByLabel("Historie konverzací")).toContainText("Plzeň — můj výlet");
  await page.getByRole("button", { name: "Archivovat", exact: true }).click();
  await expect(page.getByRole("button", { name: "Obnovit z archivu", exact: true })).toBeVisible();
  await expect(page.getByLabel("Historie konverzací")).toContainText("Archiv · Plzeň");
  await page.getByRole("button", { name: "Obnovit z archivu", exact: true }).click();
  await expect(page.getByRole("button", { name: "Archivovat", exact: true })).toBeVisible();
  expect(chats).toBe(1);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Smazat konverzaci", exact: true }).click();
  await expect(page.getByTestId("ai-panel-thread")).not.toContainText("nejbližší bar");
  await expect(page.getByLabel("Historie konverzací").locator("option")).toHaveCount(1);
});

test("undo preserves manual fields changed after an assistant scene", async ({ page }) => {
  await page.goto("/?lng=13.3775&lat=49.7475&z=13");
  await expect(page.getByTestId("place-search")).toBeVisible();
  const result = await page.evaluate(async () => {
    const { getMapStore } = await import(/* @vite-ignore */ "/src/store/mapStore.ts");
    const { captureWorkspace, applyScenePatch, undoWorkspace } = await import(
      /* @vite-ignore */ "/src/ui/ai/mapScene.ts"
    );
    const s = getMapStore();
    const before = captureWorkspace();
    applyScenePatch({
      schema: "mapos.scene-patch",
      schemaVersion: "1.0.0",
      id: "step",
      runId: "run",
      conversationId: "chat",
      revision: 1,
      explanation: "Pokryv krajiny",
      basemapId: "carto-positron",
      layers: { "land-cover": { visible: true, opacity: 0.6, filters: {} } }
    });
    const applied = captureWorkspace();
    s.setLayerOpacity("land-cover", 0.25);
    s.setBasemap("carto-dark");
    undoWorkspace(before, applied);
    return {
      opacity: s.activeLayers["land-cover"]?.opacity,
      basemap: s.captureAppearance().basemapId
    };
  });
  expect(result.opacity).toBe(0.25);
  expect(result.basemap).toBe("carto-dark");
});

test("Google UI Kit starts only on explicit request and never exports provider text", async ({
  page
}) => {
  let googleLoads = 0;
  await page.route("https://maps.googleapis.com/maps/api/js?**", async (route) => {
    googleLoads++;
    await route.fulfill({
      contentType: "application/javascript",
      body: `
      window.google = { maps: { importLibrary: async () => {
        if (!customElements.get('gmp-place-text-search-request')) {
          customElements.define('gmp-place-text-search-request', class extends HTMLElement {
            set textQuery(value) {
              const button = document.createElement('button');
              button.textContent = 'Google fixture result';
              button.onclick = () => this.parentElement.dispatchEvent(Object.assign(new Event('gmp-select'), {
                place: { displayName: 'Do not copy provider text', location: { lat: () => 36.72, lng: () => -4.42 } }
              }));
              this.parentElement.append(button);
              this.parentElement.dispatchEvent(new Event('gmp-load'));
            }
          });
        }
      } } };
      window.maposGooglePlacesReady();
    `
    });
  });
  await page.goto("/?lng=14.42&lat=50.08&z=12");
  const input = page.getByTestId("place-search");
  await input.fill("Malaga");
  await expect(page.getByRole("button", { name: "Dohledat přes Google" })).toHaveCount(0);
  expect(googleLoads).toBe(0);
  await page.evaluate(async () => {
    const { getMapStore } = await import(/* @vite-ignore */ "/src/store/mapStore.ts");
    const store = getMapStore();
    store.setCapabilities({
      ...store.capabilities,
      googlePlacesUi: true,
      googlePlacesPublicKey: "fixture-public-key"
    });
  });
  await page.getByRole("button", { name: "Dohledat přes Google" }).click();
  await page.getByRole("button", { name: "Google fixture result" }).click();
  expect(googleLoads).toBe(1);
  const result = await page.evaluate(async () => {
    const { getMapStore } = await import(/* @vite-ignore */ "/src/store/mapStore.ts");
    return {
      view: getMapStore().view,
      persisted: JSON.stringify(localStorage) + JSON.stringify(sessionStorage)
    };
  });
  expect(result.view.lng).toBeCloseTo(-4.42, 2);
  expect(result.view.lat).toBeCloseTo(36.72, 2);
  expect(result.persisted).not.toContain("Do not copy provider text");
});

test("derived area reaches map as a sourced polygon and survives reopening a conversation", async ({
  page
}) => {
  await page.goto("/?lng=-4.42&lat=36.72&z=12");
  await page.getByTestId("place-search").fill("ukaž okruh 10 km");
  await page.getByRole("button", { name: "Probrat s AI: ukaž okruh 10 km", exact: true }).click();
  await expect(page.getByTestId("ai-panel-thread")).toContainText("Nejde o dojezdovou oblast");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const source = window.__maposMap?.getSource("mapos-ai-artifact-0");
        return source ? source.serialize().data?.features?.[0]?.geometry.type : null;
      })
    )
    .toBe("Polygon");
  await expect(page.locator(".map-artifact-legend")).toContainText("Okruh 10 km");
  await expect(page.getByLabel("Historie konverzací").locator("option")).toHaveCount(2);
  await page.reload();
  await page.getByTestId("place-search").focus();
  await page
    .getByRole("button", { name: "Pokračovat v konverzaci / historie", exact: true })
    .click();
  await expect(page.locator(".map-artifact-legend")).toContainText("Okruh 10 km");
});

test("GDACS keeps polygon holes and shows the source alert legend", async ({ page }) => {
  await page.route("**/layers/disaster-impacts/features**", (route) =>
    route.fulfill({
      json: {
        type: "FeatureCollection",
        query: { status: "partial" },
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [-4.42, 36.72] },
            properties: {
              id: "gdacs:FL:1",
              name: "Modelovaná povodeň",
              layerId: "disaster-impacts",
              alert: "Orange",
              source: "GDACS",
              footprints: [
                {
                  label: "Affected area",
                  time: "2026-09-24",
                  category: "Poly_Affected",
                  geometry: {
                    type: "Polygon",
                    coordinates: [
                      [
                        [-4.5, 36.6],
                        [-4.3, 36.6],
                        [-4.3, 36.8],
                        [-4.5, 36.8],
                        [-4.5, 36.6]
                      ],
                      [
                        [-4.44, 36.68],
                        [-4.44, 36.74],
                        [-4.38, 36.74],
                        [-4.38, 36.68],
                        [-4.44, 36.68]
                      ]
                    ]
                  }
                }
              ]
            }
          }
        ]
      }
    })
  );
  await page.goto("/?lng=-4.42&lat=36.72&z=12");
  await expect(page.getByTestId("place-search")).toBeVisible();
  await page.evaluate(async () => {
    const { getMapStore } = await import(/* @vite-ignore */ "/src/store/mapStore.ts");
    getMapStore().setLayerVisible("disaster-impacts", true);
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const source = window.__maposMap?.getSource("source-disaster-impacts-areas");
        return source?.serialize().data?.features?.[0]?.geometry.coordinates.length;
      })
    )
    .toBe(2);
  await expect
    .poll(() =>
      page.evaluate(() => window.__maposMap?.getLayer("pins-disaster-impacts-areas")?.type)
    )
    .toBe("fill");
});
