import { expect, test } from "./fixtures/offlineTest";

test("planning shell and synthetic API boot with zero external network", async ({
  page,
  offlineNetwork
}) => {
  await page.goto("/?mode=planning&lng=13.3775&lat=49.7475&z=14");

  await expect(page.getByTestId("mode-bar")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("planning-panel")).toBeVisible();
  await expect(page.getByTestId("map-container")).toBeVisible();

  const evidence = await page.evaluate(async () => {
    const [health, config, grid, route] = await Promise.all([
      fetch("/api/health").then((response) => response.json()),
      fetch("/api/config").then((response) => response.json()),
      fetch("/api/weather/grid?bbox=13,49,14,50&variable=wind&cols=3&rows=2").then((response) =>
        response.json()
      ),
      fetch("/api/routing?from=13.37,49.74&to=13.4,49.76&profile=foot").then((response) =>
        response.json()
      )
    ]);
    return { health, config, grid, route };
  });

  expect(evidence.health).toMatchObject({
    status: "ok",
    service: "mapos-v3-memory",
    fixtureMode: "offline"
  });
  expect(evidence.config.fixtureMode).toBe("offline");
  expect(evidence.grid).toMatchObject({
    variable: "wind",
    sampleCount: 6,
    generatedAt: "2026-09-01T12:00:00.000Z"
  });
  expect(evidence.route).toMatchObject({
    provider: "osm",
    profile: "foot",
    coordinates: [
      [13.37, 49.74],
      [13.4, 49.76]
    ]
  });
  expect(offlineNetwork.fulfilledFixtures.length).toBeGreaterThan(0);
});
