import assert from "node:assert/strict";
import { it } from "node:test";
import { planV1ToV2, assertPlanDocumentV2 } from "@mapos/layer-sdk";
import { memoryPlanDocumentRepository } from "./planDocumentMemoryRepository.js";
it("one-point collecting drafts are local and cannot be persisted", async () => {
  const base = planV1ToV2({
    id: "draft",
    name: "Draft",
    departureAt: new Date().toISOString(),
    variant: "fast",
    vehicle: { profile: "car" },
    visibility: "private",
    stops: [
      { id: "a", name: "A", lng: 14, lat: 50, dwellMinutes: 0 },
      { id: "b", name: "B", lng: 15, lat: 51, dwellMinutes: 0 }
    ]
  });
  const plan = {
    ...base,
    stops: base.stops.slice(0, 1),
    segments: [],
    metadata: { "dev.mapos.collectingStops": true }
  };
  assertPlanDocumentV2(plan);
  await assert.rejects(
    () => memoryPlanDocumentRepository.create("test-owner", plan),
    /Před uložením/
  );
});
