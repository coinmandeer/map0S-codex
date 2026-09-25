import assert from "node:assert/strict";
import test from "node:test";
import { featurePage, resetFeaturePages } from "./featurePages.js";
import type { FeatureCollection } from "@mapos/layer-sdk";

test("pages retain one snapshot, all records and original coverage without refetching", async () => {
  resetFeaturePages();
  let calls = 0;
  const load = async (): Promise<FeatureCollection> => {
    calls++;
    return {
      type: "FeatureCollection",
      query: { status: "complete" },
      features: Array.from({ length: 240 }, (_, index) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [14, 50] },
        properties: { id: String(index), name: String(index), layerId: "fixture" }
      }))
    };
  };
  const request = {
    bbox: [13, 49, 15, 51] as [number, number, number, number],
    query: {},
    userId: "a"
  };
  let page = await featurePage("fixture", request, 100, load);
  assert.equal(page.features.length, 100);
  assert.equal(page.query?.truncated, true);
  assert.equal(page.query?.status, "partial");
  const cursor = page.query!.nextCursor!;
  await assert.rejects(
    featurePage("fixture", { ...request, userId: "b", query: { cursor } }, 100, load),
    /vypršely/
  );
  await assert.rejects(
    featurePage("different", { ...request, query: { cursor } }, 100, load),
    /vypršely/
  );
  await assert.rejects(
    featurePage("fixture", { ...request, query: { cursor, categories: "cafe" } }, 100, load),
    /vypršely/
  );
  const all = [...page.features];
  while (page.query?.nextCursor) {
    page = await featurePage(
      "fixture",
      { ...request, query: { cursor: page.query.nextCursor } },
      100,
      load
    );
    all.push(...page.features);
  }
  assert.equal(calls, 1);
  assert.equal(new Set(all.map((f) => f.properties.id)).size, 240);
  assert.equal(page.query?.status, "complete");
  assert.equal(page.query?.truncated, false);
  resetFeaturePages();
});
