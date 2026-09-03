import { expect, test } from "./fixtures/offlineTest";

/** Plzeň, where the offline POI fixtures — and therefore the quest anchors — live. */
const FIXTURE_BBOX = "13.35,49.73,13.40,49.76";

test("quest anchors are available as ordinary pins outside the 3D game mode", async ({ page }) => {
  await page.goto("/?mode=discover");

  const served = await page.evaluate(async (bbox) => {
    const response = await fetch(`/api/layers/game-quests/features?bbox=${bbox}`, {
      credentials: "include"
    });
    return {
      status: response.status,
      body: (await response.json()) as {
        features: Array<{
          geometry: { type: string };
          properties: Record<string, unknown>;
        }>;
      }
    };
  }, FIXTURE_BBOX);

  expect(served.status).toBe(200);
  expect(served.body.features.length).toBeGreaterThan(0);

  const feature = served.body.features[0]!;
  expect(feature.geometry.type).toBe("Point");
  // The pin has to carry the objective and its provenance, or the detail sheet would have to go
  // back to the source for something the list already knew.
  expect(feature.properties.layerId).toBe("game-quests");
  expect(String(feature.properties.questTitle).length).toBeGreaterThan(0);
  expect(Number(feature.properties.rewardPoints)).toBeGreaterThan(0);
  expect(String(feature.properties.attribution)).toContain("OpenStreetMap");
  // The category is what the legend colours by.
  expect(typeof feature.properties.category).toBe("string");

  // Filtering by source is server-side, so an unknown source yields nothing rather than
  // everything — a filter that silently does nothing is worse than no filter.
  const filtered = await page.evaluate(async (bbox) => {
    const response = await fetch(
      `/api/layers/game-quests/features?bbox=${bbox}&sources=nonexistent-source`,
      { credentials: "include" }
    );
    return ((await response.json()) as { features: unknown[] }).features.length;
  }, FIXTURE_BBOX);
  expect(filtered).toBe(0);
});

test("the quest layer is offered in Discover, not only in the game", async ({ page }) => {
  await page.goto("/?mode=discover");

  const listed = await page.evaluate(async () => {
    const response = await fetch("/api/layers", { credentials: "include" });
    const data = (await response.json()) as { layers: Array<{ id: string; kind: string }> };
    return data.layers.find((layer) => layer.id === "game-quests") ?? null;
  });
  // Registered as pins rather than custom-gl: the point of a separate layer is that seeing a
  // geocache or an unanswered OSM note must not require loading the 3D quest world.
  expect(listed).toMatchObject({ id: "game-quests", kind: "pins" });
});
