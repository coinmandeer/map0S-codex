import type { Page } from "@playwright/test";

const FIXED_AT = "2026-09-01T12:00:00.000Z";

export function discoverContextFixture(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "2.0.0",
    key: "13.377|49.747|locality|cs|discover|osm-poi|structured",
    generatedAt: FIXED_AT,
    cache: { hit: false, expiresAt: "2026-09-01T12:15:00.000Z" },
    region: {
      id: "nominatim:relation:439840",
      name: "Plzeň",
      level: "locality",
      countryCode: "CZ",
      hierarchy: [
        { name: "Česko", level: "country" },
        { name: "Plzeňský kraj", level: "admin1" },
        { name: "Plzeň", level: "locality" }
      ]
    },
    guide: null,
    synthesis: {
      kind: "structured",
      label: "Kontext mapy",
      text: "Střed mapy leží v oblasti Plzeň.",
      sourceIds: ["nominatim-osm"]
    },
    guideSynthesis: null,
    statistics: [],
    regionCatalogue: null,
    sources: [
      {
        id: "nominatim-osm",
        label: "OpenStreetMap Nominatim",
        attribution: "© OpenStreetMap přispěvatelé",
        url: "https://www.openstreetmap.org/copyright",
        license: "ODbL 1.0",
        fetchedAt: FIXED_AT
      }
    ],
    blocks: [
      { id: "region", status: "ready", sourceIds: ["nominatim-osm"] },
      { id: "guide", status: "empty", sourceIds: [] },
      { id: "statistics", status: "empty", sourceIds: [] },
      { id: "model", status: "skipped", sourceIds: [] }
    ],
    boundary: {
      status: "dataset-required",
      geometry: null,
      reason: "Licensed administrative boundary dataset is not configured."
    },
    emptyState: null,
    ...overrides
  };
}

export async function stubDiscoverContext(page: Page, overrides: Record<string, unknown> = {}) {
  await page.route("**/v2/discover/context**", (route) =>
    route.fulfill({ json: discoverContextFixture(overrides) })
  );
}

export async function openAccessibleMapFeature(page: Page, name: string) {
  await page.getByTestId("discover-accordion-places").click();
  const feature = page.getByRole("button", { name: `Otevřít detail místa ${name}` });
  await feature.focus();
  await feature.press("Enter");
}
