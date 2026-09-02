import { expect, test, type Page } from "@playwright/test";

async function blockExternalNetwork(page: Page): Promise<string[]> {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)) return;
    if (url.protocol === "blob:" || url.protocol === "data:") return;
    externalRequests.push(request.url());
  });
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (
      (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)) ||
      url.protocol === "blob:" ||
      url.protocol === "data:"
    ) {
      await route.continue();
      return;
    }
    await route.abort("blockedbyclient");
  });
  return externalRequests;
}

test("runs two clean-room registrations offline with accessible, reduced-motion controls", async ({
  page
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const externalRequests = await blockExternalNetwork(page);
  await page.goto("/");

  await expect(page.locator("body")).toHaveAttribute("data-list-state", "ready");
  await expect(page.locator("[data-runtime-layer]")).toHaveCount(2);
  await expect(page.locator('[data-runtime-layer="starter.public-parks"]')).toContainText(
    "Stromovka"
  );
  await expect(page.locator('[data-runtime-layer="starter.drinking-water"]')).toContainText(
    "Výstaviště fountain"
  );
  await expect(page.locator("body")).toHaveAttribute("data-map-state", "ready");

  const undersizedTargets = await page
    .locator("[data-runtime-layer] button, #fit-features")
    .evaluateAll((buttons) =>
      buttons.flatMap((button) => {
        const bounds = button.getBoundingClientRect();
        return bounds.width < 44 || bounds.height < 44
          ? [{ text: button.textContent, width: bounds.width, height: bounds.height }]
          : [];
      })
    );
  expect(undersizedTargets).toEqual([]);

  await page.getByRole("button", { name: "Stromovka" }).click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-camera-action",
    "focus:starter:park:stromovka"
  );
  await expect(page.locator("body")).toHaveAttribute("data-camera-transition", "jump");
  expect(externalRequests).toEqual([]);
});

test("keeps the primary data UI when WebGL initialisation fails", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      contextId: string,
      ...args: unknown[]
    ): RenderingContext | null {
      if (contextId.toLowerCase().includes("webgl")) return null;
      return original.call(this, contextId, ...args) as RenderingContext | null;
    };
  });
  const externalRequests = await blockExternalNetwork(page);
  await page.goto("/");

  await expect(page.locator("body")).toHaveAttribute("data-list-state", "ready");
  await expect(page.locator("body")).toHaveAttribute("data-map-state", "unavailable");
  await expect(page.locator("#map-fallback")).toBeVisible();
  await expect(page.getByRole("button", { name: "Stromovka" })).toBeVisible();
  await page.getByRole("button", { name: "Stromovka" }).click();
  await expect(page.getByRole("status")).toContainText("accessible list is ready");
  expect(externalRequests).toEqual([]);
});
