import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_CONVERSATION_RAW_CHAR_LIMIT,
  AI_CONVERSATION_MODEL_CONTEXT_BYTE_LIMIT,
  AI_CONVERSATION_RAW_MESSAGE_LIMIT,
  AiConversationStore,
  ConversationNotFoundError,
  ConversationRevisionError
} from "./conversation.js";

function fixtureStore() {
  let id = 0;
  let tick = 0;
  return new AiConversationStore(
    () => new Date(1_780_000_000_000 + tick++ * 1_000),
    () => `id-${++id}`
  );
}

test("nanoid owners beginning with dash or underscore retain isolated conversations", () => {
  const store = fixtureStore();
  for (const owner of ["-memory-user", "_memory-user"]) {
    const conversation = store.create(owner, { type: "global" });
    const updated = store.append(owner, conversation.id, {
      baseRevision: 0,
      role: "user",
      content: "Najdi bar",
      dataClass: "account-private"
    });
    assert.equal(updated.revision, 1);
    assert.equal(store.get(owner, conversation.id).ownerUserId, owner);
    assert.throws(() => store.get("other-owner", conversation.id), ConversationNotFoundError);
  }
  for (const invalid of ["../owner", "name with spaces", "", "/owner"]) {
    assert.throws(() => store.create(invalid, { type: "global" }), TypeError);
  }
});

test("scoped conversations carry citations/tools/artifacts and require current revision", () => {
  const store = fixtureStore();
  const created = store.create("user-1", { type: "stop", planId: "plan-1", stopId: "stop-2" });
  const updated = store.append("user-1", created.id, {
    baseRevision: 0,
    role: "assistant",
    content: "Navrhuji dvě noci.",
    dataClass: "public",
    citations: [{ sourceId: "osm:1", label: "OSM" }],
    toolNames: ["query_layer"],
    artifactIds: ["draft-1"]
  });
  assert.equal(updated.revision, 1);
  assert.deepEqual(updated.scope, { type: "stop", planId: "plan-1", stopId: "stop-2" });
  assert.deepEqual(updated.messages[0]?.toolNames, ["query_layer"]);
  assert.throws(
    () =>
      store.append("user-1", created.id, {
        baseRevision: 0,
        role: "user",
        content: "Pozdní zpráva",
        dataClass: "public"
      }),
    ConversationRevisionError
  );
});

test("owner ACL is non-enumerable and deletion satisfies the data-right boundary", () => {
  const store = fixtureStore();
  const conversation = store.create("user-1", { type: "feature", layerId: "osm", featureId: "1" });
  assert.throws(() => store.get("user-2", conversation.id), ConversationNotFoundError);
  assert.equal(store.delete("user-1", conversation.id), true);
  assert.throws(() => store.get("user-1", conversation.id), ConversationNotFoundError);
});

test("projection excludes private and precise messages from a public external profile", () => {
  const store = fixtureStore();
  let conversation = store.create("user-1", { type: "global" });
  for (const [content, dataClass] of [
    ["Veřejná otázka", "public"],
    ["Moje poznámka", "account-private"],
    ["Přesná poloha", "precise-user-location"]
  ] as const) {
    conversation = store.append("user-1", conversation.id, {
      baseRevision: conversation.revision,
      role: "user",
      content,
      dataClass
    });
  }
  assert.deepEqual(
    store.project("user-1", conversation.id, ["public"]).map((message) => message.content),
    ["Veřejná otázka"]
  );
});

test("archived conversations reject further messages", () => {
  const store = fixtureStore();
  const conversation = store.create("user-1", { type: "plan", planId: "plan-1" });
  const archived = store.archive("user-1", conversation.id, conversation.revision);
  assert.ok(archived.archivedAt);
  assert.throws(
    () =>
      store.append("user-1", conversation.id, {
        baseRevision: archived.revision,
        role: "user",
        content: "Další",
        dataClass: "public"
      }),
    ConversationRevisionError
  );
});

