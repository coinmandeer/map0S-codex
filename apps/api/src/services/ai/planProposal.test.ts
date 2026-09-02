import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planV1ToV2, type PlanDocumentV2 } from "@mapos/layer-sdk";
import {
  AiPlanProposalNotFoundError,
  AiPlanProposalRevisionError,
  AiPlanProposalStateError,
  AiPlanProposalStore
} from "./planProposal.js";

function plan(): PlanDocumentV2 {
  return planV1ToV2(
    {
      id: "plan-1",
      name: "Výlet",
      departureAt: "2026-09-01T08:00:00.000Z",
      variant: "fast",
      stops: [
        { id: "a", name: "A", lng: 14, lat: 50, dwellMinutes: 0 },
        { id: "b", name: "B", lng: 15, lat: 49, dwellMinutes: 0 },
        { id: "c", name: "C", lng: 16, lat: 48, dwellMinutes: 0 }
      ],
      vehicle: { profile: "car" },
      visibility: "private"
    },
    { now: "2026-09-01T08:00:00.000Z", ownerId: "user-1" }
  );
}

describe("AI plan proposal confirmation boundary", () => {
  it("creates a cited diff preview without mutating the plan", () => {
    const input = plan();
    const before = structuredClone(input);
    const store = new AiPlanProposalStore(
      () => new Date("2026-09-01T09:00:00.000Z"),
      () => "proposal-1"
    );
    const proposal = store.create({
      ownerUserId: "user-1",
      plan: input,
      command: { type: "move-stop", stopId: "c", toIndex: 1 },
      summary: "Přesunout zastávku C před B.",
      conversationId: "conversation-1",
      citations: [
        { sourceId: "route-1", label: "Výsledek trasování", url: "https://example.test/route" },
        { sourceId: "route-1", label: "Duplikát se nepřenese" }
      ]
    });

    assert.deepEqual(input, before);
    assert.equal(proposal.status, "draft");
    assert.equal(proposal.baseRevision, 1);
    assert.deepEqual(proposal.diff.movedStopIds.sort(), ["b", "c"]);
    assert.equal(proposal.citations.length, 1);
  });

  it("applies only after owner confirmation of the exact revision and supports one undo", () => {
    let time = "2026-09-01T09:00:00.000Z";
    const store = new AiPlanProposalStore(
      () => new Date(time),
      () => "proposal-2"
    );
    const current = plan();
    const proposal = store.create({
      ownerUserId: "user-1",
      plan: current,
      command: { type: "update-plan", patch: { name: "AI návrh" } },
      summary: "Přejmenovat plán."
    });

    time = "2026-09-01T09:01:00.000Z";
    const confirmed = store.confirm("user-1", proposal.id, current);
    assert.equal(confirmed.plan.name, "AI návrh");
    assert.equal(confirmed.plan.revision, 2);
    assert.equal(confirmed.proposal.status, "confirmed");

    time = "2026-09-01T09:02:00.000Z";
    const undone = store.undo("user-1", proposal.id, confirmed.plan);
    assert.equal(undone.plan.name, "Výlet");
    assert.equal(undone.plan.revision, 3);
    assert.equal(undone.proposal.status, "undone");
    assert.throws(() => store.undo("user-1", proposal.id, undone.plan), AiPlanProposalStateError);
  });

  it("refuses stale, rejected and expired proposals", () => {
    let now = new Date("2026-09-01T09:00:00.000Z");
    let sequence = 0;
    const store = new AiPlanProposalStore(
      () => now,
      () => `proposal-${++sequence}`
    );
    const current = plan();
    const stale = store.create({
      ownerUserId: "user-1",
      plan: current,
      command: { type: "update-plan", patch: { name: "A" } },
      summary: "A"
    });
    const changed = structuredClone(current);
    changed.revision += 1;
    assert.throws(() => store.confirm("user-1", stale.id, changed), AiPlanProposalRevisionError);

    const rejected = store.create({
      ownerUserId: "user-1",
      plan: current,
      command: { type: "update-plan", patch: { name: "B" } },
      summary: "B"
    });
    store.reject("user-1", rejected.id);
    assert.throws(() => store.confirm("user-1", rejected.id, current), AiPlanProposalStateError);

    const expiring = store.create({
      ownerUserId: "user-1",
      plan: current,
      command: { type: "update-plan", patch: { name: "C" } },
      summary: "C",
      ttlMs: 1_000
    });
    now = new Date("2026-09-01T09:00:01.000Z");
    assert.equal(store.get("user-1", expiring.id).status, "expired");
    assert.throws(() => store.confirm("user-1", expiring.id, current), AiPlanProposalStateError);
  });

  it("does not reveal another owner's proposal", () => {
    const store = new AiPlanProposalStore(
      () => new Date("2026-09-01T09:00:00.000Z"),
      () => "proposal-private"
    );
    const proposal = store.create({
      ownerUserId: "user-1",
      plan: plan(),
      command: { type: "update-plan", patch: { name: "Soukromé" } },
      summary: "Soukromá změna"
    });
    assert.throws(() => store.get("user-2", proposal.id), AiPlanProposalNotFoundError);
  });

  it("rejects malformed JSON and fields that could escape the command scope", () => {
    let sequence = 0;
    const store = new AiPlanProposalStore(
      () => new Date("2026-09-01T09:00:00.000Z"),
      () => `proposal-invalid-${++sequence}`
    );
    assert.throws(() =>
      store.create({
        ownerUserId: "user-1",
        plan: plan(),
        command: "not-json",
        summary: "Neplatné"
      })
    );
    assert.throws(() =>
      store.create({
        ownerUserId: "user-1",
        plan: plan(),
        command: {
          type: "update-plan",
          patch: { ownerId: "attacker", id: "other-plan", revision: 999 }
        },
        summary: "Pokus o překročení oprávnění"
      })
    );
  });
});
