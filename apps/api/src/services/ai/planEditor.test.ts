import assert from "node:assert/strict";
import test from "node:test";
import { planV1ToV2, type PlanDocumentV2 } from "@mapos/layer-sdk";
import {
  AiPlanProposalPlanMissingError,
  AiPlanProposalRevisionError,
  AiPlanProposalStateError,
  createAiPlanProposalCoordinator,
  planCommandFromEdits,
  type AiPlanEditorRepository
} from "./planEditor.js";
import type { AiPlaceSearchRecord } from "./placeSearch.js";

function plan(): PlanDocumentV2 {
  return planV1ToV2(
    {
      id: "plan-1",
      name: "Výlet",
      departureAt: "2026-09-01T08:00:00.000Z",
      variant: "fast",
      stops: [
        { id: "a", name: "A", lng: 14, lat: 50, dwellMinutes: 0 },
        { id: "b", name: "B", lng: 15, lat: 49, dwellMinutes: 0 }
      ],
      vehicle: { profile: "car" },
      visibility: "private"
    },
    { now: "2026-09-01T08:00:00.000Z", ownerId: "user-1" }
  );
}

const KUTNA_HORA: AiPlaceSearchRecord = {
  id: "osm:node/1",
  layerId: "osm-poi",
  title: "Kutná Hora",
  category: "attraction",
  longitude: 15.268,
  latitude: 49.948,
  sourceId: "osm"
};

/** An in-memory stand-in with the optimistic-revision behaviour of the real repositories. */
function repository(seed = plan()): AiPlanEditorRepository & { current: PlanDocumentV2 | null } {
  return {
    current: seed,
    async get(ownerUserId, planId) {
      if (ownerUserId !== "user-1" || planId !== "plan-1") return null;
      return this.current ? structuredClone(this.current) : null;
    },
    async replace(_ownerUserId, _planId, document, expectedRevision) {
      if (!this.current || this.current.revision !== expectedRevision) {
        throw new Error("revision conflict");
      }
      this.current = structuredClone(document);
      return structuredClone(document);
    }
  };
}

test("an edit that names a stop or a place the loop never saw is dropped, not guessed", () => {
  const command = planCommandFromEdits({
    plan: plan(),
    places: [KUTNA_HORA],
    createId: () => "ai-stop-1",
    edits: [
      { op: "add-stop", placeId: "osm:node/1", atIndex: 1, note: "oběd" },
      { op: "add-stop", placeId: "osm:node/999" },
      { op: "remove-stop", stopId: "nonexistent" },
      { op: "move-stop", stopId: "b", toIndex: 0 }
    ]
  });

  assert.equal(command.type, "batch");
  assert.deepEqual(command.type === "batch" ? command.commands.map((entry) => entry.type) : [], [
    "add-stop",
    "move-stop"
  ]);
  assert.throws(() =>
    planCommandFromEdits({ plan: plan(), places: [], edits: [{ op: "remove-stop", stopId: "x" }] })
  );
});

test("a proposal changes nothing until it is confirmed, and one undo puts the plan back", async () => {
  const store = repository();
  const coordinator = createAiPlanProposalCoordinator({
    repository: store,
    createStopId: () => "ai-stop-1"
  });

  const proposed = await coordinator.editor.propose({
    ownerUserId: "user-1",
    planId: "plan-1",
    conversationId: "conversation-1",
    summary: "Přidat Kutnou Horu jako druhou zastávku.",
    edits: [{ op: "add-stop", placeId: "osm:node/1", atIndex: 1 }],
    places: [KUTNA_HORA],
    citations: [{ sourceId: "osm", label: "OpenStreetMap" }]
  });

  assert.deepEqual(proposed.diff.addedStopIds, ["ai-stop-1"]);
  assert.equal(store.current!.stops.length, 2, "proposing must not write");

  const confirmed = await coordinator.confirm("user-1", proposed.proposalId);
  assert.equal(confirmed.proposal.status, "confirmed");
  assert.deepEqual(
    store.current!.stops.map((stop) => stop.id),
    ["a", "ai-stop-1", "b"]
  );

  const undone = await coordinator.undo("user-1", proposed.proposalId);
  assert.equal(undone.proposal.status, "undone");
  assert.deepEqual(
    store.current!.stops.map((stop) => stop.id),
    ["a", "b"]
  );
});

test("a proposal cannot be applied twice, by someone else, or to a plan that moved", async () => {
  const store = repository();
  const coordinator = createAiPlanProposalCoordinator({
    repository: store,
    createStopId: () => "ai-stop-1"
  });
  const proposed = await coordinator.editor.propose({
    ownerUserId: "user-1",
    planId: "plan-1",
    conversationId: "conversation-1",
    summary: "Přidat Kutnou Horu.",
    edits: [{ op: "add-stop", placeId: "osm:node/1" }],
    places: [KUTNA_HORA],
    citations: []
  });

  await assert.rejects(() => coordinator.confirm("user-2", proposed.proposalId));
  await coordinator.confirm("user-1", proposed.proposalId);
  await assert.rejects(
    () => coordinator.confirm("user-1", proposed.proposalId),
    AiPlanProposalStateError
  );

  // The plan moved on after the confirmation, so the undo is refused instead of overwriting it.
  store.current = { ...store.current!, revision: store.current!.revision + 1 };
  await assert.rejects(
    () => coordinator.undo("user-1", proposed.proposalId),
    AiPlanProposalRevisionError
  );

  store.current = null;
  await assert.rejects(
    () =>
      coordinator.editor.propose({
        ownerUserId: "user-1",
        planId: "plan-1",
        conversationId: "conversation-1",
        summary: "Přidat Kutnou Horu.",
        edits: [{ op: "add-stop", placeId: "osm:node/1" }],
        places: [KUTNA_HORA],
        citations: []
      }),
    AiPlanProposalPlanMissingError
  );
});
