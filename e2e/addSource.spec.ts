import { expect, test } from "./fixtures/offlineTest";

/**
 * §C4: a layer from a URL nobody wrote code for.
 *
 * The whole adapter stack exists so that pasting a public service's address produces a working
 * layer — with its own name, legend and attribution — without a code change. That claim is only
 * true end to end, so this drives the real path: the offline API probes the fixture WMS through
 * `wmsAdapter`, stores the manifest the adapter built, and the browser then requests tiles from
 * the template that manifest carries.
 *
 * The fixture service lives in `apps/api/src/services/sourceFixtures.ts` and answers with the
 * bytes a real WMS answers with, so the parsing under test is the parsing that ships.
 */
const WMS_URL = "https://example.wms/service?service=WMS&request=GetCapabilities";

test("long WMS time series uses a compact selector on mobile and changes requested tiles", async ({
  page
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const dates: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("example.wms/service")) {
      const date = new URL(request.url()).searchParams.get("time");
      if (date) dates.push(date);
    }
  });
  const panel = await openLayersSection(page);
  await panel.getByTestId("add-source-open").click();
  const dialog = page.getByTestId("add-source-dialog");
  await dialog.getByTestId("add-source-url").fill(WMS_URL);
  await dialog.getByTestId("add-source-probe").click();
  await dialog.getByTestId("add-source-sublayer-vodni-toky").click();
  await dialog.getByTestId("add-source-continue").click();
  await dialog.getByTestId("add-source-name").fill("Time series");
  await dialog.getByTestId("add-source-save").click();
  await expect(dialog).toBeHidden();
  await page.getByTestId("layers-btn").click();
  await page.getByTestId("overflow-menu").getByRole("switch", { name: "Time series" }).click();
  await expect.poll(() => dates.includes("2026-09-01")).toBe(true);
  // The one settings editor lives inline under the row, not in a strip over the map.
  await page
    .getByTestId("overflow-menu")
    .getByRole("button", { name: "Nastavení: Time series" })
    .click();
  await page.getByRole("combobox", { name: "Čas UTC" }).click();
  await page.getByRole("option", { name: "2026-08-15", exact: true }).click();
  await expect.poll(() => dates.includes("2026-08-15")).toBe(true);
});

async function openLayersSection(page: import("@playwright/test").Page) {
  await page.goto("/?mode=personal&lng=13.3775&lat=49.7475&z=10");
  const panel = page.getByTestId("personal-panel");
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await panel.getByTestId("personal-accordion-layers").click();
  return panel;
}

test.describe("přidat zdroj z URL", () => {
  test("a pasted WMS becomes a layer whose tiles the map then requests", async ({ page }) => {
    const tileRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("example.wms/service")) tileRequests.push(request.url());
    });

    const panel = await openLayersSection(page);
    await panel.getByTestId("add-source-open").click();

    const dialog = page.getByTestId("add-source-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("add-source-url").fill(WMS_URL);
    await dialog.getByTestId("add-source-probe").click();

    // The service publishes two drawable layers and one group, so a choice is genuinely needed
    // and the group must not be offered as one of the options.
    const sublayers = dialog.getByTestId("add-source-sublayers");
    await expect(sublayers).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByRole("checkbox")).toHaveCount(2);

    await dialog.getByTestId("add-source-sublayer-zaplavy").click();
    await dialog.getByTestId("add-source-continue").click();

    // The name is pre-filled from the service's own title rather than left blank.
    await expect(dialog.getByTestId("add-source-name")).toHaveValue("Zkušební mapová služba");
    await dialog.getByTestId("add-source-name").fill("Zaplavy z URL");
    await dialog.getByTestId("add-source-save").click();

    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await expect(panel.getByTestId("user-layer-row")).toContainText("Zaplavy z URL");

    // Switching it on has to reach the service with a real GetMap, which is the only proof the
    // stored manifest is renderable rather than merely valid.
    await page.getByTestId("layers-btn").click();
    const drawer = page.getByTestId("overflow-menu");
    await expect(drawer).toBeVisible();
    // Found by its name, because the layer's id was minted by the server.
    await drawer.getByRole("switch", { name: "Zaplavy z URL" }).click();
    await expect.poll(() => tileRequests.length, { timeout: 20_000 }).toBeGreaterThan(0);

    const params = new URL(tileRequests[0]!).searchParams;
    expect(params.get("request")).toBe("GetMap");
    expect(params.get("layers")).toBe("zaplavy");
    expect(params.get("crs")).toBe("EPSG:3857");
    expect(params.get("transparent")).toBe("true");
    // The placeholder was substituted rather than sent literally.
    expect(params.get("bbox")!.split(",").map(Number).every(Number.isFinite)).toBe(true);
    expect(params.get("time")).toBe("2026-09-01");
    // The inline settings editor under the catalogue row changes the time dimension in place.
    await page
      .getByTestId("overflow-menu")
      .getByRole("button", { name: "Nastavení: Zaplavy z URL" })
      .click();
    await page.getByRole("button", { name: "2026-09-02", exact: true }).click();
    await expect
      .poll(() =>
        tileRequests.some((url) => new URL(url).searchParams.get("time") === "2026-09-02")
      )
      .toBe(true);
  });

  test("an address nothing recognises is refused without a request", async ({ page }) => {
    const panel = await openLayersSection(page);
    await panel.getByTestId("add-source-open").click();

    const dialog = page.getByTestId("add-source-dialog");
    await dialog.getByTestId("add-source-url").fill("https://example.org/places.json");
    await dialog.getByTestId("add-source-probe").click();

    // The message names what is supported, because the user's next action is to paste a
    // different address.
    await expect(dialog.getByTestId("add-source-error")).toContainText(/WMS/);
    await expect(dialog.getByTestId("add-source-sublayers")).toBeHidden();
  });

  test("an ArcGIS service reaches the ArcGIS adapter through the same wizard", async ({ page }) => {
    const panel = await openLayersSection(page);
    await panel.getByTestId("add-source-open").click();

    const dialog = page.getByTestId("add-source-dialog");
    await dialog
      .getByTestId("add-source-url")
      .fill("https://example.arcgis/arcgis/rest/services/test/MapServer");
    await dialog.getByTestId("add-source-probe").click();

    // One wizard, several protocols: the URL was routed by its path rather than by anything the
    // user had to tell us.
    await expect(dialog.getByTestId("add-source-sublayers")).toBeVisible({ timeout: 15_000 });
    await expect(dialog).toContainText("ArcGIS REST");
    await expect(dialog.getByTestId("add-source-sublayer-1")).toBeVisible();
  });
});

