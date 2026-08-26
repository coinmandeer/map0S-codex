import assert from "node:assert/strict";
import { test } from "node:test";
import {
  currentTimeBucket,
  encounterById,
  encountersForBbox,
  ghostById,
  ghostsForBbox,
  RESPAWN_WINDOW_MS
} from "./spawn.js";

const PRAGUE = [14.35, 50.05, 14.5, 50.12] as [number, number, number, number];
const NOW = 1_700_000_000_000;

test("the same viewport and time bucket always yields the same ghosts", () => {
  const a = ghostsForBbox(PRAGUE, 30, NOW);
  const b = ghostsForBbox(PRAGUE, 30, NOW);
  assert.ok(a.length > 0, "a European city viewport must contain ghosts without any seeding");
  assert.deepEqual(a, b);
});

test("ghosts move on when the respawn window rolls over", () => {
  const before = ghostsForBbox(PRAGUE, 30, NOW);
  const after = ghostsForBbox(PRAGUE, 30, NOW + RESPAWN_WINDOW_MS);
  assert.notDeepEqual(
    before.map((g) => g.id),
    after.map((g) => g.id)
  );
});

test("ghosts spawn anywhere, not just in seeded Czech zones", () => {
  for (const bbox of [
    [2.3, 48.85, 2.4, 48.9], // Paris
    [12.45, 41.88, 12.52, 41.92], // Rome
    [18.0, 59.3, 18.1, 59.36] // Stockholm
  ] as [number, number, number, number][]) {
    assert.ok(ghostsForBbox(bbox, 30, NOW).length > 0, `no ghosts at ${bbox.join(",")}`);
  }
});

test("every spawned ghost lies inside the requested bbox", () => {
  const [w, s, e, n] = PRAGUE;
  for (const ghost of ghostsForBbox(PRAGUE, 30, NOW)) {
    assert.ok(ghost.lng >= w && ghost.lng <= e && ghost.lat >= s && ghost.lat <= n);
  }
});

test("ids survive being used as URL path params", () => {
  const ids = [
    ...ghostsForBbox(PRAGUE, 30, NOW).map((g) => g.id),
    ...encountersForBbox(PRAGUE, 12, NOW).map((e) => e.id)
  ];
  assert.ok(ids.length > 0);
  for (const id of ids) assert.equal(encodeURIComponent(id), id);
});

test("a ghost id round-trips back to the same ghost", () => {
  const [ghost] = ghostsForBbox(PRAGUE, 30, NOW);
  const resolved = ghostById(ghost!.id, NOW);
  assert.deepEqual(resolved, ghost);
});

test("ids from an expired time bucket no longer resolve", () => {
  const [ghost] = ghostsForBbox(PRAGUE, 30, NOW);
  assert.equal(ghostById(ghost!.id, NOW + 2 * RESPAWN_WINDOW_MS), null);
  assert.equal(ghostById("ghost-not-an-id", NOW), null);
});

test("encounters are sparser than ghosts but still exist and round-trip", () => {
  const encounters = encountersForBbox(PRAGUE, 12, NOW);
  const ghosts = ghostsForBbox(PRAGUE, 30, NOW);
  assert.ok(encounters.length < ghosts.length);
  for (const encounter of encounters) {
    assert.deepEqual(encounterById(encounter.id, NOW), encounter);
  }
});

test("time buckets advance once per respawn window", () => {
  const aligned = Math.floor(NOW / RESPAWN_WINDOW_MS) * RESPAWN_WINDOW_MS;
  assert.equal(currentTimeBucket(aligned), currentTimeBucket(aligned + RESPAWN_WINDOW_MS - 1));
  assert.equal(currentTimeBucket(aligned) + 1, currentTimeBucket(aligned + RESPAWN_WINDOW_MS));
});
