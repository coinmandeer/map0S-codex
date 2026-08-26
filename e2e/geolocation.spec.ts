import { expect, test } from "@playwright/test";

const PRAGUE = { longitude: 14.4213, latitude: 50.0874 };

/** The button used to call `getCurrentPosition` with no options, so the spec's default
 *  `timeout: Infinity` meant a failed fix invoked neither callback — no move, no error, no
 *  explanation. The two failure paths below are exactly the ones that used to end in silence. */
test.describe("my location button", () => {
  test("centres the map on the device position", async ({ page, context }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation(PRAGUE);

    await page.goto("/");
    await page.getByTestId("mode-bar").waitFor({ timeout: 30_000 });
    await page.getByTestId("location-btn").click();

    await expect(page.getByTestId("toast")).toContainText("Jsi tady");
    await expect
      .poll(
        () => {
          const params = new URLSearchParams(new URL(page.url()).search);
          return Number(params.get("lat"));
        },
        { timeout: 15_000 }
      )
      .toBeCloseTo(PRAGUE.latitude, 1);
  });

  test("explains a denied permission instead of doing nothing", async ({ page, context }) => {
    await context.clearPermissions();
    await page.goto("/");
    await page.getByTestId("mode-bar").waitFor({ timeout: 30_000 });

    await page.getByTestId("location-btn").click();

    // The message has to name the fix (browser settings) rather than say "failed", because
    // retrying a denied permission never works.
    await expect(page.getByTestId("toast")).toContainText(/zakázaný|nastavení/i, {
      timeout: 20_000
    });
  });

  test("reports a timeout rather than hanging forever", async ({ page, context }) => {
    await context.grantPermissions(["geolocation"]);
    await page.goto("/");
    await page.getByTestId("mode-bar").waitFor({ timeout: 30_000 });

    // A position request that never settles is what the missing timeout turned into a silent
    // no-op; with an explicit timeout the user gets an answer either way.
    await page.evaluate(() => {
      navigator.geolocation.getCurrentPosition = (_success, failure, options) => {
        window.setTimeout(
          () =>
            failure?.({
              code: 3,
              message: "timeout",
              PERMISSION_DENIED: 1,
              POSITION_UNAVAILABLE: 2,
              TIMEOUT: 3
            } as GeolocationPositionError),
          Math.min(options?.timeout ?? 10_000, 1000)
        );
      };
    });

    await page.getByTestId("location-btn").click();

    await expect(page.getByTestId("toast")).toContainText(/dlouho|znovu/i, { timeout: 20_000 });
  });
});
