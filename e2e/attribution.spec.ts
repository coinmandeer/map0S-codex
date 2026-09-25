import { expect, test } from "./fixtures/offlineTest";
import { catalogSwitch } from "./fixtures/mapPanel";

/** A 1x1 transparent PNG, so the spec never depends on the real tile servers being up. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

test.describe("attribution", () => {
  test("a layer credits its source while it is on, and stops when it is off", async ({ page }) => {
    await page.route("**/*.tile-cyclosm.openstreetmap.fr/**", (route) =>
      route.fulfill({ contentType: "image/png", body: PNG })
    );
    await page.goto("/");

    const attribution = page.locator(".maplibregl-ctrl-attrib-inner");
    await expect(attribution).not.toContainText("CyclOSM");

    const toggle = await catalogSwitch(page, "cyclosm");
    await toggle.click();
    await expect(attribution).toContainText("CyclOSM", { timeout: 15_000 });

    await toggle.click();
    await expect(attribution).not.toContainText("CyclOSM", { timeout: 15_000 });
  });

  test("About lists every source, including the ones that are switched off", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("settings-btn").click();

    const list = page.getByTestId("attribution-list");
    await page.getByTestId("attribution-list-sources").click();

    await expect(list).toContainText("OpenStreetMap");
    // Off by default, so its presence proves the list is the catalogue and not the live credits.
    await expect(list).toContainText("Overture");
  });
});
