import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EventDocumentV2 } from "@mapos/layer-sdk";
import { MemoryEventRepository } from "./eventMemoryRepository.js";
import {
  EventService,
  decodeEventCursor,
  eventToMapOSFeature,
  normalizeEventLimit
} from "./eventService.js";

const NOW = new Date("2026-09-01T08:00:00.000Z");

function event(
  providerId: string,
  sourceId: string,
  patch: Partial<EventDocumentV2> = {}
): EventDocumentV2 {
  return {
    schema: "mapos.event",
    schemaVersion: "2.0.0",
    id: `${providerId}:${sourceId}`,
    revision: 1,
    title: "Open Map Day",
    categories: ["community"],
    status: "scheduled",
    schedule: {
      startsAt: "2026-10-17T08:00:00.000Z",
      endsAt: "2026-10-17T16:00:00.000Z",
      timezone: "Europe/Madrid"
    },
    venue: {
      name: "Demo Venue",
      location: { type: "Point", coordinates: [-0.3763, 39.4699] }
    },
    performers: [{ name: "MapOS Community", role: "host" }],
    organizer: { name: "MapOS" },
    price: { currency: "EUR", min: 0, max: 0, free: true },
    officialUrl: "https://events.example.invalid/open-map-day",
    sources: [
      {
        providerId,
        sourceId,
        retrievedAt: NOW.toISOString(),
        attribution: providerId,
        confidence: 0.8
      }
    ],
    ...patch
  };
}

describe("canonical event service", () => {
  it("merges duplicate providers without losing either provider/source identity", async () => {
    const repository = new MemoryEventRepository();
    const service = new EventService(repository, [], () => NOW);
    const first = await service.ingest(event("provider-a", "evt-1"));
    const merged = await service.ingest(
      event("provider-b", "other-9", {
        title: "OPEN MAP DAY",
        schedule: {
          startsAt: "2026-10-17T08:30:00.000Z",
          endsAt: "2026-10-17T16:00:00.000Z",
          timezone: "Europe/Madrid"
        }
      })
    );

    assert.equal(merged.id, first.id);
    assert.equal(merged.revision, 2);
    assert.deepEqual(
      merged.sources.map((source) => `${source.providerId}:${source.sourceId}`).sort(),
      ["provider-a:evt-1", "provider-b:other-9"]
    );
    assert.deepEqual(merged.dedupe?.mergedEventIds?.sort(), [
      "provider-a:evt-1",
      "provider-b:other-9"
    ]);
  });

  it("keeps exact source identity stable and marks a material time move as rescheduled", async () => {
    const repository = new MemoryEventRepository();
    const service = new EventService(repository, [], () => NOW);
    const first = await service.ingest(event("provider-a", "evt-1"));
    const moved = await service.ingest(
      event("provider-a", "evt-1", {
        schedule: {
          startsAt: "2026-10-18T08:00:00.000Z",
          endsAt: "2026-10-18T16:00:00.000Z",
          timezone: "Europe/Madrid"
        }
      })
    );
    assert.equal(moved.id, first.id);
    assert.equal(moved.status, "rescheduled");
    assert.equal(moved.revision, 2);
  });

  it("filters consistently, paginates with an opaque cursor and clamps the budget", async () => {
    const repository = new MemoryEventRepository();
    const service = new EventService(repository, [], () => NOW);
    await service.ingest(event("a", "1"));
    await service.ingest(
      event("b", "2", {
        title: "Paid concert",
        categories: ["music"],
        venue: {
          name: "Other Hall",
          location: { type: "Point", coordinates: [14.42, 50.08] }
        },
        schedule: {
          startsAt: "2026-11-17T08:00:00.000Z",
          timezone: "Europe/Prague"
        },
        officialUrl: "https://events.example.invalid/paid",
        price: { currency: "EUR", min: 20, max: 30, free: false }
      })
    );

    const page = await service.list({
      from: NOW.toISOString(),
      to: "2027-01-01T00:00:00.000Z",
      limit: 1
    });
    assert.equal(page.events.length, 1);
    assert.ok(page.meta.nextCursor);
    assert.ok(decodeEventCursor(page.meta.nextCursor!));
    const next = await service.list({
      from: NOW.toISOString(),
      to: "2027-01-01T00:00:00.000Z",
      cursor: page.meta.nextCursor!,
      limit: 1
    });
    assert.equal(next.events[0]?.title, "Paid concert");

    const free = await service.list({
      from: NOW.toISOString(),
      to: "2027-01-01T00:00:00.000Z",
      category: "community",
      free: true
    });
    assert.deepEqual(
      free.events.map((row) => row.title),
      ["Open Map Day"]
    );
    assert.equal(normalizeEventLimit(10_000), 100);
    assert.equal(normalizeEventLimit(0), 1);
    await assert.rejects(
      () =>
        service.list({
          from: "2026-01-01T00:00:00.000Z",
          to: "2028-01-01T00:00:00.000Z"
        }),
      /366 days/
    );
  });

  it("projects full event status/time/source identity into the map feature envelope", () => {
    const feature = eventToMapOSFeature(event("provider-a", "evt-1"));
    assert.equal(feature.properties.kind, "event");
    assert.equal(feature.properties.temporal?.startsAt, "2026-10-17T08:00:00.000Z");
    assert.equal(feature.properties.providerFields?.canonical?.status, "scheduled");
    assert.equal(feature.sources[0]?.sourceId, "evt-1");
  });

  it("reports an ingest source enabled only when its configured adapter is injected", () => {
    const repository = new MemoryEventRepository();
    const disabled = new EventService(repository);
    const enabled = new EventService(repository, [{ id: "ticketmaster", load: async () => [] }]);
    assert.equal(disabled.sourceGates().find((gate) => gate.id === "ticketmaster")?.enabled, false);
    assert.equal(enabled.sourceGates().find((gate) => gate.id === "ticketmaster")?.enabled, true);
    assert.equal(enabled.sourceGates().find((gate) => gate.id === "facebook")?.enabled, false);
  });

  it("degrades a failed adapter to canonical cached rows instead of failing the map", async () => {
    const repository = new MemoryEventRepository([event("cached", "1")]);
    const service = new EventService(
      repository,
      [
        {
          id: "ticketmaster",
          load: async () => {
            throw new Error("provider unavailable");
          }
        }
      ],
      () => NOW
    );
    const result = await service.features({
      bbox: [-1, 39, 0, 40],
      from: NOW.toISOString(),
      to: "2027-01-01T00:00:00.000Z",
      refresh: true
    });
    assert.equal(result.data.features.length, 1);
    assert.deepEqual(result.meta.sources, [
      { providerId: "cached", state: "ready" },
      { providerId: "ticketmaster", state: "unavailable" }
    ]);
    assert.equal(result.notices[0]?.code, "event-source-unavailable");
  });
});
