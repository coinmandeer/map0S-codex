import assert from "node:assert/strict";
import { describe, it, test } from "node:test";
import { AisVesselStore } from "./aisStream.js";
import { navStatusLabel, shipTypeLabel, vesselExternalUrl } from "./ships.js";
import { bboxCornerRadiusM, parseBbox } from "./types.js";

describe("live traffic bbox parsing", () => {
  it("accepts a sane viewport and refuses impossible ones", () => {
    assert.deepEqual(parseBbox("14.1,49.9,14.7,50.3"), [14.1, 49.9, 14.7, 50.3]);
    assert.equal(parseBbox(undefined), null);
    assert.equal(parseBbox("14.1,49.9,14.7"), null);
    assert.equal(parseBbox("abc,49.9,14.7,50.3"), null);
    assert.equal(parseBbox("14.7,49.9,14.1,50.3"), null, "west must be left of east");
    assert.equal(parseBbox("14.1,50.3,14.7,49.9"), null, "south must be below north");
    assert.equal(parseBbox("-200,0,10,10"), null);
  });

  it("measures the radius a provider has to cover", () => {
    const radius = bboxCornerRadiusM([14, 50, 15, 51]);
    // A ~78 km × ~111 km viewport has a ~68 km corner radius; anything in that band is fine.
    assert.ok(radius > 60_000 && radius < 80_000, `unexpected radius ${radius}`);
  });
});

describe("AIS vessel store", () => {
  const position = (
    mmsi: number,
    lng: number,
    lat: number,
    extra: Record<string, unknown> = {}
  ) => ({
    MessageType: "PositionReport",
    MetaData: { MMSI: mmsi, ShipName: "TEST SHIP", Latitude: lat, Longitude: lng },
    Message: {
      PositionReport: {
        Latitude: lat,
        Longitude: lng,
        Sog: 12.4,
        Cog: 86.7,
        TrueHeading: 87,
        NavigationalStatus: 0,
        ...extra
      }
    }
  });

  it("keeps the latest position and builds a feature inside the bbox only", () => {
    const store = new AisVesselStore();
    store.apply(position(123456789, 14.42, 50.08));
    store.apply(position(123456789, 14.44, 50.09));
    const inside = store.inBbox([14.4, 50.05, 14.5, 50.1]);
    assert.equal(inside.length, 1);
    const feature = inside[0]!;
    assert.equal(feature.properties.id, "aisstream:123456789");
    assert.equal(feature.properties.name, "TEST SHIP");
    assert.equal(feature.properties.speedKt, 12.4);
    assert.deepEqual(feature.geometry.coordinates, [14.44, 50.09]);
    assert.deepEqual(store.inBbox([10, 40, 11, 41]), []);
  });

  it("merges static identity into later positions", () => {
    const store = new AisVesselStore();
    store.apply({
      MessageType: "ShipStaticData",
      MetaData: { MMSI: 123456789 },
      Message: {
        ShipStaticData: {
          Name: "CARGO ONE",
          ImoNumber: 9811000,
          CallSign: "ABCD",
          Type: 70,
          Destination: "HAMBURG"
        }
      }
    });
    store.apply(position(123456789, 14.42, 50.08));
    const feature = store.inBbox([14, 50, 15, 51])[0]!;
    assert.equal(feature.properties.name, "CARGO ONE");
    assert.equal(feature.properties.imo, "9811000");
    assert.equal(feature.properties.shipType, "Nákladní loď");
    assert.equal(feature.properties.destination, "HAMBURG");
    assert.ok(String(feature.properties.externalUrl).includes("9811000"));
  });

  it("ignores impossible coordinates and prunes vessels that stopped reporting", () => {
    const store = new AisVesselStore();
    store.apply(position(1, 200, 50));
    assert.equal(store.size, 0);
    store.apply(position(2, 14.42, 50.08), 1_000);
    assert.equal(store.size, 1);
    store.prune(1_000 + 16 * 60_000);
    assert.equal(store.size, 0);
  });
});

describe("ship labels", () => {
  it("maps the AIS groups a reader recognises", () => {
    assert.equal(shipTypeLabel(70), "Nákladní loď");
    assert.equal(shipTypeLabel(80), "Tanker");
    assert.equal(shipTypeLabel(60), "Osobní loď");
    assert.equal(shipTypeLabel(36), "Plachetnice");
    assert.equal(shipTypeLabel(undefined), undefined);
    assert.equal(navStatusLabel(5), "U přístaviště");
    assert.equal(navStatusLabel(99), undefined);
  });

  it("prefers the IMO detail page and falls back to a name search", () => {
    assert.equal(
      vesselExternalUrl({ imo: 9811000, name: "EVER GIVEN" }),
      "https://www.vesselfinder.com/vessels/details/9811000"
    );
    assert.ok(vesselExternalUrl({ name: "EVER GIVEN" }).includes("EVER%20GIVEN"));
  });
});

test("AIS interests cover every client and do not discard the smaller viewports", async () => {
  const { subscriptionBoxes } = await import("./aisStream.js");
  const boxes: [number, number, number, number][] = [
    [0, 0, 1, 1],
    [3, 0, 4, 1],
    [10, 1, 11, 2],
    [20, 2, 21, 3],
    [30, 3, 31, 4],
    [40, 4, 41, 5]
  ];
  const merged = subscriptionBoxes(boxes);
  assert.ok(merged.length <= 4);
  for (const b of boxes)
    assert.ok(merged.some((m) => m[0] <= b[0] && m[1] <= b[1] && m[2] >= b[2] && m[3] >= b[3]));
});

test("AIS unavailable sentinel values are not rendered as speed or heading", async () => {
  const { shipFeature } = await import("./ships.js");
  const feature = shipFeature(
    { mmsi: 123, name: "Test", lng: 14, lat: 50, speedKt: 102.3, courseDeg: 360, headingDeg: 511 },
    { id: "test", label: "test", url: "", license: "" }
  );
  assert.equal(feature.properties.speedKt, undefined);
  assert.equal(feature.properties.courseDeg, undefined);
  assert.equal(feature.properties.headingDeg, undefined);
});
