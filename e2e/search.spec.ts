import { expect, test } from "./fixtures/offlineTest";

test.describe("transparent global search", () => {
  test("shows grounded geocoder metadata and never calls AI before explicit confirmation", async ({
    page
  }) => {
    let aiRequests = 0;
    let geocodeFixtures = 0;
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/v2/ai/orchestrate"
      ) {
        aiRequests += 1;
      }
    });
    await page.route(/geocode/u, (route) => {
      geocodeFixtures += 1;
      return route.fulfill({
        json: {
          results: [
            {
              display_name: "Plzeň, Česko",
              lat: "49.7475",
              lon: "13.3775",
              type: "city",
              hierarchy: ["Plzeňský kraj", "Česko"],
              source: { id: "fixture", label: "MapOS offline geokodér" },
              confidence: { level: "high", label: "vysoká", basis: "provider-order" }
            }
          ]
        }
      });
    });

    // Start without POI so the AI layer change must be previewed and confirmed.
    await page.goto("/?layers=earthquakes&lng=13.3775&lat=49.7475&z=13");
    await page.getByTestId("overflow-btn").click();
    await page.getByTestId("overflow-osm-poi").click();
    await page.getByTestId("overflow-btn").click();
    const input = page.getByTestId("place-search");
    await input.fill("najdi mi nejbližší bar");
    await expect.poll(() => geocodeFixtures).toBeGreaterThan(0);

    const geocoderResult = page.getByRole("button", { name: /Plzeň, Česko/ });
    await expect(geocoderResult).toContainText("Obec");
    await expect(geocoderResult).toContainText("Plzeňský kraj › Česko");
    await expect(geocoderResult).toContainText("MapOS offline geokodér");
    await expect(geocoderResult).toContainText("Jistota: vysoká");
    expect(aiRequests).toBe(0);

    await page.getByTestId("search-offer-ai").click();
    await expect(page.getByTestId("search-run-ai")).toBeVisible();
    expect(aiRequests).toBe(0);

    await page.getByTestId("search-run-ai").click();
    await expect(page.getByTestId("search-ai-layer-preview")).toContainText("nic se nezapne samo", {
      ignoreCase: true
    });
    expect(aiRequests).toBe(0);

    const aiRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" && new URL(request.url()).pathname === "/api/v2/ai/orchestrate"
    );
    await page
      .getByTestId("search-ai-layer-preview")
      .getByRole("button", { name: "Potvrdit a pokračovat" })
      .click();
    const request = await aiRequest;
    expect(request.postDataJSON()).toMatchObject({
      conversation: { mode: "new", scope: { type: "global" } },
      reference: { source: "map-center" },
      activeLayerIds: ["osm-poi"],
      preciseLocationConsent: false
    });
    await expect(page.getByTestId("search-ai-results")).toContainText("Irish Pub");
    expect(aiRequests).toBe(1);

    await page.getByTestId("mode-personal").click();
    await input.focus();
    await expect(page.getByTestId("search-ai-results")).toContainText("Irish Pub");
    expect(aiRequests).toBe(1);
    await page.getByTestId("mode-planning").click();
    await input.focus();

    await page.getByTestId("search-ai-preview-plan").click();
    await expect(page.getByTestId("toast")).toContainText("pracovní body");
    await expect
      .poll(() =>
        page.evaluate(() => {
          return (
            window.__maposMap
              ?.querySourceFeatures("route-preview")
              .filter((feature) => feature.properties?.kind === "stop").length ?? 0
          );
        })
      )
      .toBeGreaterThanOrEqual(1);

    await page
      .getByTestId("search-ai-results")
      .getByRole("button", { name: /Irish Pub/ })
      .click();
    await expect(page.getByTestId("map-picker-host")).toContainText("Potvrď AI návrh místa");
    await page.getByTestId("map-picker-select").click();
    await input.focus();
    await expect(page.getByTestId("search-ai-selection")).toContainText("Irish Pub");

    await page.getByTestId("search-ai-create-plan").click();
    await expect(page.getByTestId("planning-panel")).toBeVisible();
    await expect(page.getByTestId("plan-name")).toHaveValue("AI návrh: najdi mi nejbližší bar");
    await expect(page.getByLabel("Název zastávky 2")).toHaveValue("Irish Pub");
    await expect(page.getByTestId("toast")).toContainText("editovatelného plánu");
  });

  test("empty search opens the reusable map picker and confirms the current centre", async ({
    page
  }) => {
    await page.goto("/?lng=13.3775&lat=49.7475&z=13");
    await page.getByTestId("place-search").focus();
    await page.getByRole("button", { name: "Vybrat místo na mapě" }).click();
    await expect(page.getByTestId("map-picker-host")).toContainText("Vyber místo pro hledání");
    await expect(page.getByTestId("map-picker-host")).toContainText("49.747500, 13.377500");
    await page.getByTestId("map-picker-select").click();
    await expect(page.getByTestId("map-picker-host")).toHaveCount(0);
  });
});
