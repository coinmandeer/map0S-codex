import test from "node:test";
import assert from "node:assert/strict";
import { AiConversationStore } from "./conversation.js";
import { legacyHistoryTurns } from "./legacyHistory.js";
test("legacy history keeps preserved messages and citations without inventing map state", () => {
  const store = new AiConversationStore();
  const document = store.create("owner", { type: "global" });
  document.messages = [
    {
      id: "q",
      revision: 1,
      role: "user",
      content: "Málaga",
      dataClass: "account-private",
      citations: [],
      toolNames: [],
      artifactIds: [],
      createdAt: document.createdAt
    },
    {
      id: "a",
      revision: 2,
      role: "assistant",
      content: "Dochovaná odpověď",
      dataClass: "account-private",
      citations: [{ sourceId: "osm", label: "OSM" }],
      toolNames: [],
      artifactIds: [],
      createdAt: document.createdAt
    }
  ];
  const turns = legacyHistoryTurns(document);
  assert.equal(turns.length, 1);
  assert.equal(turns[0]!.question, "Málaga");
  assert.equal(turns[0]!.text, "Dochovaná odpověď");
  assert.deepEqual(turns[0]!.cards, []);
  assert.equal(turns[0]!.sources[0]!.sourceId, "osm");
});
