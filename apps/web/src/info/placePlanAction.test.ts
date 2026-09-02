import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planV1ToV2, type TripPlan } from "@mapos/layer-sdk";
import { addPlaceToPlanDocument } from "./placePlanAction";

const legacy: TripPlan = {
  id: "plan",
  name: "Trip",
  departureAt: "2026-09-02T08:00:00Z",
  variant: "fast",
  stops: [
    { id: "start", name: "Start", lng: 14, lat: 50, dwellMinutes: 0 },
    { id: "finish", name: "Finish", lng: 15, lat: 51, dwellMinutes: 0 }
  ],
  vehicle: { profile: "car" },
  visibility: "private"
};

describe("add place to plan action", () => {
  it("inserts before the destination and retains the stable feature id", () => {
    let next = 0;
    const result = addPlaceToPlanDocument(
      planV1ToV2(legacy),
      { id: "osm:node/42", name: "Viewpoint", lng: 14.4, lat: 50.2 },
      (prefix) => `${prefix}-${++next}`
    );
    assert.deepEqual(
      result.stops.map((stop) => stop.name),
      ["Start", "Viewpoint", "Finish"]
    );
    assert.equal(result.stops[1]?.sourceFeatureId, "osm:node/42");
    assert.equal(result.revision, 2);
  });
});
