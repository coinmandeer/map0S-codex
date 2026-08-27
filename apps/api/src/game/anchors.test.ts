import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COMPLETION_RADIUS_M,
  anchoredQuestsForBbox,
  parseAnchoredQuestId,
  registerQuestSource,
  resetQuestSources,
  verifyAnchoredQuest,
  type QuestAnchor,
  type QuestSourceAdapter
} from "./anchors.js";

const CASTLE: QuestAnchor = {
  ref: "osm:way/123",
  name: "Hrad Kokořín",
  lng: 14.5,
  lat: 50.4,
  category: "castle"
};

const BENCH: QuestAnchor = {
  ref: "osm:node/9",
  name: "Muzeum loutek",
  lng: 14.51,
  lat: 50.41,
  category: "museum"
};

function fakeSource(anchors: QuestAnchor[]): QuestSourceAdapter {
  return {
    id: "test-source",
    label: "Test",
    attribution: "test",
    async anchors() {
      return anchors;
    },
    async resolve(ref) {
      return anchors.find((a) => a.ref === ref) ?? null;
    }
  };
}

test("quests are derived from real places, without any rows", async (t) => {
  t.after(resetQuestSources);
  resetQuestSources();
  registerQuestSource(fakeSource([CASTLE, BENCH]));

  const quests = await anchoredQuestsForBbox([14, 50, 15, 51]);
  assert.equal(quests.length, 2);

  const castleQuest = quests.find((q) => q.anchorRef === CASTLE.ref);
  assert.ok(castleQuest);
  assert.match(castleQuest.title, /Kokořín/);
  assert.deepEqual([castleQuest.lng, castleQuest.lat], [CASTLE.lng, CASTLE.lat]);

  // A castle is a bigger detour than a museum, so it is worth more and is listed first.
  assert.equal(quests[0]!.anchorRef, CASTLE.ref);

  const again = await anchoredQuestsForBbox([14, 50, 15, 51]);
  assert.deepEqual(again, quests);
});

test("a quest id round-trips through the URL-safe encoding", async (t) => {
  t.after(resetQuestSources);
  resetQuestSources();
  const source = fakeSource([CASTLE]);
  registerQuestSource(source);

  const [quest] = await anchoredQuestsForBbox([14, 50, 15, 51]);
  assert.ok(quest);
  assert.ok(!quest.id.includes("/"), "ids travel as path params and must not contain slashes");

  const parsed = parseAnchoredQuestId(quest.id);
  assert.equal(parsed?.ref, CASTLE.ref);
  assert.equal(parsed?.adapter.id, source.id);
  assert.equal(parseAnchoredQuestId("11111111-2222-3333-4444-555555555555"), null);
});

test("a claim is checked against the anchor, not against what the client sent", async (t) => {
  t.after(resetQuestSources);
  resetQuestSources();
  registerQuestSource(fakeSource([CASTLE]));

  const [quest] = await anchoredQuestsForBbox([14, 50, 15, 51]);
  assert.ok(quest);

  const onSite = await verifyAnchoredQuest(quest.id, { lng: CASTLE.lng, lat: CASTLE.lat + 0.0005 });
  assert.equal(onSite?.withinRange, true);
  assert.ok(onSite!.distanceM < COMPLETION_RADIUS_M);

  const fromTheSofa = await verifyAnchoredQuest(quest.id, { lng: 14.9, lat: 50.9 });
  assert.equal(fromTheSofa?.withinRange, false);
  assert.ok(fromTheSofa!.distanceM > COMPLETION_RADIUS_M);
});

test("an anchor that no longer exists cannot be claimed", async (t) => {
  t.after(resetQuestSources);
  resetQuestSources();
  registerQuestSource(fakeSource([CASTLE]));
  const [quest] = await anchoredQuestsForBbox([14, 50, 15, 51]);
  assert.ok(quest);

  resetQuestSources();
  registerQuestSource(fakeSource([]));
  assert.equal(await verifyAnchoredQuest(quest.id, { lng: CASTLE.lng, lat: CASTLE.lat }), null);
});

test("one failing source does not empty the quest list", async (t) => {
  t.after(resetQuestSources);
  resetQuestSources();
  registerQuestSource({
    id: "broken",
    label: "Broken",
    attribution: "",
    async anchors() {
      throw new Error("upstream is down");
    },
    async resolve() {
      return null;
    }
  });
  registerQuestSource(fakeSource([CASTLE]));

  const quests = await anchoredQuestsForBbox([14, 50, 15, 51]);
  assert.equal(quests.length, 1);
});
