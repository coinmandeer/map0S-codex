import { expect, test } from "./fixtures/offlineTest";
import { planV1ToV2 } from "@mapos/layer-sdk";

test.describe("PlanDocument v2 propojený s Moje", () => {
  test("ručně vytvoří, upraví, uloží, serverově obnoví a exportuje plán bez AI", async ({
    page
  }) => {
    const aiRequests: string[] = [];
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (/\/(?:ai|cml)(?:\/|$)/.test(pathname)) aiRequests.push(pathname);
    });
    await page.goto("/?mode=planning&lng=13.3775&lat=49.7475&z=14");
    await expect(page.getByTestId("planning-panel")).toBeVisible({ timeout: 20_000 });

    await page.getByTestId("plan-name").fill("Ručně po Španělsku");
    await page.getByLabel("Název zastávky 1").fill("Barcelona");

    const moreOptions = page.getByTestId("plan-more-options");
    await moreOptions.getByText("Více možností", { exact: true }).click();
    await page.getByLabel("Datum odjezdu").fill("2026-09-18T09:30");
    const expectedDeparture = await page.evaluate(() => new Date("2026-09-18T09:30").toISOString());
    await page.getByLabel("Typ vozidla").selectOption("camper");
    await page.getByLabel("Výška m").fill("3.2");
    await page.getByRole("button", { name: /Bez dálnic/ }).click();
    await expect(page.getByTestId("plan-route-mapping")).toContainText(
      "Provider použije označený fallback"
    );
    await expect(page.getByTestId("plan-route-mapping")).toContainText(
      "profile=car · preference=fast"
    );

    const routeRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" && new URL(request.url()).pathname === "/api/v2/routing/plan"
    );
    await page.getByTestId("calculate-plan").click();
    const routePayload = (await routeRequest).postDataJSON() as {
      provider: string;
      plan: {
        name: string;
        departureAt: string;
        routePolicy: { profile: string; preference: string };
        vehicle: { profile: string; heightM: number };
      };
    };
    expect(routePayload.provider).toBe("osm");
    expect(routePayload.plan.name).toBe("Ručně po Španělsku");
    expect(routePayload.plan.departureAt).toBe(expectedDeparture);
    expect(routePayload.plan.routePolicy).toMatchObject({ profile: "camper", preference: "nohwy" });
    expect(routePayload.plan.vehicle).toMatchObject({ profile: "camper", heightM: 3.2 });

    const result = page.getByTestId("planning-result");
    await expect(result).toBeVisible({ timeout: 20_000 });
    await expect(result).toContainText("1/1");
    await expect(result).toContainText("hotových úseků");
    await expect(result.getByText("Barcelona → Cíl")).toBeVisible();
    await expect(page.getByRole("button", { name: "GPX", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "GeoJSON", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "KML", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "MapOS JSON", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Posunout zastávku 2 nahoru" }).click();
    await expect(page.getByLabel("Název zastávky 1")).toHaveValue("Cíl");
    await page.getByRole("button", { name: "Vrátit" }).click();
    await expect(page.getByLabel("Název zastávky 1")).toHaveValue("Barcelona");

    const saveRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" && new URL(request.url()).pathname === "/api/v2/plans"
    );
    await page.getByTestId("save-plan").click();
    await saveRequest;
    await expect(page.getByTestId("toast")).toContainText("uložený v Moje");

    // Remove the local draft so reload can only succeed through the owner-bound PlanDocument API.
    await page.evaluate(() => {
      localStorage.removeItem("mapos:active-plan");
      localStorage.removeItem("mapos:active-plan-v2");
    });
    const hydration = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        new URL(response.url()).pathname === "/api/v2/plans" &&
        response.ok()
    );
    await page.reload();
    const hydrationBody = (await (await hydration).json()) as {
      plans: Array<{ name: string }>;
    };
    expect(hydrationBody.plans[0]?.name).toBe("Ručně po Španělsku");
    await expect(page.getByTestId("plan-name")).toHaveValue("Ručně po Španělsku");
    await expect(page.getByLabel("Název zastávky 1")).toHaveValue("Barcelona");
    await expect(page.getByLabel("Datum odjezdu")).toBeHidden();
    await page.getByText("Více možností", { exact: true }).click();
    await expect(page.getByLabel("Datum odjezdu")).toHaveValue("2026-09-18T09:30");
    await expect(page.getByLabel("Typ vozidla")).toHaveValue("camper");
    await expect(page.getByLabel("Výška m")).toHaveValue("3.2");
    await expect(page.getByRole("button", { name: /Bez dálnic/ })).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    const downloadEvent = page.waitForEvent("download");
    const exportRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/v2/plans/export/gpx"
    );
    await page.getByRole("button", { name: "GPX", exact: true }).click();
    const [download] = await Promise.all([downloadEvent, exportRequest]);
    const stream = await download.createReadStream();
    let exported = "";
    for await (const chunk of stream) exported += chunk.toString();
    expect(download.suggestedFilename()).toMatch(/^plan-.+\.gpx$/);
    expect(exported).toContain("<name>Ručně po Španělsku</name>");
    expect(exported).toContain("<name>Barcelona</name>");
    expect(aiRequests).toEqual([]);
  });

  test("Více možností zpřístupní datum, vozidlo a všechny profily pouze klávesnicí", async ({
    page
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?mode=planning&lng=13.3775&lat=49.7475&z=14");
    await page.getByTestId("mode-planning").click();
    await expect(page.getByTestId("planning-panel")).toBeVisible({ timeout: 20_000 });

    const options = page.getByTestId("plan-more-options");
    const summary = options.locator("summary");
    await expect(page.getByLabel("Datum odjezdu")).toBeHidden();
    await summary.focus();
    await expect(summary).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(options).toHaveAttribute("open", "");
    await expect(page.getByLabel("Datum odjezdu")).toBeVisible();
    await expect(page.getByLabel("Typ vozidla")).toBeVisible();

    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Datum odjezdu")).toBeFocused();
    for (const label of ["Rychlá", "Krátká", "Bez dálnic", "Dobrodružná"]) {
      await expect(page.getByRole("button", { name: new RegExp(`^${label}`) })).toBeVisible();
    }

    const adventure = page.getByRole("button", { name: /^Dobrodružná/ });
    await adventure.focus();
    await page.keyboard.press("Enter");
    await expect(adventure).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("plan-route-mapping")).toContainText("Request: osm");

    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
    });
    const overflowers = await options.locator("*").evaluateAll((elements) =>
      elements
        .filter(
          (element) =>
            element instanceof HTMLElement && element.scrollWidth > element.clientWidth + 1
        )
        .map((element) => ({
          tag: element.tagName.toLowerCase(),
          className: element.className,
          text: element.textContent?.trim().slice(0, 80)
        }))
    );
    expect(overflowers, "planning options must not overflow at 200% text").toEqual([]);
  });

  test("dobrodružný režim vysvětlí skóre, hlídá zajížďku a přidá ověřené OSM místo", async ({
    page
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.route("**/api/v2/routing/adventure", async (route) => {
      const payload = route.request().postDataJSON() as {
        detourLimitPercent: number;
      };
      expect(payload.detourLimitPercent).toBe(15);
      await route.fulfill({
        json: {
          algorithm: {
            version: "mapos-adventure-v1",
            deterministic: true,
            formula: "0.55 × zajímavost + 0.35 × efektivita zajížďky + 0.10 × důvěra zdroje",
            detourLimitPercent: 15,
            minimumEndpointDistanceM: 180
          },
          suggestions: [
            {
              id: "adventure:0:osm:viewpoint-1",
              placeId: "osm:viewpoint-1",
              name: "Vyhlídka nad údolím",
              category: "viewpoint",
              location: [13.389, 49.752],
              segmentIndex: 0,
              insertIndex: 1,
              score: 91,
              scoreBreakdown: {
                interest: 100,
                detourEfficiency: 82,
                sourceConfidence: 75
              },
              baselineDistanceM: 5_000,
              viaDistanceM: 5_460,
              detourM: 460,
              detourPercent: 9.2,
              source: { id: "osm", reference: "viewpoint-1" },
              explanation: "55 % zajímavost · 35 % efektivita zajížďky · 10 % důvěra zdroje"
            }
          ],
          coverage: {
            totalSegments: 1,
            scannedSegments: 1,
            placesEvaluated: 14,
            eligiblePlaces: 1
          },
          dataBudget: {
            sources: ["osm"],
            categories: ["viewpoint", "castle"],
            maxScannedSegments: 6,
            maxRoutedCandidates: 12,
            maxReturnedSuggestions: 3,
            providerCalls: 3
          },
          sourceStates: [{ source: "osm", state: "ready", count: 14 }],
          warnings: []
        }
      });
    });

    await page.goto("/?mode=planning&lng=13.3775&lat=49.7475&z=14");
    await expect(page.getByTestId("planning-panel")).toBeVisible({ timeout: 20_000 });
    await page.getByText("Více možností", { exact: true }).click();
    await page.getByRole("button", { name: /^Dobrodružná/ }).click();
    const adventure = page.getByTestId("adventure-planner");
    await expect(adventure).toContainText("Deterministický výběr · bez AI");
    await expect(adventure).toContainText("stejným routovacím providerem");
    await adventure.getByRole("button", { name: "15 %" }).click();
    await page.getByTestId("find-adventure-route").click();

    const candidate = page.getByTestId("adventure-candidate-1");
    await expect(candidate).toContainText("Vyhlídka nad údolím");
    await expect(candidate).toContainText("91");
    await expect(candidate).toContainText("+9.2 %");
    await expect(candidate).toContainText("Zajímavost 100");
    await adventure.getByText("Jak vzniklo skóre").click();
    await expect(adventure).toContainText("žádný náhodný waypoint");
    await adventure.screenshot({ path: "e2e/screenshots/1440-planning-adventure.png" });

    await page.getByTestId("apply-adventure-route").click();
    await expect(page.getByLabel("Název zastávky 2")).toHaveValue("Vyhlídka nad údolím");
    await expect(page.getByTestId("toast")).toContainText("přepočítávám trasu");
    await expect(page.getByTestId("planning-result")).toContainText("2/2", {
      timeout: 20_000
    });
  });

  test("bike nabídne CyclOSM bez přepsání ručního podkladu", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      localStorage.setItem("mapos:basemap", "carto-voyager");
      localStorage.removeItem("mapos:bike-basemap-recommendation");
    });
    await page.goto("/?mode=planning&lng=13.3775&lat=49.7475&z=14");
    await page.getByTestId("mode-planning").click();
    await expect(page.getByTestId("planning-panel")).toBeVisible({ timeout: 20_000 });
    await page.getByText("Více možností", { exact: true }).click();
    await page.getByLabel("Typ vozidla").selectOption("bike");

    const recommendation = page.getByTestId("bike-basemap-recommendation");
    await expect(recommendation).toContainText("Doporučená cyklistická mapa");
    await expect(recommendation).toContainText("CARTO Voyager");
    expect(await page.evaluate(() => localStorage.getItem("mapos:basemap"))).toBe("carto-voyager");

    await page.getByTestId("activate-bike-map").click();
    await expect(recommendation).toContainText("CyclOSM je na mapě aktivní");
    expect(await page.evaluate(() => localStorage.getItem("mapos:basemap"))).toBe("carto-voyager");
    await expect(page.getByTestId("toast")).toContainText("původní podklad zůstal zachovaný");
    await page.screenshot({
      path: "e2e/screenshots/390-planning-bike-map.png",
      fullPage: false
    });
  });

  test("porovná a zvolí variantu jednoho segmentu a hned překreslí trasu", async ({ page }) => {
    await page.route("**/api/v2/routing/plan", async (route) => {
      const request = route.request();
      if (request.method() !== "POST") return route.fallback();
      const payload = request.postDataJSON() as {
        plan: {
          stops: Array<{ location: { coordinates: [number, number] } }>;
          segments: Array<Record<string, unknown>>;
        };
      };
      const [from, to] = payload.plan.stops.map((stop) => stop.location.coordinates);
      const segment = payload.plan.segments[0]!;
      const alternatives = [
        {
          id: "recommended",
          providerId: "fixture-osrm",
          profile: "car",
          preference: "fast",
          geometry: { type: "LineString", coordinates: [from, to] },
          distanceM: 1_000,
          durationS: 600,
          warnings: []
        },
        {
          id: "scenic",
          providerId: "fixture-osrm",
          profile: "car",
          preference: "fast",
          geometry: {
            type: "LineString",
            coordinates: [from, [from![0] + 0.008, from![1] + 0.014], to]
          },
          distanceM: 1_350,
          durationS: 720,
          warnings: ["Alternativní trasa"]
        }
      ];
      await route.fulfill({
        json: {
          plan: {
            ...payload.plan,
            segments: [
              {
                ...segment,
                status: "ready",
                provider: "fixture-osrm",
                alternatives,
                selectedAlternativeId: "recommended"
              }
            ]
          },
          routedSegmentIds: [segment.id],
          failedSegmentIds: [],
          stats: { eligibleSegments: 1, providerCalls: 1, cacheHits: 0, maxConcurrency: 1 }
        }
      });
    });
    await page.goto("/?mode=planning&lng=13.3775&lat=49.7475&z=14");
    await expect(page.getByTestId("planning-panel")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("calculate-plan").click();

    const first = page.getByTestId("segment-1-alternative-1");
    const second = page.getByTestId("segment-1-alternative-2");
    await expect(first).toHaveAttribute("aria-checked", "true");
    await expect(second).toContainText("+350 m");
    await expect(second).toContainText("+2 min");
    await second.click();
    await expect(second).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("planning-result")).toContainText("1.4 km");

    const mapProjection = await page.evaluate(() => {
      const map = window.__maposMap;
      const source = map?.getSource("route-preview") as unknown as {
        serialize?: () => {
          data?: { features?: Array<{ geometry?: { type?: string; coordinates?: unknown[] } }> };
        };
      };
      const features = source?.serialize?.().data?.features ?? [];
      return {
        casing: Boolean(map?.getLayer("route-preview-casing")),
        stopLabels: Boolean(map?.getLayer("route-preview-stop-labels")),
        routeCoordinateCount: features.find((feature) => feature.geometry?.type === "LineString")
          ?.geometry?.coordinates?.length,
        stopCount: features.filter((feature) => feature.geometry?.type === "Point").length
      };
    });
    expect(mapProjection).toEqual({
      casing: true,
      stopLabels: true,
      routeCoordinateCount: 3,
      stopCount: 2
    });
    await page.screenshot({
      path: "e2e/screenshots/1440-planning-alternatives.png",
      fullPage: false
    });
  });

  test("zastávku vybere pevným středovým pinem a přesná GPS zůstane v detailu", async ({
    page
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/?mode=planning&lng=13.3775&lat=49.7475&z=14");
    await expect(page.getByTestId("planning-panel")).toBeVisible({ timeout: 20_000 });

    await expect(page.getByLabel("Délka 1")).toBeHidden();
    await page.getByTestId("pick-stop-1").click();
    await expect(page.getByTestId("map-picker-host")).toBeVisible();
    await expect(page.getByTestId("map-picker-host")).toContainText("Vyber polohu zastávky 1");

    await page.getByTestId("layers-btn").click();
    await expect(page.getByTestId("right-utility-drawer")).toHaveAttribute(
      "data-utility",
      "layers"
    );
    await expect(page.getByTestId("map-picker-host")).toBeVisible();
    await page.getByTestId("right-utility-close").click();
    await expect(page.getByTestId("right-utility-drawer")).toHaveCount(0);
    await expect(page.getByTestId("map-picker-host")).toBeVisible();

    const output = page.getByTestId("map-picker-host").locator("output");
    const initialCoordinates = await output.textContent();
    const map = page.locator(".maplibregl-canvas");
    const box = await map.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2 + 100, box!.y + box!.height / 2 + 60, {
      steps: 8
    });
    await page.mouse.up();
    await expect
      .poll(() => page.evaluate(() => window.__maposMap?.getCenter().lng))
      .not.toBeCloseTo(13.3775, 4);
    await expect
      .poll(() => page.evaluate(() => new URLSearchParams(location.search).get("lng")))
      .not.toBe("13.377500");
    await expect.poll(() => output.textContent()).not.toBe(initialCoordinates);
    await expect.poll(() => page.evaluate(() => window.__maposMap?.isMoving())).toBe(false);
    const chosenCoordinates = (await output.textContent())!
      .split(", ")
      .map((value) => Number(value));
    expect(chosenCoordinates).toHaveLength(2);
    await page.getByTestId("map-picker-select").click();
    await expect(page.getByTestId("map-picker-host")).toHaveCount(0);
    await expect(page.getByLabel("Souřadnice zastávky 1")).not.toContainText("49.74750, 13.37750");

    await page.getByText("Čas a přesné GPS", { exact: true }).first().click();
    expect(Number(await page.getByLabel("Délka 1").inputValue())).toBeCloseTo(
      chosenCoordinates[1]!,
      4
    );
    expect(Number(await page.getByLabel("Šířka 1").inputValue())).toBeCloseTo(
      chosenCoordinates[0]!,
      4
    );

    await page.getByTestId("pick-new-stop").click();
    await expect(page.getByTestId("map-picker-host")).toContainText("Vyber novou zastávku");
    await page.getByTestId("map-picker-select").click();
    await expect(page.getByLabel("Název zastávky 3")).toBeVisible();
  });

  test("souvislá trasa zachová každý skutečný úsek a úsek se vybere přímo v mapě", async ({
    page
  }) => {
    const mapPlan = planV1ToV2(
      {
        id: "selectable-map-plan",
        name: "Klikací trasa",
        departureAt: "2026-09-04T08:00:00.000Z",
        variant: "fast",
        stops: [
          { id: "map-a", name: "A", lng: 13.34, lat: 49.72, dwellMinutes: 0 },
          { id: "map-b", name: "B", lng: 13.4, lat: 49.74, dwellMinutes: 0 },
          { id: "map-c", name: "C", lng: 13.47, lat: 49.73, dwellMinutes: 0 },
          { id: "map-d", name: "D", lng: 13.54, lat: 49.76, dwellMinutes: 0 }
        ],
        vehicle: { profile: "car" },
        visibility: "private"
      },
      { now: "2026-09-02T18:00:00.000Z" }
    );
    await page.addInitScript((plan) => {
      localStorage.setItem("mapos:active-plan-v2", JSON.stringify(plan));
    }, mapPlan);
    await page.route("**/api/v2/routing/plan", async (route) => {
      const payload = route.request().postDataJSON() as { plan: typeof mapPlan };
      const segments = payload.plan.segments.map((segment, index) => {
        const from = payload.plan.stops[index]!.location.coordinates;
        const to = payload.plan.stops[index + 1]!.location.coordinates;
        const middle: [number, number] = [
          (from[0] + to[0]) / 2,
          (from[1] + to[1]) / 2 + (index === 1 ? 0.012 : 0.004)
        ];
        const alternative = {
          id: `map-route-${segment.id}`,
          providerId: "fixture-osrm",
          profile: "car" as const,
          preference: "fast" as const,
          geometry: { type: "LineString" as const, coordinates: [from, middle, to] },
          distanceM: 4_000 + index * 500,
          durationS: 360 + index * 30,
          warnings: [],
          computedAt: "2026-09-02T18:00:00.000Z"
        };
        return {
          ...segment,
          status: "ready" as const,
          provider: "fixture-osrm",
          alternatives: [alternative],
          selectedAlternativeId: alternative.id
        };
      });
      await route.fulfill({
        json: {
          plan: { ...payload.plan, segments },
          routedSegmentIds: segments.map((segment) => segment.id),
          failedSegmentIds: [],
          stats: {
            eligibleSegments: segments.length,
            providerCalls: segments.length,
            cacheHits: 0,
            maxConcurrency: 3
          }
        }
      });
    });
    await page.route("**/api/v2/routing/temporal-context", async (route) => {
      const payload = route.request().postDataJSON() as { plan: typeof mapPlan };
      expect(payload.plan.departureAt).toBe("2026-09-04T08:00:00.000Z");
      await route.fulfill({
        json: {
          status: "active",
          planId: mapPlan.id,
          departureAt: mapPlan.departureAt,
          generatedAt: "2026-09-02T18:00:00.000Z",
          temporalControls: {
            cursor: mapPlan.departureAt,
            minimum: "2026-09-01T18:00:00.000Z",
            maximum: "2026-09-10T18:00:00.000Z"
          },
          weather: {
            status: "ready",
            sampledStops: 4,
            totalStops: 4,
            source: {
              id: "open-meteo-forecast",
              label: "Open-Meteo Forecast API",
              url: "https://open-meteo.com/"
            },
            reason: null
          },
          traffic: {
            status: "unavailable",
            source: null,
            reason: "Provider neposkytl dopravní data pro plánovaný čas; nic se nesimuluje."
          },
          stops: mapPlan.stops.map((stop, index) => ({
            stopId: stop.id,
            at: new Date(Date.parse(mapPlan.departureAt!) + index * 390_000).toISOString(),
            temperatureC: index === 2 ? 33.4 : 18.2,
            precipitationMm: index === 2 ? 1.4 : 0,
            weatherCode: index === 2 ? 61 : 0
          })),
          segments: mapPlan.segments.map((segment, index) => ({
            segmentId: segment.id,
            order: index,
            departureAt: new Date(Date.parse(mapPlan.departureAt!) + index * 390_000).toISOString(),
            arrivalAt: new Date(
              Date.parse(mapPlan.departureAt!) + (index + 1) * 390_000
            ).toISOString(),
            weatherAtArrival: {
              stopId: mapPlan.stops[index + 1]!.id,
              at: new Date(Date.parse(mapPlan.departureAt!) + (index + 1) * 390_000).toISOString(),
              temperatureC: index === 1 ? 33.4 : 18.2,
              precipitationMm: index === 1 ? 1.4 : 0,
              weatherCode: index === 1 ? 61 : 0
            },
            trafficStatus: "unavailable",
            warnings:
              index === 1 ? ["Déšť u C: 1.4 mm v hodině příjezdu.", "Horko u C: 33.4 °C."] : []
          })),
          dataBudget: { maxWeatherStops: 20, sampledStops: 4, upstreamWeatherRequests: 1 }
        }
      });
    });

    await page.goto("/?mode=planning&lng=13.44&lat=49.74&z=12");
    await expect(page.getByTestId("planning-panel")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("calculate-plan").click();
    await expect(page.getByTestId("planning-result")).toContainText("3/3", {
      timeout: 20_000
    });
    await expect(page.getByText(/vyberte úsek tady nebo přímo v mapě/i)).toBeVisible();
    const datedContext = page.getByTestId("plan-temporal-context");
    await expect(datedContext).toContainText("4/4 zastávek");
    await expect(datedContext).toContainText("Open-Meteo Forecast API");
    await expect(datedContext).toContainText("nic se nesimuluje");
    await expect(page.getByTestId("segment-2-temporal")).toContainText("33.4 °C");
    await expect(page.getByTestId("segment-2-temporal")).toContainText("Déšť u C");
    await expect(page.getByTestId("global-timeline")).toContainText("Plán");
    await datedContext.screenshot({ path: "e2e/screenshots/1440-planning-temporal-context.png" });
    await expect.poll(() => page.evaluate(() => window.__maposMap?.isMoving())).toBe(false);

    const routeFeatures = await page.evaluate(() => {
      const source = window.__maposMap?.getSource("route-preview") as unknown as {
        serialize?: () => {
          data?: {
            features?: Array<{
              properties?: Record<string, unknown>;
              geometry?: { type?: string; coordinates?: [number, number][] };
            }>;
          };
        };
      };
      return (source?.serialize?.().data?.features ?? []).filter(
        (feature) => feature.geometry?.type === "LineString"
      );
    });
    expect(routeFeatures).toHaveLength(3);
    expect(routeFeatures.map((feature) => feature.properties?.segmentId)).toEqual(
      mapPlan.segments.map((segment) => segment.id)
    );
    for (let index = 0; index < routeFeatures.length - 1; index += 1) {
      expect(routeFeatures[index]!.geometry!.coordinates!.at(-1)).toEqual(
        routeFeatures[index + 1]!.geometry!.coordinates![0]
      );
    }

    const middlePoint = await page.evaluate(() => {
      const map = window.__maposMap!;
      const point = map.project([13.435, 49.747]);
      return { x: point.x, y: point.y };
    });
    await page.mouse.click(middlePoint.x, middlePoint.y);
    const selectedCard = page.getByTestId("plan-segment-2");
    await expect(selectedCard).toHaveAttribute("aria-current", "true");
    await expect(selectedCard.getByRole("button", { name: "Vybráno v mapě" })).toBeVisible();

    const selectedFeatureIds = await page.evaluate(() => {
      const source = window.__maposMap?.getSource("route-preview") as unknown as {
        serialize?: () => {
          data?: {
            features?: Array<{
              properties?: Record<string, unknown>;
              geometry?: { type?: string };
            }>;
          };
        };
      };
      return (source?.serialize?.().data?.features ?? [])
        .filter(
          (feature) => feature.geometry?.type === "LineString" && feature.properties?.selected
        )
        .map((feature) => feature.properties?.segmentId);
    });
    expect(selectedFeatureIds).toEqual([mapPlan.segments[1]!.id]);
    await page.screenshot({
      path: "e2e/screenshots/1440-planning-selectable-segment.png",
      fullPage: false
    });
  });

  test("zamítnutá GPS nabídne ruční a mapový fallback, povolená poloha zastávku aktualizuje", async ({
    page,
    context
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await context.clearPermissions();
    await page.goto("/?mode=planning&lng=13.3775&lat=49.7475&z=14");
    await page.getByTestId("mode-planning").click();
    await expect(page.getByTestId("planning-panel")).toBeVisible({ timeout: 20_000 });
    await page.evaluate(() => {
      navigator.geolocation.getCurrentPosition = (_success, failure) => {
        failure?.({
          code: 1,
          message: "denied",
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3
        } as GeolocationPositionError);
      };
    });

    await page.getByTestId("locate-stop-1").click();
    const fallback = page.getByTestId("location-fallback-1");
    await expect(fallback).toContainText("Poloha není povolená");
    await expect(fallback.getByRole("button", { name: "Vybrat bod na mapě" })).toBeVisible();
    await expect(page.getByLabel("Ruční délka 1")).toBeVisible();
    await expect(page.getByLabel("Ruční šířka 1")).toBeVisible();
    await fallback.screenshot({ path: "e2e/screenshots/390-planning-gps-fallback.png" });
    await page.getByLabel("Ruční délka 1").fill("13.41");
    await page.getByLabel("Ruční šířka 1").fill("49.81");
    await fallback.getByRole("button", { name: "Použít souřadnice" }).click();
    await expect(fallback).toHaveCount(0);
    await expect(page.getByLabel("Souřadnice zastávky 1")).toContainText("49.81000, 13.41000");

    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ longitude: 14.4213, latitude: 50.0874 });
    await page.reload();
    await page.getByTestId("mode-planning").click();
    await page.getByTestId("locate-stop-1").click();
    await expect(page.getByLabel("Souřadnice zastávky 1")).toContainText("50.08740, 14.42130", {
      timeout: 20_000
    });
    await expect(page.getByTestId("toast")).toContainText("používá tvoji polohu");
  });

  test("velký plán nemá produktový limit a trasuje se v překrývajících dávkách", async ({
    page
  }) => {
    const largePlan = planV1ToV2(
      {
        id: "large-browser-plan",
        name: "105 zastávek",
        departureAt: "2026-09-04T08:00:00.000Z",
        variant: "fast",
        stops: Array.from({ length: 105 }, (_, index) => ({
          id: `large-stop-${index}`,
          name: `Místo ${index + 1}`,
          lng: 13.3 + index / 10_000,
          lat: 49.7 + index / 10_000,
          dwellMinutes: 0
        })),
        vehicle: { profile: "car" },
        visibility: "private"
      },
      { now: "2026-09-02T18:00:00.000Z" }
    );
    await page.addInitScript((plan) => {
      localStorage.setItem("mapos:active-plan-v2", JSON.stringify(plan));
    }, largePlan);
    const batchSizes: number[] = [];
    await page.route("**/api/v2/routing/plan", async (route) => {
      const payload = route.request().postDataJSON() as {
        plan: typeof largePlan;
      };
      batchSizes.push(payload.plan.stops.length);
      const segments = payload.plan.segments.map((segment, index) => {
        const from = payload.plan.stops[index]!.location.coordinates;
        const to = payload.plan.stops[index + 1]!.location.coordinates;
        const alternative = {
          id: `large-route-${segment.id}`,
          providerId: "fixture-osrm",
          profile: "car",
          preference: "fast",
          geometry: { type: "LineString" as const, coordinates: [from, to] },
          distanceM: 100,
          durationS: 10,
          warnings: [],
          computedAt: "2026-09-02T18:00:00.000Z"
        };
        return {
          ...segment,
          status: "ready",
          provider: "fixture-osrm",
          alternatives: [alternative],
          selectedAlternativeId: alternative.id
        };
      });
      await route.fulfill({
        json: {
          plan: { ...payload.plan, segments },
          routedSegmentIds: segments.map((segment) => segment.id),
          failedSegmentIds: [],
          stats: {
            eligibleSegments: segments.length,
            providerCalls: segments.length,
            cacheHits: 0,
            maxConcurrency: 4
          }
        }
      });
    });

    await page.goto("/?mode=planning&lng=13.3775&lat=49.7475&z=12");
    await expect(page.getByTestId("planning-panel")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("105 celkem · bez limitu provideru")).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Název zastávky 1", exact: true })).toHaveValue(
      "Místo 1"
    );
    await expect(
      page.getByRole("combobox", { name: "Název zastávky 25", exact: true })
    ).toHaveValue("Místo 25");
    await expect(
      page.getByRole("combobox", { name: "Název zastávky 26", exact: true })
    ).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Stránkování zastávek" })).toContainText(
      "1–25 z 105"
    );
    await page.getByRole("button", { name: "Další" }).click();
    await expect(
      page.getByRole("combobox", { name: "Název zastávky 26", exact: true })
    ).toHaveValue("Místo 26");

    await page.getByTestId("calculate-plan").click();
    await expect(page.getByTestId("planning-result")).toContainText("104/104", {
      timeout: 20_000
    });
    expect(batchSizes).toEqual([100, 6]);

    const saveRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" && new URL(request.url()).pathname === "/api/v2/plans"
    );
    await page.getByTestId("save-plan").click();
    const saved = (await saveRequest).postDataJSON() as { plan: { stops: unknown[] } };
    expect(saved.plan.stops).toHaveLength(105);
    await expect(page.getByTestId("toast")).toContainText("uložený v Moje");
  });

  test("externí mapy dostanou podporované odkazy bez tichého zahození bodů", async ({ page }) => {
    await page.goto("/?mode=planning&lng=14&lat=50&z=14");
    await expect(page.getByTestId("planning-panel")).toBeVisible({ timeout: 20_000 });

    const google = page.getByTestId("handoff-google");
    const mapy = page.getByTestId("handoff-mapy");
    const osm = page.getByTestId("handoff-osm");
    await expect(google).toHaveAttribute("href", /^https:\/\/www\.google\.com\/maps\/dir\//);
    await expect(mapy).toHaveAttribute("href", /^https:\/\/mapy\.com\/fnc\/v1\/route/);
    await expect(osm).toHaveAttribute("href", /^https:\/\/www\.openstreetmap\.org\/directions/);
    for (const link of [google, mapy, osm]) {
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", /noopener/);
    }
  });

  test("multifunkční zastávka rozliší GPS, geokodér a potvrzovaný AI návrh", async ({ page }) => {
    await page.route(/\/(?:api\/)?geocode(?:\?|$)/, (route) =>
      route.fulfill({
        json: {
          results: [{ display_name: "Plzeň, Česko", lat: "49.7475", lon: "13.3775" }]
        }
      })
    );
    await page.goto("/?mode=planning&lng=13.3775&lat=49.7475&z=14");
    await expect(page.getByTestId("planning-panel")).toBeVisible({ timeout: 20_000 });
    const input = page.getByLabel("Název zastávky 1");

    await input.fill("49°48′00″N 13°24′00″E");
    await page.getByRole("option", { name: /Použít GPS/ }).click();
    await expect(page.getByLabel("Souřadnice zastávky 1")).toContainText("49.80000, 13.40000");

    await input.fill("Plzeň");
    await expect(page.locator(".planner-stop-intent")).toContainText("Město nebo region");
    await expect(page.locator(".planner-stop-intent")).toContainText("MapOS geokodér");
    const geocoded = page.getByRole("option", { name: /Plzeň, Česko/ });
    await expect(geocoded).toBeVisible();
    await expect(geocoded).toContainText("Ověřená poloha · MapOS geokodér");
    await geocoded.click();
    await expect(input).toHaveValue("Plzeň, Česko");

    await input.fill("ai: najdi mi nejbližší bar");
    await expect(page.getByTestId("stop-ai-1")).toContainText("AI hledání");
    await expect(page.getByTestId("stop-ai-1")).toContainText("nic nezmění bez potvrzení");
    const aiRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" && new URL(request.url()).pathname === "/api/v2/ai/orchestrate"
    );
    await page.getByTestId("stop-ai-1").click();
    await aiRequest;
    await expect(page.getByTestId("planner-ai-results")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("map-picker-host")).toContainText("Potvrď AI návrh zastávky");
    await page.getByTestId("map-picker-select").click();
    await expect(input).not.toHaveValue("Plzeň, Česko");
    await expect(page.getByTestId("toast")).toContainText("AI návrh zastávky byl potvrzen");
  });

  test("spodní akce kopírují itinerář a AI diskutuje plán bez automatické změny", async ({
    page
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (value: string) => {
            (window as unknown as { __copiedPlan?: string }).__copiedPlan = value;
          }
        }
      });
    });
    await page.goto("/?mode=planning&lng=13.3775&lat=49.7475&z=14");
    await expect(page.getByTestId("planning-panel")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Přidat z mapy" })).toHaveCount(0);

    await page.getByTestId("copy-plan-itinerary").click();
    await expect(page.getByTestId("toast")).toContainText("Itinerář je zkopírovaný");
    const copied = await page.evaluate(
      () => (window as unknown as { __copiedPlan?: string }).__copiedPlan
    );
    expect(copied).toContain("1. Start");
    expect(copied).toContain("GPS:");

    await page.getByTestId("plan-ai-toggle").click();
    await expect(page.getByTestId("plan-ai-discussion")).toBeVisible();
    await page
      .getByLabel("Co chceš s plánem probrat?")
      .fill("Který úsek plánu je potřeba zkontrolovat?");
    const request = page.waitForRequest(
      (candidate) =>
        candidate.method() === "POST" &&
        new URL(candidate.url()).pathname === "/api/v2/ai/plan-discuss"
    );
    await page.getByRole("button", { name: "Odeslat AI" }).click();
    const payload = (await request).postDataJSON() as {
      externalModelConsent: boolean;
      plan: { revision: number };
    };
    expect(payload.externalModelConsent).toBe(true);
    const revision = payload.plan.revision;
    await expect(page.getByText("AI doporučení")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("plan-ai-discussion")).toContainText(
      "žádná změna nebyla provedena"
    );
    await expect(page.getByText(`Revize ${revision}`, { exact: true })).toBeVisible();
  });

  test("uložený plán má odvolatelný read-only odkaz a trvalou vícekolovou AI konverzaci", async ({
    page,
    context
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (value: string) => {
            (window as unknown as { __copiedShare?: string }).__copiedShare = value;
          }
        }
      });
    });
    await page.goto("/?mode=planning&lng=13.3775&lat=49.7475&z=14");
    await expect(page.getByTestId("planning-panel")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("plan-name").fill("Sdílený plán na víkend");
    await page.getByTestId("save-plan").click();
    await expect(page.getByTestId("toast")).toContainText("uložený v Moje");

    const manager = page.getByTestId("plan-share-manager");
    await manager.locator("summary").click();
    const createLink = page.getByTestId("create-plan-share");
    await expect(createLink).toBeEnabled();
    const createRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        /\/api\/v2\/plans\/[^/]+\/shares$/.test(new URL(request.url()).pathname)
    );
    await createLink.click();
    await createRequest;
    const shareUrl = await page.getByTestId("plan-share-url").locator("input").inputValue();
    const parsedShareUrl = new URL(shareUrl);
    expect(parsedShareUrl.pathname).toBe("/s");
    expect(parsedShareUrl.hash).toMatch(/^#plan=[A-Za-z0-9_-]{43}$/);
    await expect(page.getByTestId("toast")).toContainText("zkopírovaný");

    const viewer = await context.newPage();
    await viewer.goto(shareUrl);
    await expect(viewer.getByTestId("shared-plan-banner")).toContainText("jen pro čtení", {
      timeout: 20_000
    });
    await expect(viewer.getByTestId("shared-plan-banner")).toContainText(
      "Soukromé poznámky a AI konverzace vlastníka nejsou součástí odkazu"
    );
    await expect(viewer.getByTestId("plan-name")).toHaveValue("Sdílený plán na víkend");
    await expect(viewer.getByTestId("plan-name")).toBeDisabled();
    await expect(viewer.getByTestId("plan-ai-toggle")).toBeDisabled();
    await expect(viewer.getByTestId("plan-share-manager")).toHaveCount(0);
    await expect(viewer.getByTestId("save-plan")).toContainText("Uložit vlastní kopii");

    await page.getByRole("button", { name: "Odvolat" }).click();
    await expect(page.getByText("Odvolaný odkaz")).toBeVisible();
    await viewer.reload();
    await expect(viewer.getByRole("alert")).toContainText("nebyl nalezen nebo byl odvolán", {
      timeout: 20_000
    });
    await viewer.close();

    await page.getByTestId("plan-ai-toggle").click();
    await expect(page.getByTestId("plan-ai-discussion")).toBeVisible();
    const question = page.getByLabel("Co chceš s plánem probrat?");
    await question.fill("Kde je nejlepší udělat první pauzu?");
    const firstRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        /\/api\/v2\/ai\/plans\/[^/]+\/discussion$/.test(new URL(request.url()).pathname)
    );
    await page.getByRole("button", { name: "Odeslat AI" }).click();
    const firstPayload = (await firstRequest).postDataJSON() as Record<string, unknown>;
    expect(firstPayload).not.toHaveProperty("plan");
    expect(firstPayload).not.toHaveProperty("conversationId");
    await expect(page.getByTestId("plan-ai-thread").locator("article")).toHaveCount(2, {
      timeout: 20_000
    });

    await question.fill("A jak navázat druhý den?");
    const secondRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        /\/api\/v2\/ai\/plans\/[^/]+\/discussion$/.test(new URL(request.url()).pathname)
    );
    await page.getByRole("button", { name: "Odeslat AI" }).click();
    const secondPayload = (await secondRequest).postDataJSON() as Record<string, unknown>;
    expect(secondPayload).toMatchObject({ baseRevision: 2 });
    expect(secondPayload).toHaveProperty("conversationId");
    expect(secondPayload).not.toHaveProperty("plan");
    await expect(page.getByTestId("plan-ai-thread").locator("article")).toHaveCount(4, {
      timeout: 20_000
    });

    await page.reload();
    await page.getByTestId("plan-ai-toggle").click();
    await expect(page.getByTestId("plan-ai-thread").locator("article")).toHaveCount(4, {
      timeout: 20_000
    });
  });
});
