import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Bbox } from "@mapos/layer-sdk";
import { dataSourceIds, dataSourceProviders } from "./index.js";
import { bboxSpanKm, withinBbox } from "./types.js";
import { __testing as mobilityTesting } from "./mobility.js";

const PRAGUE: Bbox = [14.35, 50.04, 14.5, 50.12];
const EUROPE: Bbox = [-10, 35, 30, 60];

describe("data source registry", () => {
  it("registers every source as a fetchable layer", () => {
    for (const id of dataSourceIds) {
      const provider = dataSourceProviders.find((p) => p.id === id);
      assert.equal(typeof provider?.features, "function", `${id} is not fetchable`);
    }
  });

  it("refuses a continent-sized viewport with an explanation instead of an empty layer", async () => {
    const provider = dataSourceProviders.find((p) => p.id === "commons-photos")!;
    const result = await provider.features!({ bbox: EUROPE, query: {} });

    assert.equal(result.features.length, 0);
    // "Nothing here" and "I refuse to look" must not be indistinguishable to the user.
    assert.match(result.notice ?? "", /Přibliž/);
  });
});

describe("bbox helpers", () => {
  it("measures a viewport in kilometres", () => {
    // Prague's ~0.15° of longitude at 50°N is roughly 10 km.
    assert.ok(bboxSpanKm(PRAGUE) > 8 && bboxSpanKm(PRAGUE) < 14, `got ${bboxSpanKm(PRAGUE)}`);
    assert.ok(bboxSpanKm(EUROPE) > 1000);
  });

  it("excludes points outside the box", () => {
    assert.ok(withinBbox(PRAGUE, 14.42, 50.08));
    assert.ok(!withinBbox(PRAGUE, 16.6, 49.2));
  });
});

describe("GBFS feed handling", () => {
  const { parseCsvLine, findFeedUrl } = mobilityTesting;

  it("keeps zero availability and closure flags but never presents stale counts as live", () => {
    const now = Date.parse("2026-09-24T12:00:00Z");
    const fresh = mobilityTesting.stationAvailability(
      {
        last_reported: now / 1000,
        num_bikes_available: 0,
        num_docks_available: 4,
        is_renting: 0,
        is_returning: 1
      },
      now
    );
    assert.equal(fresh.vehiclesAvailable, 0);
    assert.equal(fresh.renting, false);
    assert.equal(fresh.returning, true);
    assert.equal(
      mobilityTesting.stationAvailability(
        { last_reported: "2026-09-24T11:00:00Z", num_vehicles_available: 10 },
        now
      ).availabilityStatus,
      "unknown"
    );
    assert.equal(
      mobilityTesting.stationAvailability({ last_reported: now / 1000 + 120 }, now)
        .availabilityStatus,
      "unknown"
    );
    assert.equal(
      mobilityTesting.stationAvailability(
        { last_reported: new Date(now).toISOString(), num_vehicles_available: -1 },
        now
      ).vehiclesAvailable,
      null
    );
  });

  it("parses quoted CSV fields containing commas", () => {
    // System names in systems.csv routinely contain commas — a naive split shifts every
    // column after them, which would silently mis-assign countries and feed URLs.
    assert.deepEqual(parseCsvLine('CZ,"Rekola, s.r.o.",Praha,rekola,https://a,https://b'), [
      "CZ",
      "Rekola, s.r.o.",
      "Praha",
      "rekola",
      "https://a",
      "https://b"
    ]);
  });

  it("handles escaped quotes", () => {
    assert.deepEqual(parseCsvLine('a,"say ""hi""",b'), ["a", 'say "hi"', "b"]);
  });

  it("finds the station feed in both GBFS layouts", () => {
    // 1.x nests feeds under a language key, 3.x puts them at the top level; both are live.
    const v1 = {
      data: { en: { feeds: [{ name: "station_information", url: "https://v1/stations" }] } }
    };
    const v3 = { data: { feeds: [{ name: "station_information", url: "https://v3/stations" }] } };

    assert.equal(findFeedUrl(v1, "station_information"), "https://v1/stations");
    assert.equal(findFeedUrl(v3, "station_information"), "https://v3/stations");
    assert.equal(findFeedUrl(v3, "not_a_feed"), undefined);
  });
});

it("GBFS dockless vehicles support v2/v3 and reject stale, reserved, disabled or docked entries", () => {
  const system = {
    countryCode: "CZ",
    name: "Operator",
    systemId: "test",
    discoveryUrl: "https://example.org/gbfs.json"
  };
  const now = Date.parse("2026-09-24T12:00:00Z");
  const vehicle = {
    vehicle_id: "rotating-id",
    lat: 50,
    lon: 14,
    is_reserved: false,
    is_disabled: false
  };
  const feed = {
    last_updated: new Date(now).toISOString(),
    data: {
      vehicles: [
        vehicle,
        { ...vehicle, vehicle_id: "reserved", is_reserved: true },
        { ...vehicle, vehicle_id: "disabled", is_disabled: true },
        { ...vehicle, vehicle_id: "docked", station_id: "s" },
        { ...vehicle, vehicle_id: "stale", last_reported: (now - 600000) / 1000 }
      ]
    }
  };
  const points = mobilityTesting.freeVehicleFeatures(system, feed, now);
  assert.equal(points.length, 1);
  assert.equal(points[0]!.properties.category, "shared-vehicle");
  assert.equal(
    mobilityTesting.freeVehicleFeatures(
      system,
      { ...feed, last_updated: (now - 600000) / 1000 },
      now
    ).length,
    0
  );
  assert.equal(
    mobilityTesting.freeVehicleFeatures(
      system,
      {
        last_updated: now / 1000,
        data: {
          bikes: [{ bike_id: "old-format", lat: 50, lon: 14, is_reserved: 0, is_disabled: 0 }]
        }
      },
      now
    ).length,
    1
  );
});
