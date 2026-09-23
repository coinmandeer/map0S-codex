import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { writeFile } from "node:fs/promises";
const root = process.env.MAPOS_DRILL_MODULE_ROOT ?? "../apps/api/src";
const { createProgressivePlaces } = await import(`${root}/services/progressivePlaces.js`);
const collector = createProgressivePlaces();
const batch = (source) => ({
  places: Array.from({ length: 400 }, (_, i) => ({
    id: `${source}:${i}`,
    name: `Place ${i}`,
    lng: 14,
    lat: 50,
    category: "poi",
    sources: []
  })),
  meta: { source, state: "ready", count: 400 }
});
let done;
const slow = new Promise((resolve) => {
  done = resolve;
});
const jobs = [
  { source: "osm", local: true, run: async () => batch("osm") },
  { source: "wikipedia", local: false, run: () => slow }
];
const start = performance.now();
const timer = setTimeout(() => done(batch("wikipedia")), 2000);
try {
  const first = await collector.collect("fixture", jobs);
  const firstMs = performance.now() - start;
  assert.equal(first.results.length, 1);
  assert.equal(first.pending.length, 1);
  let latest = first;
  while (latest.pending.length) latest = await collector.collect("fixture", jobs);
  const completeMs = performance.now() - start;
  assert.equal(latest.results.length, 2);
  assert.equal(collector.stats().entries, 0);
  const report = {
    checkedAt: new Date().toISOString(),
    fixture: true,
    slowSourceDelayMs: 2000,
    firstMs,
    completeMs,
    firstPlaces: 400,
    completePlaces: 800,
    final: collector.stats(),
    note: "Controlled source delay; not a live provider latency benchmark."
  };
  await writeFile(
    "output/performance/progressive-places-smoke.json",
    JSON.stringify(report, null, 2) + "\n"
  );
  console.log(JSON.stringify(report));
} finally {
  clearTimeout(timer);
  done(batch("wikipedia"));
}
