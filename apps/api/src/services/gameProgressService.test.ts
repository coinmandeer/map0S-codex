import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { __testing } from "./gameProgressService.js";

describe("orb progress validation", () => {
  const userId = "player-1";

  it("accepts and deduplicates deterministic orb ids owned by the player", () => {
    const id = `orb:${userId}:14.12345,50.12345`;
    assert.deepEqual(__testing.normalizeOrbIds(userId, [id, id]), [id]);
  });

  it("accepts daily ids tied to a fixed kilometre cell", () => {
    const id = `orb:${userId}:2026-08-28:5574x1028:14.12345,50.12345`;
    assert.deepEqual(__testing.normalizeOrbIds(userId, [id]), [id]);
  });

  it("refuses another player's orb and impossible coordinates", () => {
    assert.throws(
      () => __testing.normalizeOrbIds(userId, ["orb:player-2:14.12345,50.12345"]),
      /Invalid orb id/
    );
    assert.throws(
      () => __testing.normalizeOrbIds(userId, [`orb:${userId}:214.00000,50.00000`]),
      /Invalid orb id/
    );
    assert.throws(
      () =>
        __testing.normalizeOrbIds(userId, [`orb:${userId}:tomorrow:5574x1028:14.00000,50.00000`]),
      /Invalid orb id/
    );
  });

  it("caps a local migration before it becomes an unbounded write", () => {
    assert.throws(
      () =>
        __testing.normalizeOrbIds(
          userId,
          Array.from(
            { length: __testing.MAX_SYNC_ORBS + 1 },
            (_, i) => `orb:${userId}:${(i / 100_000).toFixed(5)},50.00000`
          )
        ),
      /Too many/
    );
  });
});
