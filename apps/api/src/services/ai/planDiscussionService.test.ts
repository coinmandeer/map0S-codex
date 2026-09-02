import assert from "node:assert/strict";
import test from "node:test";
import { planV1ToV2 } from "@mapos/layer-sdk";
import { projectPlanForDiscussion } from "./planDiscussionService.js";

test("plan discussion projection excludes private notes, owner identity and arbitrary metadata", () => {
  const plan = planV1ToV2(
    {
      id: "plan-discussion",
      name: "Cesta",
      departureAt: "2026-09-02T00:00:00.000Z",
      variant: "fast",
      stops: [
        { id: "a", name: "Start", lng: 14.4, lat: 50.1, dwellMinutes: 0 },
        { id: "b", name: "Cíl", lng: 13.4, lat: 49.8, dwellMinutes: 20 }
      ],
      vehicle: { profile: "car" },
      visibility: "private"
    },
    { now: "2026-09-02T00:00:00.000Z", ownerId: "owner-1" }
  );
  plan.stops[0]!.notes = "citlivá poznámka";
  plan.metadata = { secret: "never-send" };
  const projected = projectPlanForDiscussion(plan);
  const encoded = JSON.stringify(projected);
  assert.match(encoded, /Start/);
  assert.doesNotMatch(encoded, /citlivá poznámka|never-send|owner-1/);
});
