import assert from "node:assert/strict";
import test from "node:test";
import { buildMemoryEventFixtures } from "../events/eventFixtures.js";
import { createEventServiceGuideLister } from "./guideComposition.js";
import type { GuideAreaRef } from "./guideAggregator.js";

const AREA: GuideAreaRef = {
  regionId: "test:prague",
  name: "Praha",
  level: "locality",
  lang: "cs",
  center: { longitude: 14.4378, latitude: 50.0755 },
  bbox: [14.3, 50.0, 14.6, 50.2]
};

test("an event reaches the guide with its start, its provider and nothing invented", async () => {
  const fixtures = buildMemoryEventFixtures(new Date("2026-09-01T12:00:00.000Z"));
  const asked: unknown[] = [];
  const lister = createEventServiceGuideLister({
    async list(input) {
      asked.push(input);
      return { events: fixtures };
    }
  });

  const collected = await lister(AREA);
  const [first] = collected.events;
  assert.ok(first);
  const source = fixtures[0]!.sources[0]!;
  assert.equal(first.id, fixtures[0]!.id);
  assert.equal(first.title, fixtures[0]!.title);
  assert.equal(first.startsAt, fixtures[0]!.schedule.startsAt);
  assert.equal(first.sourceId, `events:${source.providerId}`);
  // Every event id in the guide has to resolve to a citation, or the guide cannot show it.
  const cited = new Set(collected.sources.map((citation) => citation.sourceId));
  assert.ok(collected.events.every((event) => cited.has(event.sourceId)));
  assert.deepEqual(
    asked.map((input) => (input as { bbox: unknown }).bbox),
    [AREA.bbox]
  );
});

test("an event without provenance is not offered to the guide at all", async () => {
  const [event] = buildMemoryEventFixtures(new Date("2026-09-01T12:00:00.000Z"));
  assert.ok(event);
  const lister = createEventServiceGuideLister({
    list: async () => ({ events: [{ ...event, sources: [] }] })
  });
  const collected = await lister(AREA);
  assert.deepEqual(collected.events, []);
  assert.deepEqual(collected.sources, []);
});
