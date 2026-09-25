import assert from "node:assert/strict";
import test from "node:test";
import { golemioFeatures } from "./golemio.js";
import { spaceFeatures } from "./spaces.js";
import { btcMapFeatures } from "./btcmap.js";
import { europeanaFeatures } from "./europeana.js";
const bbox: [number, number, number, number] = [14, 50, 15, 51];
test("Golemio filters viewport and preserves dedicated layer identity", () => {
  const f = {
    geometry: { type: "Point", coordinates: [14.4, 50.1] },
    properties: { id: 1, name: "<b>Knihovna</b>", measurement: 123 }
  };
  const rows = golemioFeatures(
    { features: [f, { ...f, geometry: { type: "Point", coordinates: [200, 50] } }] },
    "golemio-libraries",
    bbox
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.properties.layerId, "golemio-libraries");
  assert.equal(rows[0]?.properties.name, "Knihovna");
  assert.equal(rows[0]?.properties.measurement, undefined);
});
test("Golemio v2 address objects, district slugs and opening hours become readable text", () => {
  const [row] = golemioFeatures(
    {
      features: [
        {
          geometry: { type: "Point", coordinates: [14.42, 50.08] },
          properties: {
            id: "g-1",
            address: {
              address_formatted: "Dlouhá 12, 110 00 Praha 1, Česko",
              street_address: "Dlouhá 12"
            },
            district: "praha-1",
            opening_hours: [
              { day_of_week: "Monday", opens: "08:00", closes: "18:00" },
              { day_of_week: "Saturday", opens: "09:00", closes: "12:00" }
            ]
          }
        }
      ]
    },
    "golemio-gardens",
    bbox
  );
  assert.equal(
    row?.properties.name,
    "Dlouhá 12, 110 00 Praha 1, Česko",
    "an unnamed place is its address"
  );
  assert.equal(row?.properties.address, "Dlouhá 12, 110 00 Praha 1, Česko");
  assert.equal(row?.properties.district, "Praha 1");
  assert.equal(row?.properties.openingHours, "Po 08:00–18:00; So 09:00–12:00");
  const second = golemioFeatures(
    {
      features: [
        {
          geometry: { type: "Point", coordinates: [14.5, 50.02] },
          properties: {
            id: "g-2",
            address: {
              street_address: "Kunratická 1",
              postal_code: "148 00",
              address_locality: "Praha"
            },
            district: "praha-kunratice"
          }
        }
      ]
    },
    "golemio-gardens",
    bbox
  )[0];
  assert.equal(second?.properties.address, "Kunratická 1, 148 00 Praha");
  assert.equal(second?.properties.district, "Praha-Kunratice");
});
test("SpaceAPI never reports a stale or missing open state as closed", () => {
  const now = 1800000000000;
  const entry = {
    valid: true,
    url: "https://space.example/api",
    lastSeen: now / 1000,
    data: { space: "Dílna", location: { lat: 50.1, lon: 14.4 }, state: { open: true } }
  };
  assert.match(String(spaceFeatures([entry], bbox, now)[0]?.properties.availability), /Otevřeno/);
  assert.match(
    String(
      spaceFeatures([{ ...entry, lastSeen: now / 1000 - 3600 }], bbox, now)[0]?.properties
        .availability
    ),
    /neověřen/
  );
  assert.equal(spaceFeatures([{ ...entry, valid: false }], bbox, now).length, 0);
});
test("BTC Map drops deleted and out-of-view places", () => {
  const p = { id: 1, name: "Kavárna", lat: 50.1, lon: 14.4, verified_at: "2025-01-01" };
  const rows = btcMapFeatures(
    [p, { ...p, id: 2, deleted_at: "2026-01-01" }, { ...p, id: 3, lon: 18 }],
    bbox
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.properties.verifiedAt, "2025-01-01");
  assert.equal(rows[0]?.properties.layerId, "btcmap");
});
test("Europeana rejects flattened ambiguous coordinate arrays and retains object rights", () => {
  const p = {
    id: "/1/a",
    title: ["Fotografie"],
    edmPlaceLatitude: ["50.1"],
    edmPlaceLongitude: ["14.4"],
    rights: ["restricted-object"]
  };
  const rows = europeanaFeatures(
    [
      p,
      { ...p, id: "/1/b", edmPlaceLatitude: ["50.1", "50.2"] },
      { ...p, id: "/1/c", edmPlaceLongitude: ["17"] }
    ],
    bbox
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.properties.objectRights, "restricted-object");
  assert.equal(rows[0]?.properties.layerId, "europeana");
});

test("Europeana uses complete EDM entities for ambiguous records, deduplicating geographic references", async () => {
  const { europeanaRecordFeatures } = await import("./europeana.js");
  const place = {
    about: "https://geo.example/1",
    latitude: 50.1,
    longitude: 14.4,
    prefLabel: { cs: ["Praha"] }
  };
  const rows = europeanaRecordFeatures(
    {
      object: {
        places: [place, { ...place, about: "https://geo.example/1/" }, { ...place, longitude: 17 }]
      }
    },
    { id: "/1/a", title: ["Fotografie"] },
    bbox
  );
  assert.equal(rows.length, 1);
  assert.match(String(rows[0]?.properties.name), /Praha/);
  assert.deepEqual(rows[0]?.geometry.coordinates, [14.4, 50.1]);
});
