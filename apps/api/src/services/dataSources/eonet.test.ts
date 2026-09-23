import assert from "node:assert/strict";
import { test } from "node:test";
import { createEonetSource, eonetQuery, mapEonetEvents } from "./eonet.js";
const bbox: [number, number, number, number] = [0, 40, 3, 43];
const event = {
  id: "one",
  title: "Fire",
  closed: null,
  geometry: [{ date: "2026-09-08", type: "Point", coordinates: [1, 41] }]
};
test("EONET uses provider bbox order and canonical OR categories, rejects unsafe query", () => {
  const q = eonetQuery(bbox, { category: "wildfires,floods,wildfires", days: "7" });
  assert.equal(q.get("bbox"), "0,43,3,40");
  assert.equal(q.get("category"), "floods,wildfires");
  assert.equal(q.get("limit"), "200");
  assert.throws(() => eonetQuery(bbox, { days: "NaN" }));
  assert.throws(() => eonetQuery(bbox, { category: "fake" }));
});
test("latest position and timestamp stay paired; historic local position is not shown as current", () => {
  const moved = {
    ...event,
    geometry: [...event.geometry, { date: "2026-09-09", type: "Point", coordinates: [10, 41] }]
  };
  assert.equal(mapEonetEvents([moved], bbox).features.length, 0);
  const result = mapEonetEvents([event], bbox);
  assert.equal(result.status, "complete");
  assert.equal(result.features[0]?.properties.occurredAt, "2026-09-08");
});
test("polygon-only and capped results are partial, real empty succeeds", () => {
  assert.equal(
    mapEonetEvents(
      [{ ...event, geometry: [{ date: "2026-09-08", type: "Polygon", coordinates: [] }] }],
      bbox
    ).status,
    "partial"
  );
  assert.equal(
    mapEonetEvents(
      Array.from({ length: 200 }, () => event),
      bbox
    ).status,
    "partial"
  );
  assert.equal(mapEonetEvents([], bbox).status, "complete");
});
test("transport receives cancellation and missing envelope fails", async () => {
  const controller = new AbortController();
  type Transport = NonNullable<Parameters<typeof createEonetSource>[0]>;
  const source = createEonetSource((async (_url: unknown, options: Parameters<Transport>[1]) => {
    assert.equal(options?.signal, controller.signal);
    controller.abort();
    return { events: [] };
  }) as Transport);
  await assert.rejects(source.load(bbox, {}, controller.signal), { name: "AbortError" });
  const malformed = createEonetSource((async () => ({})) as Transport);
  await assert.rejects(malformed.load(bbox, {}), /Invalid EONET response/);
});
