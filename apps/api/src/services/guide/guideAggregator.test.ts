import assert from "node:assert/strict";
import test from "node:test";
import type { Guide } from "@mapos/layer-sdk";
import type { AiModelProfile, AiTurnOutcome, AiTurnRequest } from "../ai/contracts.js";
import type { AiModelRuntime } from "../ai/modelRuntime.js";
import {
  buildGuideSynthesis,
  collectGuideEvidence,
  createGuideAggregator,
  guideCacheKey,
  type GuideAreaRef,
  type GuideCollectors
} from "./guideAggregator.js";

const AREA: GuideAreaRef = {
  regionId: "nominatim:relation:12345",
  name: "Plzeň",
  level: "locality",
  lang: "cs",
  center: { longitude: 13.3775, latitude: 49.7475 },
  bbox: [13.3, 49.7, 13.45, 49.8],
  wikidataId: "Q43453"
};

const GUIDE: Guide = {
  area: "Plzeň",
  lang: "cs",
  sourceId: "wikivoyage",
  attribution: "Wikivoyage",
  url: "https://cs.wikivoyage.org/wiki/Plze%C5%88",
  sections: [
    {
      id: "understand",
      title: "Pochopit",
      intro: "Plzeň je čtvrté největší město Česka a rodiště světlého ležáku.",
      items: []
    },
    {
      id: "see",
      title: "Co vidět",
      items: [
        {
          name: "Velká synagoga",
          description: "Druhá největší synagoga v Evropě.",
          lng: 13.372,
          lat: 49.746,
          sourceRef: "wikidata:Q1145"
        }
      ]
    }
  ]
};

function collectorsWith(overrides: GuideCollectors = {}): GuideCollectors {
  return {
    guide: async () => ({
      value: GUIDE,
      sources: [
        { sourceId: "guide:wikivoyage", label: "Wikivoyage", url: "https://cs.wikivoyage.org" }
      ]
    }),
    encyclopedia: async () => ({
      value: [
        {
          sourceId: "wikipedia:cs:Plzeň",
          title: "Plzeň",
          extract: "Plzeň je statutární město na západě Čech. Leží na soutoku čtyř řek.",
          url: "https://cs.wikipedia.org/wiki/Plze%C5%88"
        }
      ],
      sources: [{ sourceId: "wikipedia:cs:Plzeň", label: "Wikipedia (cs)" }]
    }),
    places: async () => ({
      value: [
        {
          id: "osm:1",
          title: "Katedrála svatého Bartoloměje",
          category: "church",
          categoryLabel: "Kostel",
          longitude: 13.3776,
          latitude: 49.7476,
          layerId: "osm-poi",
          sourceId: "osm-poi"
        }
      ],
      sources: [{ sourceId: "osm-poi", label: "OpenStreetMap" }]
    }),
    ...overrides
  };
}

function runtimeReturning(
  outcome: (request: AiTurnRequest) => AiTurnOutcome,
  enabled = true
): AiModelRuntime {
  const profile: AiModelProfile = {
    id: "fast-test",
    providerId: "test-provider",
    model: "test-model",
    capabilities: { text: true, jsonSchema: false, tools: true, streaming: false, vision: false },
    limits: {
      contextTokens: 32_000,
      outputTokens: 1_000,
      maxToolRounds: 3,
      timeoutMs: 10_000,
      maxResponseBytes: 262_144
    },
    privacy: {
      execution: "external",
      allowedDataClasses: ["public"],
      retention: "provider-policy"
    },
    costPolicy: "economy"
  };
  return {
    enabled,
    profiles: () => [profile],
    gateway: { turn: async (request: AiTurnRequest) => outcome(request) }
  } as unknown as AiModelRuntime;
}

function submission(args: Record<string, unknown>): AiTurnOutcome {
  return {
    status: "succeeded",
    text: "",
    toolCalls: [{ id: "call-1", name: "submit_guide", arguments: args }],
    citations: [],
    meta: {
      runId: "run-1",
      taskId: "guide-synthesis",
      templateVersion: "guide-synthesis.v1",
      profileId: "fast-test",
      providerId: "test-provider",
      model: "test-model",
      cached: false,
      durationMs: 1
    }
  };
}

test("a source that hangs is missing from the guide, not fatal to it", async () => {
  const evidence = await collectGuideEvidence(
    AREA,
    collectorsWith({
      web: async (_area, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        })
    }),
    { timeoutMs: 20 }
  );

  assert.deepEqual(evidence.degraded, ["web"]);
  assert.equal(evidence.guide?.area, "Plzeň");
  assert.equal(evidence.encyclopedia.length, 1);
  // Every collected source is citable, and each id appears once.
  assert.deepEqual(evidence.sources.map((source) => source.sourceId).sort(), [
    "guide:wikivoyage",
    "osm-poi",
    "wikipedia:cs:Plzeň"
  ]);
});

test("what the caller already fetched is not fetched again", async () => {
  let guideCalls = 0;
  const evidence = await collectGuideEvidence(
    AREA,
    collectorsWith({
      guide: async () => {
        guideCalls += 1;
        return { value: GUIDE };
      }
    }),
    {
      seed: {
        guide: null,
        statistics: [
          {
            id: "population",
            label: "Obyvatelstvo",
            value: 614_640,
            unit: "osob",
            year: 2025,
            sourceIds: ["wikidata"]
          }
        ],
        sources: [{ sourceId: "wikidata", label: "Wikidata" }]
      }
    }
  );

  assert.equal(guideCalls, 0);
  assert.equal(evidence.guide, null);
  assert.equal(evidence.statistics[0]?.value, 614_640);
  assert.ok(evidence.sources.some((source) => source.sourceId === "wikidata"));
});

