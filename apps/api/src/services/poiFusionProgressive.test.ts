import assert from "node:assert/strict";
import test from "node:test";
import { createPlacesFusion } from "./poiFusionService.js";
import { createProgressivePlaces } from "./progressivePlaces.js";
import type { Place } from "@mapos/layer-sdk";
const point: Place = {
  id: "osm:node:1",
  name: "Castle",
  lng: 14,
  lat: 50,
  category: "castle",
  sources: [{ source: "osm", sourceRef: "node:1", confidence: 0.8, refreshedAt: "2026-01-01" }]
};
const query = {
  bbox: [13, 49, 15, 51] as [number, number, number, number],
  categories: [],
  sources: ["osm", "wikipedia"] as const
};
test("interactive fusion returns partial metadata, then completes without duplicate source fetches", async () => {
  let resolve!: (value: Place[]) => void;
  let calls = 0;
  const remote = new Promise<Place[]>((r) => (resolve = r));
  const fuse = createPlacesFusion(
    [
      { id: "osm", confidence: 0.8, fetch: async () => [structuredClone(point)] },
      {
        id: "wikipedia",
        confidence: 0.4,
        fetch: () => {
          calls++;
          return remote;
        }
      }
    ],
    createProgressivePlaces({ waitMs: 3 })
  );
  const first = await fuse({ ...query, sources: [...query.sources] }, { progressive: true });
  assert.equal(first.places.length, 1);
  assert.equal(first.query?.status, "partial");
  assert.equal(first.query?.retryAfterMs, 2000);
  assert.equal(first.meta.sources.find((s) => s.source === "wikipedia")?.state, "loading");
  resolve([
    {
      ...point,
      id: "wiki:castle",
      sources: [
        { source: "wikipedia", sourceRef: "castle", confidence: 0.4, refreshedAt: "2026-01-01" }
      ]
    }
  ]);
  const second = await fuse({ ...query, sources: ["wikipedia", "osm"] }, { progressive: true });
  assert.equal(second.query?.status, "complete");
  assert.equal(second.places.length, 1);
  assert.equal(second.places[0]?.sources.length, 2);
  assert.equal(calls, 1);
  assert.equal(first.places[0]?.sources.length, 1);
});
test("non-interactive consumers still await their requested sources", async () => {
  let resolve!: (value: Place[]) => void;
  const remote = new Promise<Place[]>((r) => (resolve = r));
  const fuse = createPlacesFusion(
    [{ id: "wikipedia", confidence: 0.4, fetch: () => remote }],
    createProgressivePlaces({ waitMs: 1 })
  );
  let completed = false;
  const result = fuse({ ...query, sources: ["wikipedia"] }).then((r) => {
    completed = true;
    return r;
  });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(completed, false);
  resolve([point]);
  assert.equal((await result).places.length, 1);
});

test("progressive fusion isolates selected area identity and boundary revision", async () => {
  const seen: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fuse = createPlacesFusion(
    [
      {
        id: "wikipedia",
        confidence: 0.8,
        fetch: async (query) => {
          seen.push(`${query.area?.id}:${query.area?.revision}`);
          await gate;
          return [structuredClone(point)];
        }
      }
    ],
    createProgressivePlaces({ waitMs: 3 })
  );
  const area = {
    id: "a",
    revision: "1".repeat(64),
    name: "Area",
    source: "fixture",
    country: "CZ",
    level: "lau" as const,
    code: "a",
    bbox: query.bbox
  };
  for (const selected of [
    area,
    area,
    { ...area, id: "b" },
    { ...area, revision: "2".repeat(64) }
  ]) {
    await fuse({ ...query, sources: ["wikipedia"], area: selected }, { progressive: true });
  }
  release();
  assert.equal(seen.length, 3);
  assert.equal(new Set(seen).size, 3);
});

test("late broad source responses cannot leak another category into a progressive result", async () => {
  let release!: (places: Place[]) => void;
  const delayed = new Promise<Place[]>((resolve) => {
    release = resolve;
  });
  const fuse = createPlacesFusion(
    [
      { id: "osm", confidence: 0.8, fetch: async () => [{ ...point, category: "cafe" }] },
      { id: "mapy", confidence: 0.8, fetch: () => delayed }
    ],
    createProgressivePlaces({ waitMs: 1 })
  );
  const request = {
    ...query,
    categories: ["cafe" as const],
    sources: ["osm" as const, "mapy" as const]
  };
  const first = await fuse(request, { progressive: true });
  assert.deepEqual(
    first.places.map((p) => p.category),
    ["cafe"]
  );
  release([{ ...point, id: "camp", category: "camp_site" }]);
  const final = await fuse(request, { progressive: true });
  assert.deepEqual(
    final.places.map((p) => p.category),
    ["cafe"]
  );
  assert.equal(final.meta.sources.find((s) => s.source === "mapy")?.count, 0);
});
