import assert from "node:assert/strict";
import { test } from "node:test";
import { __testing, events, geohash } from "./events.js";

test("geohash matches the reference encoding", () => {
  // Known fixtures from the geohash spec and Wikipedia's worked example.
  assert.equal(geohash(-5.6, 42.6, 5), "ezs42");
  assert.equal(geohash(112.5584, 37.8324, 9), "ww8p1r4t8");
  assert.equal(geohash(0, 0, 6), "s00000");
});

test("nearby points share a prefix, distant ones do not", () => {
  const prague = geohash(14.42, 50.08, 7);
  const nextStreet = geohash(14.421, 50.081, 7);
  const madrid = geohash(-3.7, 40.4, 7);

  assert.equal(prague.slice(0, 5), nextStreet.slice(0, 5));
  assert.notEqual(prague[0], madrid[0]);
});

test("dates are formatted the way the API insists on", () => {
  const { apiDate } = __testing;
  const fallback = new Date("2026-01-01T00:00:00.000Z");

  assert.equal(apiDate("2026-08-27T18:30:00.000Z", fallback), "2026-08-27T18:30:00Z");
  assert.equal(apiDate(undefined, fallback), "2026-01-01T00:00:00Z");
  // A client sending nonsense gets the default window rather than a 400 from upstream.
  assert.equal(apiDate("not a date", fallback), "2026-01-01T00:00:00Z");
});

test("a continent-sized viewport is refused before the request is made", () => {
  assert.match(events.tooLarge?.([-10, 35, 30, 60]) ?? "", /Přibliž/);
  assert.equal(events.tooLarge?.([14.3, 50.0, 14.6, 50.2]), null);
});

test("without a key the layer says which one is missing", async () => {
  await assert.rejects(() => events.load([14.3, 50.0, 14.6, 50.2], {}), /TICKETMASTER_API_KEY/);
});
