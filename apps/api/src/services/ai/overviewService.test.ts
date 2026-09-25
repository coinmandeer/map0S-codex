import test from "node:test";
import assert from "node:assert/strict";
import {
  assertOverviewEvent,
  type OverviewEvent,
  type OverviewRequest,
  type EvidenceItem
} from "@mapos/layer-sdk";
import { OverviewService, type OverviewDependencies } from "./overviewService.js";
const input: OverviewRequest = {
  target: { type: "poi", layerId: "osm-poi", featureId: "osm:node:123" },
  consent: { externalModel: false }
};
const context = {
  ownerUserId: "one",
  permissionRevision: "r1",
  allowedLayerIds: new Set(["osm-poi"])
};
const detail: OverviewDependencies["detail"] = async () => ({
  place: {
    id: "osm:node:123",
    name: "Parkoviště",
    category: "parking",
    lng: 1,
    lat: 2,
    sources: []
  },
  fields: { name: "Parkoviště", category: "parking" },
  source: { sourceId: "osm:123", label: "OSM", providerId: "osm" }
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
test("facts and geometry arrive before collector, collector failure preserves both", async () => {
  const gate = deferred<void>();
  const events: OverviewEvent[] = [];
  const service = new OverviewService({
    detail,
    collect: async () => {
      await gate.promise;
      throw new Error("web unavailable");
    }
  });
  const pending = service.run(input, context, new AbortController().signal, (e) => events.push(e));
  await tick();
  assert(events.some((e) => e.snapshot.sections[0]?.claims.length));
  assert(events.some((e) => e.snapshot.mapRefs.length === 1));
  assert(!events.some((e) => e.type === "complete"));
  gate.resolve();
  await pending;
  assert.equal(events.at(-1)?.type, "partial");
  assert.equal(events.at(-1)?.snapshot.mapRefs[0]?.featureId, "osm:node:123");
  events.forEach(assertOverviewEvent);
});
test("shared acquisition survives first subscriber departure and aborts last", async () => {
  let calls = 0;
  let signal: AbortSignal | undefined;
  const gate = deferred<void>();
  const service = new OverviewService({
    detail: async (i, s) => {
      calls++;
      signal = s;
      await gate.promise;
      s.throwIfAborted();
      return detail(i, s);
    }
  });
  const first = new AbortController(),
    second = new AbortController();
  const a = service.run(input, context, first.signal, () => {});
  const b = service.run(input, context, second.signal, () => {});
  await tick();
  first.abort();
  await a;
  assert.equal(calls, 1);
  assert.equal(signal?.aborted, false);
  second.abort();
  await b;
  assert.equal(signal?.aborted, true);
  gate.resolve();
});
test("unknown coordinate remains a coordinate and has no neighbouring business identity", async () => {
  let calls = 0;
  let end: OverviewEvent | undefined;
  const service = new OverviewService({
    detail: async (...args) => {
      calls++;
      return detail(...args);
    }
  });
  await service.run(
    { target: { type: "coordinate", lng: 1, lat: 2 }, consent: { externalModel: false } },
    context,
    new AbortController().signal,
    (e) => {
      end = e;
    }
  );
  assert.equal(calls, 0);
  assert.equal(end?.snapshot.mapRefs.length, 0);
  assert.match(end!.snapshot.sources[0]!.text, /Identita místa zatím není ověřená/);
});
test("cache avoids acquisition, ACL and owner partitions are checked again", async () => {
  let calls = 0;
  const service = new OverviewService({
    detail: async (...args) => {
      calls++;
      return detail(...args);
    }
  });
  const run = (ctx = context) => service.run(input, ctx, new AbortController().signal, () => {});
  await run();
  await run();
  assert.equal(calls, 1);
  await assert.rejects(run({ ...context, allowedLayerIds: new Set() }), /dostupná/);
  await run({ ...context, ownerUserId: "two" });
  assert.equal(calls, 2);
  await run({ ...context, permissionRevision: "r2" });
  assert.equal(calls, 3);
});
test("deadline returns partial and late acquisition cannot mutate terminal snapshot", async () => {
  const gate = deferred<void>();
  const events: OverviewEvent[] = [];
  const service = new OverviewService({
    detail,
    deadlineMs: 15,
    collect: async (_i, _e, _s, publish) => {
      await gate.promise;
      publish([{ id: "late" } as EvidenceItem]);
    }
  });
  await service.run(input, context, new AbortController().signal, (e) => events.push(e));
  const count = events.length;
  const end = JSON.stringify(events.at(-1));
  gate.resolve();
  await tick();
  assert.equal(events.length, count);
  assert.equal(JSON.stringify(events.at(-1)), end);
});
test("model cannot cite nonexisting facts or introduce uncited text", async () => {
  let end: OverviewEvent | undefined;
  const service = new OverviewService({ detail, synthesize: async () => ["invented"] });
  await service.run(
    { ...input, consent: { externalModel: true } },
    context,
    new AbortController().signal,
    (e) => {
      end = e;
    }
  );
  assert.equal(end?.type, "partial");
  assert.match(
    end!.snapshot.sections.find((s) => s.id === "summary")!.claims[0]!.text,
    /Parkoviště/
  );
  assert.equal(end?.snapshot.sections.find((s) => s.id === "facts")?.claims.length, 2);
});

test("unverified web document bodies stay server-side in stream and warm cache", async () => {
  const service = new OverviewService({
    detail,
    collect: async (_input, _sources, _signal, publish) =>
      publish([
        {
          id: "web:one",
          sourceRecordId: "https://example.org/article",
          providerId: "web",
          label: "Candidate",
          url: "https://example.org/article",
          relation: "nearby",
          topic: "candidate",
          kind: "document",
          text: "Long unverified candidate content",
          retrievedAt: new Date().toISOString(),
          originGroup: "example.org",
          access: "public"
        }
      ])
  });
  for (let pass = 0; pass < 2; pass++) {
    const events: OverviewEvent[] = [];
    await service.run(input, context, new AbortController().signal, (event) => events.push(event));
    assert(events.at(-1)?.snapshot.sources.some((source) => source.id === "web:one"));
    assert(
      events.every((event) =>
        event.snapshot.sources.every((source) => source.kind !== "document" || source.text === "")
      )
    );
    assert(
      events.every((event) =>
        event.snapshot.sections.every((section) =>
          section.claims.every((claim) => !claim.evidenceIds.includes("web:one"))
        )
      )
    );
  }
});

test("area references arrive during collection and text updates keep geometry revision", async () => {
  const events: OverviewEvent[] = [];
  const service = new OverviewService({
    detail,
    area: async () => ({
      id: "area",
      revision: "r",
      source: "test",
      country: "CZ",
      code: "test",
      level: "lau",
      name: "Obec",
      bbox: [1, 2, 3, 4]
    }),
    collect: async (_i, _e, _s, publish) => {
      const source: EvidenceItem = {
        id: "place-one",
        sourceRecordId: "osm-1",
        providerId: "osm",
        label: "Hrad",
        relation: "within_area",
        topic: "highlights",
        kind: "fact",
        text: "Hrad uvnitř vybrané oblasti.",
        retrievedAt: new Date().toISOString(),
        access: "public",
        originGroup: "osm",
        place: { layerId: "osm-poi", featureId: "osm-1", title: "Hrad", lng: 2, lat: 3 }
      };
      publish([source]);
      for (let i = 0; i < 20; i++)
        publish([
          {
            ...source,
            id: `fact-${i}`,
            place: undefined,
            topic: "practical",
            text: `Zdrojový údaj ${i}`
          }
        ]);
    }
  });
  await service.run(
    {
      target: { type: "area", areaId: "area", boundaryRevision: "r" },
      consent: { externalModel: false }
    },
    context,
    new AbortController().signal,
    (e) => events.push(e)
  );
  const refs = events.filter((e) => e.snapshot.mapRefs.length);
  assert(refs.length >= 21);
  assert.equal(new Set(refs.map((e) => e.snapshot.geometryRevision)).size, 1);
  assert(refs.some((e) => e.type === "section_upsert"));
  events.forEach(assertOverviewEvent);
});
test("unallocated model never announces or dispatches synthesis", async () => {
  const events: OverviewEvent[] = [];
  let calls = 0;
  const service = new OverviewService({
    detail,
    synthesisAvailable: async () => false,
    synthesize: async () => {
      calls++;
      return [];
    }
  });
  await service.run(
    { ...input, consent: { externalModel: true } },
    context,
    new AbortController().signal,
    (e) => events.push(e)
  );
  assert.equal(calls, 0);
  assert(!events.some((e) => e.phase?.includes("sestavuji souhrn")));
  assert.equal(events.at(-1)?.snapshot.composition, "facts");
});

test("follow-up intent reuses acquired evidence but refresh and permission change do not", async () => {
  let acquisitions = 0;
  const service = new OverviewService({
    detail,
    collect: async () => {
      acquisitions++;
    }
  });
  const run = (intent: string, refresh = false, permissionRevision = "r1") =>
    service.run(
      { ...input, intent, refresh },
      { ...context, permissionRevision },
      new AbortController().signal,
      () => {}
    );
  await run("character");
  await run("practical");
  assert.equal(acquisitions, 1);
  await run("practical", true);
  assert.equal(acquisitions, 2);
  await run("practical", false, "r2");
  assert.equal(acquisitions, 3);
});
