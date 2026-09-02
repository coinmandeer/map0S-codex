import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { filterPatchChanges, nearestRadarFrame, weatherTimelinePatch } from "./timeline.js";

describe("weather TimelineHost contribution", () => {
  const now = Date.parse("2026-09-01T12:00:00.000Z");
  const frames = [
    Date.parse("2026-09-01T09:00:00.000Z") / 1000,
    Date.parse("2026-09-01T10:00:00.000Z") / 1000
  ];

  it("selects one nearest archived radar frame and leaves live radar unpinned", () => {
    assert.equal(nearestRadarFrame(Date.parse("2026-09-01T09:40:00.000Z"), frames, now), frames[1]);
    assert.equal(nearestRadarFrame(Date.parse("2026-09-01T11:45:00.000Z"), frames, now), null);
  });

  it("does not attach radar frames to forecast variables", () => {
    assert.deepEqual(
      weatherTimelinePatch(
        { visualization: "temperature" },
        "2026-09-01T09:40:00.000Z",
        frames,
        now
      ),
      { at: "2026-09-01T09:40:00.000Z", frameTs: null }
    );
  });

  it("detects no-op synchronization so the timeline cannot trigger a layer refresh loop", () => {
    const patch = { at: "2026-09-01T09:00:00.000Z", frameTs: frames[0] };
    assert.equal(filterPatchChanges(patch, patch), false);
    assert.equal(filterPatchChanges({}, patch), true);
  });
});