test("the model writes the guide and may only cite what it was given", async () => {
  const runtime = runtimeReturning((request) => {
    // The area's sources arrive as blocks, one per citable id.
    assert.ok(request.sourceBlocks.some((block) => block.sourceId === "guide:wikivoyage"));
    assert.deepEqual(request.toolChoice, { name: "submit_guide" });
    return submission({
      lead: "Plzeň je město ležáku, čtyř řek a druhé největší synagogy v Evropě.",
      highlights: [
        {
          title: "Velká synagoga",
          text: "Druhá největší v Evropě, deset minut od centra.",
          sourceIds: ["guide:wikivoyage"],
          placeId: "osm:1"
        },
        {
          title: "Vymyšlené místo",
          text: "Tvrzení bez zdroje, který by ho unesl.",
          sourceIds: ["nikde:nic"]
        }
      ],
      practical: { arrival: "Vlakem z Prahy 1:30", warnings: ["V neděli má pivovar zavřeno"] }
    });
  });

  const evidence = await collectGuideEvidence(AREA, collectorsWith());
  const synthesis = await buildGuideSynthesis(evidence, { runtime });

  assert.equal(synthesis.kind, "model");
  assert.equal(synthesis.model, "test-model");
  // The unsourced highlight is gone; the sourced one kept the place it pointed at.
  assert.equal(synthesis.highlights.length, 1);
  assert.deepEqual(synthesis.highlights[0]?.sourceIds, ["guide:wikivoyage"]);
  assert.equal(synthesis.highlights[0]?.place?.longitude, 13.3776);
  assert.equal(synthesis.practical.arrival, "Vlakem z Prahy 1:30");
});

test("without a model the guide is still written, from the article it has", async () => {
  const evidence = await collectGuideEvidence(AREA, collectorsWith());
  const synthesis = await buildGuideSynthesis(evidence, {
    runtime: runtimeReturning(() => submission({}), false)
  });

  assert.equal(synthesis.kind, "structured");
  assert.match(synthesis.lead, /čtvrté největší město/u);
  assert.equal(synthesis.highlights[0]?.title, "Velká synagoga");
  assert.deepEqual(synthesis.highlights[0]?.sourceIds, ["guide:wikivoyage"]);
});

test("with no guide the encyclopedia answers, and with nothing at all an action does", async () => {
  const extract = await buildGuideSynthesis(
    await collectGuideEvidence(AREA, collectorsWith({ guide: async () => ({ value: null }) })),
    { allowModel: false }
  );
  assert.equal(extract.kind, "extract");
  assert.deepEqual(extract.leadSourceIds, ["wikipedia:cs:Plzeň"]);
  assert.match(extract.lead, /statutární město/u);
  assert.equal(extract.highlights[0]?.title, "Katedrála svatého Bartoloměje");

  const nothing = await buildGuideSynthesis(await collectGuideEvidence(AREA, {}), {
    allowModel: false
  });
  assert.equal(nothing.kind, "none");
  // §30.5: an empty state without an action is not allowed.
  assert.deepEqual(nothing.action, { id: "ask-ai-web", label: "Zeptat se AI (web)" });
});

test("the same region in the same month is written once, but its numbers stay current", async () => {
  let guideCalls = 0;
  const aggregator = createGuideAggregator({
    collectors: collectorsWith({
      guide: async () => {
        guideCalls += 1;
        return { value: GUIDE, sources: [{ sourceId: "guide:wikivoyage", label: "Wikivoyage" }] };
      }
    }),
    runtime: runtimeReturning(() => submission({}), false),
    now: () => Date.parse("2026-09-02T10:00:00.000Z")
  });

  const first = await aggregator.get(AREA, { allowModel: false });
  const second = await aggregator.get(AREA, {
    allowModel: false,
    seed: {
      events: [
        {
          id: "e1",
          title: "Pilsner Fest",
          startsAt: "2026-10-03T16:00:00.000Z",
          sourceId: "events"
        }
      ]
    }
  });

  assert.equal(guideCalls, 1);
  assert.equal(first.lead, second.lead);
  assert.deepEqual(first.events, []);
  // The cached text is reused; the live sections are not.
  assert.equal(second.events[0]?.title, "Pilsner Fest");
});

test("the cache key changes with the month, the language and the model path", () => {
  const september = Date.parse("2026-09-02T00:00:00.000Z");
  const october = Date.parse("2026-10-02T00:00:00.000Z");
  assert.equal(guideCacheKey(AREA, true, september), "nominatim:relation:12345|cs|2026-09|model");
  assert.notEqual(guideCacheKey(AREA, true, october), guideCacheKey(AREA, true, september));
  assert.notEqual(guideCacheKey(AREA, false, september), guideCacheKey(AREA, true, september));
  assert.notEqual(
    guideCacheKey({ ...AREA, lang: "en" }, true, september),
    guideCacheKey(AREA, true, september)
  );
});

test("ordinary Discover never performs web research even with a configured cloud account", async () => {
  let searches = 0;
  const guide = createGuideAggregator({
    collectors: collectorsWith({
      web: async () => {
        searches++;
        return { value: [] };
      }
    })
  });
  await guide.get(AREA, { allowModel: false });
  assert.equal(searches, 0);
});
