import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planV1ToV2 } from "@mapos/layer-sdk";
import { buildExternalPlanHandoffs } from "./externalHandoff";

function plan(stopCount = 20) {
  return planV1ToV2(
    {
      id: "handoff-plan",
      name: "Handoff",
      departureAt: "2026-09-01T08:00:00.000Z",
      variant: "fast",
      stops: Array.from({ length: stopCount }, (_, index) => ({
        id: `stop-${index}`,
        name: `Stop ${index}`,
        lng: 14 + index / 100,
        lat: 50 + index / 100,
        dwellMinutes: 0
      })),
      vehicle: { profile: "car" },
      visibility: "private"
    },
    { now: "2026-09-01T08:00:00.000Z" }
  );
}

describe("external plan handoff", () => {
  it("uses exact HTTPS hosts, documented coordinate order and visible point limits", () => {
    const handoffs = buildExternalPlanHandoffs(plan());
    assert.deepEqual(
      handoffs.map(({ id, includedStops }) => [id, includedStops]),
      [
        ["google", 5],
        ["mapy", 17],
        ["osm", 2]
      ]
    );

    const google = new URL(handoffs[0]!.href);
    assert.equal(google.protocol, "https:");
    assert.equal(google.hostname, "www.google.com");
    assert.equal(google.searchParams.get("origin"), "50,14");
    assert.equal(google.searchParams.get("destination"), "50.04,14.04");
    assert.equal(google.searchParams.get("waypoints")?.split("|").length, 3);

    const mapy = new URL(handoffs[1]!.href);
    assert.equal(mapy.hostname, "mapy.com");
    assert.equal(mapy.searchParams.get("start"), "14,50");
    assert.equal(mapy.searchParams.get("end"), "14.16,50.16");
    assert.equal(mapy.searchParams.get("waypoints")?.split(";").length, 15);

    const osm = new URL(handoffs[2]!.href);
    assert.equal(osm.hostname, "www.openstreetmap.org");
    assert.equal(osm.searchParams.get("route"), "50,14;50.01,14.01");
    assert.ok(handoffs.every(({ limitation: note }) => note?.includes("20 zastávek")));
  });

  it("does not claim a limit when the whole two-stop plan is transferred", () => {
    const handoffs = buildExternalPlanHandoffs(plan(2));
    assert.equal(handoffs.length, 3);
    assert.ok(handoffs.every(({ limitation: note }) => note === null));
  });
});