test("long scoped conversations store bounded structured compaction and omit the raw transcript", () => {
  const store = fixtureStore();
  let conversation = store.create("user-1", {
    type: "day",
    planId: "plan-1",
    dayId: "day-2"
  });
  const fullRawTranscript: string[] = [];
  for (let index = 0; index < 80; index += 1) {
    const content = `RAW-${String(index).padStart(3, "0")}-${"x".repeat(360)}`;
    fullRawTranscript.push(content);
    conversation = store.append("user-1", conversation.id, {
      baseRevision: conversation.revision,
      role: index % 2 === 0 ? "user" : "assistant",
      content,
      dataClass: "public",
      citations: [{ sourceId: `source:${index}`, label: `Zdroj ${index}` }],
      toolNames: [`tool-${index}`],
      artifactIds: [`artifact-${index}`]
    });
  }

  assert.equal(conversation.messageCount, 80);
  assert.ok(conversation.messages.length <= AI_CONVERSATION_RAW_MESSAGE_LIMIT);
  assert.ok(
    conversation.messages.reduce((count, message) => count + message.content.length, 0) <=
      AI_CONVERSATION_RAW_CHAR_LIMIT
  );
  assert.ok(conversation.compaction);
  assert.equal(
    conversation.compaction!.compactedMessageCount + conversation.messages.length,
    conversation.messageCount
  );
  assert.ok(conversation.compaction!.partitions[0]?.summary);
  assert.ok(conversation.compaction!.partitions[0]?.state.latestUserIntent);
  assert.deepEqual(conversation.scope, { type: "day", planId: "plan-1", dayId: "day-2" });

  const context = store.projectForModel("user-1", conversation.id, ["public"]);
  const encodedContext = JSON.stringify(context);
  assert.ok(context.recentMessages.length <= AI_CONVERSATION_RAW_MESSAGE_LIMIT);
  assert.ok(context.compactedMessageCount > 0);
  assert.ok(encodedContext.length < JSON.stringify(fullRawTranscript).length / 2);
  assert.doesNotMatch(encodedContext, /RAW-000-/);
  assert.match(encodedContext, /RAW-079-/);
});

test("compacted summaries and state remain partitioned by data class", () => {
  const store = fixtureStore();
  let conversation = store.create("user-1", { type: "global" });
  for (let index = 0; index < 60; index += 1) {
    const privateMessage = index < 30;
    conversation = store.append("user-1", conversation.id, {
      baseRevision: conversation.revision,
      role: "user",
      content: privateMessage ? `PRIVATE-COMPACTED-${index}` : `PUBLIC-COMPACTED-${index}`,
      dataClass: privateMessage ? "account-private" : "public",
      toolNames: [privateMessage ? "private-tool" : "public-tool"]
    });
  }

  const publicContext = store.projectForModel("user-1", conversation.id, ["public"]);
  assert.doesNotMatch(JSON.stringify(publicContext), /PRIVATE-COMPACTED|private-tool/);
  assert.match(JSON.stringify(publicContext), /PUBLIC-COMPACTED|public-tool/);
  assert.ok(publicContext.summaries.every(({ dataClass }) => dataClass === "public"));
});

test("model projection has an exact encoded budget including bounded citation metadata", () => {
  const store = fixtureStore();
  let conversation = store.create("user-1", { type: "global" });
  const dataClasses = ["public", "account-private", "precise-user-location", "secret"] as const;
  for (let index = 0; index < 12; index += 1) {
    const marker = `MESSAGE-${String(index).padStart(2, "0")}-`;
    conversation = store.append("user-1", conversation.id, {
      baseRevision: conversation.revision,
      role: "user",
      content: marker + "界".repeat(12_000 - marker.length),
      dataClass: dataClasses[index % dataClasses.length]!,
      citations: Array.from({ length: 12 }, (_, citationIndex) => ({
        sourceId: `source:${index}:${citationIndex}`,
        label: "Zdroj " + "ž".repeat(220),
        url: `https://fixture.test/${"a".repeat(1_900)}${citationIndex}`,
        providerId: "fixture-provider",
        retrievedAt: "2026-09-01T10:00:00.000Z"
      })),
      toolNames: Array.from({ length: 30 }, (_, toolIndex) => `tool-${toolIndex}`),
      artifactIds: Array.from({ length: 30 }, (_, artifactIndex) => `artifact-${artifactIndex}`)
    });
  }

  const context = store.projectForModel("user-1", conversation.id, dataClasses);
  assert.ok(
    Buffer.byteLength(JSON.stringify(context), "utf8") <= AI_CONVERSATION_MODEL_CONTEXT_BYTE_LIMIT
  );
  assert.ok(context.omittedRecentMessageCount > 0);
  const latest = context.recentMessages[context.recentMessages.length - 1]!;
  assert.match(latest.content, /MESSAGE-11-/);
  assert.equal(latest.citations.length, 4);
  assert.equal(latest.toolNames.length, 20);
  assert.equal(latest.artifactIds.length, 20);

  const invalid = store.create("user-1", { type: "global" });
  assert.throws(
    () =>
      store.append("user-1", invalid.id, {
        baseRevision: invalid.revision,
        role: "assistant",
        content: "Neplatný zdroj",
        dataClass: "public",
        citations: [
          {
            sourceId: "source:oversized",
            label: "Zdroj",
            url: `https://fixture.test/${"x".repeat(3_000)}`
          }
        ]
      }),
    /citation URL/
  );
});
