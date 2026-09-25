import { expect, test } from "./fixtures/offlineTest";

test("closing social during startup cannot start a late world session", async ({ page }) => {
  test.setTimeout(120_000);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let capabilities = 0;
  let sessions = 0;
  await page.route("**/v2/world/capabilities", async (route) => {
    capabilities++;
    await pending;
    await route.fulfill({ json: { testEnabled: false } });
  });
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/v2/world/session")) sessions++;
  });
  try {
    await page.goto("/?mode=discover&lng=14.42&lat=50.08&z=8");
    await expect(page.getByTestId("mode-bar")).toBeVisible({ timeout: 60_000 });
    await page.evaluate(async () => {
      const path = "/src/world/runtime.ts";
      (await import(path)).worldRuntime.openSocial();
    });
    await expect.poll(() => capabilities).toBe(1);
    await page.evaluate(async () => {
      const path = "/src/world/runtime.ts";
      (await import(path)).worldRuntime.patch({ socialOpen: false });
    });
    release();
    // Cross two transport ticks; an obsolete capability response must not create a session.
    await page.waitForTimeout(2200);
    expect(sessions).toBe(0);
    expect(
      await page.evaluate(async () => {
        const path = "/src/world/runtime.ts";
        return (await import(path)).worldRuntime.get().connected;
      })
    ).toBe(false);
  } finally {
    release();
  }
});

test("a late session response cannot reopen live transport after social closes", async ({
  page
}) => {
  test.setTimeout(120_000);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = false;
  const sockets: string[] = [];
  page.on("websocket", (socket) => {
    if (socket.url().includes("/v2/world/live")) sockets.push(socket.url());
  });
  await page.route("**/v2/world/capabilities", (route) =>
    route.fulfill({ json: { testEnabled: false } })
  );
  await page.route("**/v2/world/session", async (route) => {
    requested = true;
    await pending;
    await route.fulfill({ json: { id: "obsolete-session", mode: "gps" } });
  });
  try {
    await page.goto("/?mode=discover&lng=14.42&lat=50.08&z=8");
    await expect(page.getByTestId("mode-bar")).toBeVisible({ timeout: 60_000 });
    await page.evaluate(async () => {
      const path = "/src/world/runtime.ts";
      (await import(path)).worldRuntime.openSocial();
    });
    await expect.poll(() => requested).toBe(true);
    await page.evaluate(async () => {
      const path = "/src/world/runtime.ts";
      (await import(path)).worldRuntime.patch({ socialOpen: false });
    });
    release();
    await page.waitForTimeout(2200);
    expect(sockets).toEqual([]);
    expect(
      await page.evaluate(async () => {
        const path = "/src/world/runtime.ts";
        return (await import(path)).worldRuntime.get().session;
      })
    ).toBeNull();
  } finally {
    release();
  }
});

test("ordinary map defers world UI until the social panel opens", async ({ page }) => {
  test.setTimeout(120_000);
  const worldUiRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/world\/(WorldHud|WorldSocial)\.tsx/.test(request.url()))
      worldUiRequests.push(request.url());
  });
  await page.goto("/?mode=discover&lng=14.42&lat=50.08&z=8");
  await expect(page.getByTestId("mode-bar")).toBeVisible({ timeout: 60_000 });
  expect(worldUiRequests).toEqual([]);
  // Exercise the same state transition as the map's social entry, without entering the 3D game.
  await page.evaluate(async () => {
    const modulePath = "/src/world/runtime.ts";
    const { worldRuntime } = await import(modulePath);
    worldRuntime.openSocial();
  });
  await expect(page.getByTestId("world-social")).toBeVisible({ timeout: 30_000 });
  expect(worldUiRequests.some((url) => url.includes("WorldSocial"))).toBe(true);
  await page.getByRole("button", { name: "Zavřít okolí" }).click();
  await expect(page.getByTestId("world-social")).toBeHidden();
});
