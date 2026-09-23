import assert from "node:assert/strict";
import test from "node:test";
import { createProgressivePlaces, type PlaceBatch, type PlaceJob } from "./progressivePlaces.js";
import type { PlaceSourceId } from "@mapos/layer-sdk";
function batch(source: PlaceSourceId): PlaceBatch {
  return {
    places: [{ id: source, name: source, lng: 14, lat: 50, category: "poi", sources: [] }],
    meta: { source, state: "ready", count: 1 }
  };
}
function deferred() {
  let resolve!: (value: PlaceBatch) => void;
  return {
    promise: new Promise<PlaceBatch>((r) => (resolve = r)),
    resolve: (value: PlaceBatch) => resolve(value)
  };
}
test("fast places are delivered while a remote source waits; polling joins the same job", async () => {
  const collector = createProgressivePlaces({ waitMs: 5 });
  const remote = deferred();
  let calls = 0;
  const jobs: PlaceJob[] = [
    { source: "osm", local: true, run: async () => batch("osm") },
    {
      source: "wikipedia",
      local: false,
      run: () => {
        calls++;
        return remote.promise;
      }
    }
  ];
  const first = await collector.collect("viewport", jobs);
  assert.equal(first.results[0]?.meta.source, "osm");
  assert.deepEqual(first.pending, ["wikipedia"]);
  first.results[0]!.places[0]!.name = "mutated by dedupe";
  const second = await collector.collect("viewport", jobs);
  assert.equal(second.results[0]?.places[0]?.name, "osm");
  assert.equal(calls, 1);
  remote.resolve(batch("wikipedia"));
  const complete = await collector.collect("viewport", jobs);
  assert.equal(complete.results.length, 2);
  assert.deepEqual(complete.pending, []);
  assert.equal(collector.stats().entries, 0);
  assert.equal(collector.stats().bytes, 0);
});
test("a full remote lane cannot block local database reads", async () => {
  const collector = createProgressivePlaces({ waitMs: 5 });
  const held = Array.from({ length: 4 }, () => deferred());
  await Promise.all(
    held.map((d, i) =>
      collector.collect(`remote-${i}`, [{ source: "mapy", local: false, run: () => d.promise }])
    )
  );
  assert.equal(collector.stats().remoteRunning, 4);
  const local = await collector.collect("local", [
    { source: "osm", local: true, run: async () => batch("osm") }
  ]);
  assert.equal(local.results[0]?.meta.state, "ready");
  held.forEach((d) => d.resolve(batch("mapy")));
});
test("entry and result budgets bound memory and queue growth", async () => {
  const collector = createProgressivePlaces({ waitMs: 2, maxEntries: 1, maxBytes: 500 });
  const remote = deferred();
  const jobs: PlaceJob[] = [{ source: "mapy", local: false, run: () => remote.promise }];
  await collector.collect("a", jobs);
  assert.equal((await collector.collect("b", jobs)).busy, true);
  assert.equal(collector.stats().entries, 1);
  const large = batch("mapy");
  large.places[0]!.name = "x".repeat(2000);
  remote.resolve(large);
  const result = await collector.collect("a", jobs);
  assert.equal(result.results[0]?.places.length, 0);
  assert.equal(result.results[0]?.meta.state, "error");
  assert.equal(collector.stats().bytes, 0);
});
test("failed providers terminate their snapshot; delivered results are not cached anew", async () => {
  const collector = createProgressivePlaces({ waitMs: 10 });
  let calls = 0;
  const jobs: PlaceJob[] = [
    {
      source: "mapy",
      local: false,
      run: async () => {
        calls++;
        throw Error("private transport details");
      }
    }
  ];
  const a = await collector.collect("x", jobs);
  assert.equal(a.results[0]?.meta.state, "error");
  assert.ok(!JSON.stringify(a).includes("private transport"));
  await collector.collect("x", jobs);
  assert.equal(calls, 2);
});

test("completed abandoned viewports are evicted before refusing fresh work", async () => {
  const collector = createProgressivePlaces({ waitMs: 2, maxEntries: 1 });
  const remote = deferred();
  await collector.collect("abandoned", [
    { source: "mapy", local: false, run: () => remote.promise }
  ]);
  remote.resolve(batch("mapy"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(collector.stats().entries, 1);
  const next = await collector.collect("current", [
    { source: "osm", local: true, run: async () => batch("osm") }
  ]);
  assert.equal(next.busy, undefined);
  assert.equal(next.results[0]?.meta.source, "osm");
  assert.equal(collector.stats().entries, 0);
});
