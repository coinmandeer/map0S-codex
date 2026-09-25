import { expect, test } from "./fixtures/offlineTest";

/** What a watch actually writes: a named track split across segments, plus a marked waypoint. */
const WATCH_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Garmin Connect" xmlns="http://www.topografix.com/GPX/1/1">
  <wpt lat="50.0880" lon="14.4208">
    <ele>202</ele>
    <time>2026-05-01T08:00:00Z</time>
    <name>Start u kostela</name>
    <desc>Parkování zdarma</desc>
  </wpt>
  <trk>
    <name>Ranní kolo podél Vltavy</name>
    <desc>32 km, rovina</desc>
    <trkseg>
      <trkpt lat="50.0880" lon="14.4208"><time>2026-05-01T08:01:00Z</time></trkpt>
      <trkpt lat="50.0910" lon="14.4260"><time>2026-05-01T08:06:00Z</time></trkpt>
    </trkseg>
    <trkseg>
      <trkpt lat="50.0950" lon="14.4310"><time>2026-05-01T08:12:00Z</time></trkpt>
    </trkseg>
  </trk>
</gpx>`;

test("a GPX from a watch imports as a layer holding both the track and its waypoint", async ({
  page
}) => {
  await page.goto("/?mode=personal");
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const response = await fetch("/api/auth/me", { credentials: "include" });
          return Boolean((await response.json()).user);
        }),
      { timeout: 20_000 }
    )
    .toBe(true);

  const mine = page.getByTestId("personal-panel");
  await expect(mine).toBeVisible();
  await mine.getByText("My layers", { exact: true }).click();

  await mine.getByTestId("layer-import-file").setInputFiles({
    name: "activity_18274612.gpx",
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(WATCH_GPX)
  });

  const preview = mine.getByTestId("layer-import-preview");
  await expect(preview).toContainText("activity_18274612");
  await expect(preview).toContainText("gpx");
  await expect(preview).toContainText("2 bodů", { timeout: 15_000 });
  // The waypoint and the track both survive; the track keeps its own name, not a point's.
  await expect(preview).toContainText("Start u kostela");
  await expect(preview).toContainText("Ranní kolo podél Vltavy");
  // A recording carries no licence, so publication is not on offer.
  await expect(preview).toContainText("privately");

  await preview.getByRole("button", { name: "Nainstalovat vrstvu" }).click();
  await expect(mine.getByTestId("layer-import-report")).toContainText("committed");

  const layerName = "activity_18274612";
  await expect(mine.getByTestId("user-layer-row").filter({ hasText: layerName })).toHaveCount(1);

  // The track has to reach the map as a line: a route stored only as its start point would
  // import "successfully" and then show the user a single dot where their ride should be.
  const imported = await page.evaluate(async () => {
    const response = await fetch("/api/layers/user-layers/features?bbox=14.3,50,14.55,50.15", {
      credentials: "include"
    });
    const data = (await response.json()) as {
      features: Array<{
        geometry: { type: string; coordinates: unknown };
        properties: Record<string, unknown>;
      }>;
    };
    return data.features.map((feature) => ({
      type: feature.geometry.type,
      name: feature.properties.name,
      kind: feature.properties.kind,
      coordinates: feature.geometry.coordinates,
      anchorLng: feature.properties.anchorLng
    }));
  });

  const track = imported.find((feature) => feature.name === "Ranní kolo podél Vltavy");
  expect(track).toBeTruthy();
  expect(track!.type).toBe("LineString");
  expect(track!.kind).toBe("route");
  // Both segments joined into one line rather than becoming two disconnected routes.
  expect(track!.coordinates).toEqual([
    [14.4208, 50.088],
    [14.426, 50.091],
    [14.431, 50.095]
  ]);
  expect(track!.anchorLng).toBe(14.4208);

  const waypoint = imported.find((feature) => feature.name === "Start u kostela");
  expect(waypoint).toBeTruthy();
  expect(waypoint!.type).toBe("Point");
  expect(waypoint!.kind).toBe("place");
});
