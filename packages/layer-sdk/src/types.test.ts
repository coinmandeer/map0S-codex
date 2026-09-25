import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bboxFromCenter,
  buildOverpassQuery,
  distanceMeters,
  formatBboxParam,
  parseBboxParam
} from "./types.js";

test("bboxFromCenter returns valid bbox", () => {
  const bbox = bboxFromCenter(13.4, 49.7, 0.1);
  assert.equal(bbox[0], 13.3);
  assert.equal(bbox[2], 13.5);
});

test("parseBboxParam roundtrip", () => {
  const bbox = [13.1, 49.6, 13.2, 49.7] as const;
  const parsed = parseBboxParam(formatBboxParam([...bbox]));
  assert.deepEqual(parsed, [...bbox]);
});

test("distanceMeters same point is zero", () => {
  assert.equal(distanceMeters({ lng: 13, lat: 49 }, { lng: 13, lat: 49 }), 0);
});

test("buildOverpassQuery includes categories", () => {
  const q = buildOverpassQuery([13, 49, 14, 50], ["castle", "viewpoint"]);
  assert.match(q, /historic"="castle"/);
  assert.match(q, /tourism"="viewpoint"/);
  assert.match(q, /out center 800;/);
});

test("bitcoin categories use the OpenStreetMap tags BTC Map is built on", () => {
  const q = buildOverpassQuery([14.2, 49.9, 14.7, 50.2], ["bitcoin_atm", "bitcoin"]);
  assert.match(q, /currency:XBT"="yes"/);
  assert.match(q, /payment:bitcoin"="yes"/);
  // Both are queried as nodes, ways and relations, like every other category.
  assert.match(q, /way\["amenity"="atm"\]\["currency:XBT"="yes"\]\(49\.9,14\.2,50\.2,14\.7\)/);
});
