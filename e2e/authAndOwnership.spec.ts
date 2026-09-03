import { expect, test, type Page } from "./fixtures/offlineTest";

async function currentUser(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/auth/me", { credentials: "include" });
    return (await response.json()).user as {
      id: string;
      email: string;
      displayName: string;
      isGuest: boolean;
      xpTotal: number;
    } | null;
  });
}

test.describe("guest-first identity", () => {
  test("creates one persistent guest even under React StrictMode", async ({ page }) => {
    let guestRequests = 0;
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().endsWith("/auth/guest")) guestRequests += 1;
    });

    await page.goto("/");
    await expect.poll(() => currentUser(page), { timeout: 20_000 }).not.toBeNull();
    const before = await currentUser(page);
    expect(before?.isGuest).toBe(true);
    expect(before?.displayName).toMatch(/^Poutník /);
    expect(guestRequests).toBe(1);

    await page.reload();
    await expect.poll(() => currentUser(page), { timeout: 20_000 }).not.toBeNull();
    const after = await currentUser(page);
    expect(after?.id).toBe(before?.id);
    expect(guestRequests).toBe(2);
  });

  test("upgrades the guest in place instead of orphaning its progress", async ({ page }) => {
    await page.goto("/");
    await expect.poll(() => currentUser(page), { timeout: 20_000 }).not.toBeNull();
    const guest = await currentUser(page);
    expect(guest?.isGuest).toBe(true);

    const orbId = `orb:${guest!.id}:14.12345,50.12345`;
    const firstClaim = await page.evaluate(async (id) => {
      const response = await fetch("/api/game/orbs/collect", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orbIds: [id, id] })
      });
      return response.json();
    }, orbId);
    expect(firstClaim.progress).toMatchObject({ xpTotal: 10, acceptedCount: 1 });

    const replay = await page.evaluate(async (id) => {
      const response = await fetch("/api/game/orbs/collect", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orbIds: [id] })
      });
      return response.json();
    }, orbId);
    expect(replay.progress).toMatchObject({ xpTotal: 10, acceptedCount: 0 });

    await page.getByTestId("settings-btn").click();
    await page.getByTestId("settings-account").click();
    await expect(page.getByTestId("auth-sheet")).toContainText("Uložit profil");

    const email = `traveler-${Date.now()}@mapos.test`;
    await page.getByPlaceholder("Jméno").fill("Trvalý poutník");
    await page.getByTestId("auth-email").fill(email);
    await page.getByTestId("auth-password").fill("bezpecne-heslo");
    await page.getByTestId("auth-submit").click();

    await expect(page.getByTestId("auth-sheet")).toBeHidden();
    const registered = await currentUser(page);
    expect(registered).toMatchObject({
      id: guest?.id,
      email,
      displayName: "Trvalý poutník",
      isGuest: false,
      xpTotal: 10
    });

    const progress = await page.evaluate(async () => {
      const response = await fetch("/api/game/progress", { credentials: "include" });
      return (await response.json()).progress;
    });
    expect(progress).toMatchObject({ xpTotal: 10, collectedCount: 1 });
    expect(progress.collectedOrbIds).toContain(orbId);
  });
});

test.describe("community pin ownership", () => {
  test("renders one copy and prefers the editable personal representation", async ({ page }) => {
    const within = (requestUrl: string, features: unknown[]) => {
      const [west, south, east, north] = new URL(requestUrl).searchParams
        .get("bbox")!
        .split(",")
        .map(Number) as [number, number, number, number];
      return {
        type: "FeatureCollection",
        features: features.map((raw, index) => ({
          ...(raw as object),
          geometry: {
            type: "Point",
            coordinates: [
              west + ((east - west) * (index + 1)) / (features.length + 1),
              south + ((north - south) * (index + 1)) / (features.length + 1)
            ]
          }
        }))
      };
    };

    await page.route("**/layers/osm-poi/features**", (route) =>
      route.fulfill({
        json: within(route.request().url(), [
          {
            type: "Feature",
            properties: {
              id: "user:pin-owned",
              name: "Sloučená kopie",
              category: "user-pin",
              layerId: "osm-poi",
              sourceRefs: "user:pin-owned"
            }
          },
          {
            type: "Feature",
            properties: {
              id: "user:pin-other",
              name: "Cizí veřejný pin",
              category: "user-pin",
              layerId: "osm-poi",
              sourceRefs: "user:pin-other"
            }
          }
        ])
      })
    );
    await page.route("**/layers/user-layers/features**", (route) =>
      route.fulfill({
        json: within(route.request().url(), [
          {
            type: "Feature",
            properties: {
              id: "pin-owned",
              name: "Moje editovatelná kopie",
              category: "user-pin",
              layerId: "user-layers",
              userLayerId: "layer-own"
            }
          }
        ])
      })
    );

    await page.goto("/?layers=osm-poi,user-layers&mode=planning&lng=13.3775&lat=49.7475&z=14");
    const suggestions = page.locator(".planner-suggestions");
    await expect(suggestions).toContainText("Moje editovatelná kopie", { timeout: 20_000 });
    await expect(suggestions).toContainText("Cizí veřejný pin");
    await expect(suggestions).not.toContainText("Sloučená kopie");
    await expect(suggestions.getByRole("button")).toHaveCount(2);

    // With the personal layer off, the raw fused response becomes the owner again from cache.
    await page.goto("/?layers=osm-poi&mode=planning");
    const fusedSuggestions = page.locator(".planner-suggestions");
    await expect(fusedSuggestions).toContainText("Sloučená kopie", {
      timeout: 20_000
    });
    await expect(fusedSuggestions).not.toContainText("Moje editovatelná kopie");
    await expect(fusedSuggestions.getByRole("button")).toHaveCount(2);
  });
});

