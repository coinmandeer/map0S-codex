import { expect, test } from "./fixtures/offlineTest";

test.describe("transparent global search", () => {
  test("shows grounded geocoder metadata and never calls AI before explicit confirmation", async ({
    page
  }) => {
    let aiRequests = 0;
    let geocodeFixtures = 0;
    page.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === "/api/v2/ai/chat") {
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

    await page.goto("/?layers=earthquakes&lng=13.3775&lat=49.7475&z=13");
    await expect(page.getByTestId("place-search")).toBeVisible();
    const activeLayerIds = await page.evaluate(async () => {
      const { getMapStore } = await import(/* @vite-ignore */ "/src/store/mapStore.ts");
      return Object.entries(getMapStore().activeLayers)
        .filter(([, state]) => state.visible)
        .map(([id]) => id);
    });
    const input = page.getByTestId("place-search");
    await input.fill("Plzeň");
    await expect.poll(() => geocodeFixtures).toBeGreaterThan(0);

    // One line of name and one of hierarchy; the kind is the icon's label and the geocoder is
    // credited once for the whole list rather than on every row.
    const geocoderResult = page.getByRole("option", { name: /Plzeň/ });
    await expect(geocoderResult).toHaveAccessibleName(/Obec|Municipality/);
    await expect(geocoderResult).toContainText("Plzeňský kraj › Česko");
    await expect(
      page.getByRole("dialog", { name: /Návrhy hledání|Search suggestions/ })
    ).toContainText("MapOS offline geokodér");
    expect(aiRequests).toBe(0);

    await input.fill("najdi mi nejbližší bar");
    // Anything that is not a suggestion is a question: Enter asks it, with the current context,
    // and verified results land in the left conversation panel.
    await expect(page.getByTestId("search-ai-hint")).toBeVisible();
    expect(aiRequests).toBe(0);
    const aiRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" && new URL(request.url()).pathname === "/api/v2/ai/chat"
    );
    await input.press("Enter");
    const request = await aiRequest;
    expect(request.postDataJSON()).toMatchObject({
      message: "najdi mi nejbližší bar",
      context: { activeLayerIds },
      consent: { preciseLocation: false }
    });
    await expect(page.getByTestId("ai-panel-thread")).toContainText("Irish Pub");
    expect(aiRequests).toBe(1);
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const { getMapStore } = await import(/* @vite-ignore */ "/src/store/mapStore.ts");
          const store = getMapStore();
          const { artifactSnapshot } = await import(
            /* @vite-ignore */ "/src/ui/ai/artifactState.ts"
          );
          return (
            artifactSnapshot().length > 0 ||
            Boolean(
              store.currentAnswerLayerId && store.activeLayers[store.currentAnswerLayerId]?.visible
            )
          );
        })
      )
      .toBe(true);
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

test("water seasonality is searchable and its controls preserve the suggestion panel", async ({
  page
}) => {
  await page.goto("/");
  const search = page.getByTestId("place-search");
  await search.fill("seasonal water");
  const layers = page.getByRole("region", { name: "Vrstvy", exact: true });
  await expect(layers).toContainText("Sezónnost");
  const toggle = layers.getByRole("switch").first();
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  const slider = layers.getByRole("slider").first();
  await slider.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(layers).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { getMapStore } = await import(/* @vite-ignore */ "/src/store/mapStore.ts");
        return getMapStore().activeLayers["jrc-water-seasonality"]?.visible;
      })
    )
    .toBe(true);
  await page.reload();
  await expect(search).toHaveValue("");
  await search.fill("seasonal water");
  await expect(layers.getByRole("switch").first()).toHaveAttribute("aria-checked", "false");
});