test("WMTS URL is parsed, saved and rendered; choosing a second layer replaces the first", async ({
  page
}) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("example.wmts/tiles/")) requests.push(request.url());
  });
  const panel = await openLayersSection(page);
  await panel.getByTestId("add-source-open").click();
  const dialog = page.getByTestId("add-source-dialog");
  await dialog.getByTestId("add-source-url").fill("https://example.wmts/wmts?SERVICE=WMTS");
  await dialog.getByTestId("add-source-probe").click();
  await expect(dialog.getByTestId("add-source-sublayers")).toBeVisible();
  await dialog.getByTestId("add-source-sublayer-clouds").click();
  await dialog.getByTestId("add-source-sublayer-snow").click();
  await expect(dialog.getByTestId("add-source-sublayer-clouds")).not.toBeChecked();
  await dialog.getByTestId("add-source-continue").click();
  await dialog.getByTestId("add-source-name").fill("WMTS Snow");
  await dialog.getByTestId("add-source-save").click();
  await expect(dialog).toBeHidden();
  await page.getByTestId("layers-btn").click();
  await page.getByTestId("overflow-menu").getByRole("switch", { name: "WMTS Snow" }).click();
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  expect(requests.every((url) => /\/tiles\/snow\/\d+\/\d+\/\d+\.png$/.test(url))).toBe(true);
});

test("FeatureServer import queries the stored source on activation and after a map move", async ({
  page
}) => {
  const boxes: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (/\/v2\/sources\/layers\/[^/]+\/features$/.test(url.pathname))
      boxes.push(url.searchParams.get("bbox") ?? "");
  });
  const panel = await openLayersSection(page);
  await panel.getByTestId("add-source-open").click();
  const dialog = page.getByTestId("add-source-dialog");
  await dialog
    .getByTestId("add-source-url")
    .fill("https://example.arcgis/arcgis/rest/services/test/FeatureServer");
  await dialog.getByTestId("add-source-probe").click();
  await expect(dialog.getByTestId("add-source-name")).toBeVisible();
  await dialog.getByTestId("add-source-name").fill("ArcGIS Points");
  await dialog.getByTestId("add-source-save").click();
  await expect(dialog).toBeHidden();
  await page.getByTestId("layers-btn").click();
  const drawer = page.getByTestId("overflow-menu");
  await drawer.getByRole("switch", { name: "ArcGIS Points" }).click();
  await expect.poll(() => boxes.length).toBeGreaterThan(0);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const names =
          window.__maposMap?.queryRenderedFeatures().map((feature) => feature.properties?.name) ??
          [];
        return names.includes("ArcGIS místo") && names.includes("ArcGIS trasa");
      })
    )
    .toBe(true);
  const first = boxes[0];
  await page.keyboard.press("Escape");
  const canvas = page.locator(".maplibregl-canvas");
  const bounds = await canvas.boundingBox();
  expect(bounds).toBeTruthy();
  await page.mouse.move(bounds!.x + bounds!.width * 0.65, bounds!.y + bounds!.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + bounds!.width * 0.85, bounds!.y + bounds!.height * 0.5, {
    steps: 12
  });
  await page.mouse.up();
  await expect.poll(() => boxes.some((box) => box !== first), { timeout: 20000 }).toBe(true);
});
