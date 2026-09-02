import { expect, test } from "./fixtures/offlineTest";

test("primary controls have names and utility focus returns after Escape", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?mode=planning&lng=13.3775&lat=49.7475&z=14");
  await expect(page.getByTestId("mode-bar")).toBeVisible({ timeout: 30_000 });

  const unnamed = await page
    .locator("button, input, select, textarea, [role=button]")
    .evaluateAll((elements) =>
      elements
        .filter((element) => {
          const hidden =
            element.getAttribute("aria-hidden") === "true" ||
            (element instanceof HTMLElement && element.offsetParent === null);
          if (hidden) return false;
          const aria = element.getAttribute("aria-label")?.trim();
          const labelledBy = element.getAttribute("aria-labelledby")?.trim();
          const title = element.getAttribute("title")?.trim();
          const text = element.textContent?.trim();
          const label =
            element instanceof HTMLInputElement && element.labels
              ? [...element.labels].map((item) => item.textContent?.trim()).join(" ")
              : "";
          return !aria && !labelledBy && !title && !text && !label;
        })
        .map((element) => element.outerHTML.slice(0, 240))
    );
  expect(unnamed, "visible interactive controls need an accessible name").toEqual([]);

  const settings = page.getByTestId("settings-btn");
  await settings.focus();
  await page.keyboard.press("Enter");
  const drawer = page.getByTestId("right-utility-drawer");
  await expect(drawer).toHaveAttribute("role", "dialog");
  await expect(drawer.getByRole("button", { name: /Zavřít/ })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(settings).toBeFocused();
});

test("mobile keeps a non-map surface usable with keyboard and 200% text", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?mode=planning&lng=13.3775&lat=49.7475&z=14");
  await expect(page.getByTestId("bottom-nav")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("mode-planning").click();
  await expect(page.getByTestId("planning-panel")).toBeVisible();

  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  await expect(page.getByTestId("bottom-nav")).toBeVisible();
  await expect(page.getByTestId("planning-panel")).toBeVisible();
  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  );
  expect(horizontalOverflow, "200% text must not create page-level horizontal scrolling").toBe(
    false
  );

  await page.keyboard.press("Tab");
  const focusIsVisibleControl = await page.evaluate(() => {
    const element = document.activeElement;
    return (
      element instanceof HTMLElement &&
      element !== document.body &&
      element.getAttribute("aria-hidden") !== "true" &&
      element.offsetParent !== null
    );
  });
  expect(focusIsVisibleControl).toBe(true);
});

test("reduced-motion preference removes meaningful CSS animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?mode=planning");
  await expect(page.getByTestId("mode-bar")).toBeVisible({ timeout: 30_000 });
  expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(
    true
  );
  const longMotion = await page.locator("body *").evaluateAll(
    (elements) =>
      elements
        .filter((element) => element instanceof HTMLElement && element.offsetParent !== null)
        .map((element) => getComputedStyle(element))
        .filter((style) => {
          const durations = `${style.animationDuration},${style.transitionDuration}`
            .split(",")
            .map((value) => value.trim())
            .map((value) =>
              value.endsWith("ms") ? Number.parseFloat(value) : Number.parseFloat(value) * 1000
            );
          return durations.some((duration) => Number.isFinite(duration) && duration > 100);
        }).length
  );
  expect(longMotion, "reduced-motion mode should not retain long CSS motion").toBe(0);
});

test("Settings stays operable on mobile with 200% text", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByTestId("settings-btn").click();
  await expect(page.getByTestId("settings-registry")).toBeVisible();

  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  const drawer = page.getByTestId("right-utility-drawer");
  await expect(drawer).toBeVisible();
  const overflow = await drawer.evaluate(
    (element) => element.scrollWidth > element.clientWidth + 1
  );
  expect(overflow, "Settings must not gain horizontal scrolling at 200% text").toBe(false);

  const unnamed = await drawer.locator("button, a, input, [role=switch]").evaluateAll((elements) =>
    elements
      .filter((element) => element instanceof HTMLElement && element.offsetParent !== null)
      .filter((element) => {
        const aria = element.getAttribute("aria-label")?.trim();
        const title = element.getAttribute("title")?.trim();
        const text = element.textContent?.trim();
        return !aria && !title && !text;
      })
      .map((element) => element.outerHTML.slice(0, 200))
  );
  expect(unnamed, "visible Settings controls need an accessible name").toEqual([]);
});
