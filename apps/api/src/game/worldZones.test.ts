import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AnchoredQuest } from "./anchors.js";
import { composeGameZones, deriveWorldZones, normalizeWorldZone } from "./worldZones.js";

const bbox = [14.4, 50.05, 14.5, 50.12] as const;
const now = new Date("2026-08-28T10:15:00Z");
const anchor: AnchoredQuest = {
  id: "anchor-osm~abc",
  title: "Navštiv muzeum",
  description: "Dojdi na místo",
  rewardPoints: 20,
  lng: 14.44,
  lat: 50.08,
  kind: "visit",
  radiusM: 150,
  sourceId: "osm",
  anchorRef: "osm:1",
  anchorName: "Muzeum"
};

describe("QuestLayer-style world zones", () => {
  it("always exposes all three gameplay types with stable daily ids", () => {
    const zones = deriveWorldZones([anchor], [...bbox], now);
    assert.deepEqual(
      zones.map((zone) => zone.zoneKind),
      ["standard", "event", "staker_gate"]
    );
    assert.ok(zones.every((zone) => zone.id.includes("2026-08-28")));
    assert.deepEqual(zones, deriveWorldZones([anchor], [...bbox], now));
  });

  it("marks bounded zones active, scheduled, or expired from server time", () => {
    const base = { id: "z", name: "Zóna", lng: 14.44, lat: 50.08, radiusM: 180 };
    assert.equal(
      normalizeWorldZone(
        { ...base, activeFrom: "2026-08-28T09:00:00Z", activeUntil: "2026-08-28T11:00:00Z" },
        now
      ).lifecycle,
      "active"
    );
    assert.equal(
      normalizeWorldZone({ ...base, activeFrom: "2026-08-28T12:00:00Z" }, now).lifecycle,
      "scheduled"
    );
    assert.equal(
      normalizeWorldZone({ ...base, activeUntil: "2026-08-28T09:00:00Z" }, now).lifecycle,
      "expired"
    );
  });

  it("drops expired and out-of-view curated zones while retaining upcoming ones", () => {
    const zones = composeGameZones(
      [
        {
          id: "past",
          name: "Past",
          lng: 14.44,
          lat: 50.08,
          radiusM: 100,
          activeUntil: "2026-08-28T09:00:00Z"
        },
        {
          id: "next",
          name: "Next",
          lng: 14.44,
          lat: 50.08,
          radiusM: 100,
          activeFrom: "2026-08-28T12:00:00Z"
        },
        { id: "far", name: "Far", lng: 13, lat: 49, radiusM: 100 }
      ],
      [],
      [...bbox],
      now
    );
    assert.ok(zones.some((zone) => zone.id === "next" && zone.lifecycle === "scheduled"));
    assert.equal(
      zones.some((zone) => zone.id === "past" || zone.id === "far"),
      false
    );
  });
});