test.describe("user-layer CRUD and publishing", () => {
  test("creates a personal layer through the editor", async ({ page }) => {
    await page.goto("/");
    await expect.poll(() => currentUser(page), { timeout: 20_000 }).not.toBeNull();

    await page.getByTestId("mode-personal").click();
    await page.getByTestId("personal-accordion-layers").click();
    await page.getByTestId("manage-user-layers").click();
    await expect(page.getByTestId("edit-sheet")).toBeVisible();

    const name = `Moje výlety ${Date.now()}`;
    await page.getByTestId("new-layer-name").fill(name);
    await page.getByTestId("create-layer-btn").click();
    await expect(page.getByTestId("edit-sheet")).toContainText(name);
    await expect(page.getByRole("heading", { name: "Nastavení vrstvy" })).toBeVisible();

    const pinName = `Vrchol ${Date.now()}`;
    await page.getByTestId("pin-at-map-center").click();
    await page.getByTestId("pin-name-input").fill(pinName);
    await page.getByTestId("save-pin-btn").click();
    await expect(page.getByTestId("edit-sheet")).toContainText(pinName);

    const createdId = await page.evaluate(async (layerName) => {
      const response = await fetch("/api/user-layers", { credentials: "include" });
      const data = (await response.json()) as { layers: Array<{ id: string; name: string }> };
      return data.layers.find((layer) => layer.name === layerName)?.id ?? null;
    }, name);
    expect(createdId).not.toBeNull();
    const createdPins = await page.evaluate(async (layerId) => {
      const response = await fetch(`/api/user-layers/${layerId}/pins`, {
        credentials: "include"
      });
      return (await response.json()).pins as Array<{ name: string }>;
    }, createdId);
    expect(createdPins).toContainEqual(expect.objectContaining({ name: pinName }));
    await page.evaluate(async (layerId) => {
      await fetch(`/api/user-layers/${layerId}`, {
        method: "DELETE",
        credentials: "include"
      });
    }, createdId);
  });

  test("renames, publishes and deletes a layer and edits its pins", async ({ page }) => {
    await page.goto("/");
    await expect.poll(() => currentUser(page), { timeout: 20_000 }).not.toBeNull();

    const created = await page.evaluate(async (name) => {
      const response = await fetch("/api/user-layers", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, color: "#10b981" })
      });
      return response.json();
    }, `Výpravy ${Date.now()}`);
    const layer = created.layer as { id: string; slug: string };

    const privateStatus = await page.evaluate(
      async (slug) => (await fetch(`/api/l/${slug}`)).status,
      layer.slug
    );
    expect(privateStatus).toBe(404);

    const updated = await page.evaluate(async (layerId) => {
      const response = await fetch(`/api/user-layers/${layerId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Veřejné výpravy", color: "#336699", isPublic: true })
      });
      return response.json();
    }, layer.id);
    expect(updated.layer).toMatchObject({ name: "Veřejné výpravy", color: "#336699", isPublic: 1 });
    expect((await page.request.get(`/api/l/${layer.slug}`)).status()).toBe(200);

    const createdPin = await page.evaluate(async (layerId) => {
      const response = await fetch(`/api/user-layers/${layerId}/pins`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "První pin",
          description: "Původní popis",
          lng: 14.12345,
          lat: 50.12345,
          tags: ["vylet"],
          kind: "place"
        })
      });
      return response.json();
    }, layer.id);
    const pinId = createdPin.pin.id as string;

    const editedPin = await page.evaluate(
      async ({ layerId, pinId }) => {
        const response = await fetch(`/api/user-layers/${layerId}/pins/${pinId}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Upravený pin", tags: ["výlet", "výhled"], kind: "task" })
        });
        return response.json();
      },
      { layerId: layer.id, pinId }
    );
    expect(editedPin.pin).toMatchObject({ name: "Upravený pin", kind: "task" });

    const listed = await page.evaluate(async (layerId) => {
      const response = await fetch(`/api/user-layers/${layerId}/pins`, { credentials: "include" });
      return response.json();
    }, layer.id);
    expect(listed.pins).toHaveLength(1);
    expect(listed.pins[0].name).toBe("Upravený pin");

    const pinDeleteStatus = await page.evaluate(
      async ({ layerId, pinId }) =>
        (
          await fetch(`/api/user-layers/${layerId}/pins/${pinId}`, {
            method: "DELETE",
            credentials: "include"
          })
        ).status,
      { layerId: layer.id, pinId }
    );
    expect(pinDeleteStatus).toBe(204);

    const layerDeleteStatus = await page.evaluate(
      async (layerId) =>
        (
          await fetch(`/api/user-layers/${layerId}`, {
            method: "DELETE",
            credentials: "include"
          })
        ).status,
      layer.id
    );
    expect(layerDeleteStatus).toBe(204);
    expect((await page.request.get(`/api/l/${layer.slug}`)).status()).toBe(404);
  });
});
