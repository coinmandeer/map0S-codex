import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { maptilerVariable, nearestFrameIndex } from "./maptiler.js";

describe("maptiler weather provider", () => {
  it("maps the supported visualizations to their MapTiler variables", () => {
    assert.equal(maptilerVariable("radar"), "radar-composite:gfs");
    assert.equal(maptilerVariable("wind"), "wind-10m:gfs");
    assert.equal(maptilerVariable("temperature"), "temperature-2m:gfs");
    assert.equal(maptilerVariable("precipitation"), "precipitation-1h:gfs");
    assert.equal(maptilerVariable("pressure"), "pressure-msl:gfs");
  });

  it("does not promise variables MapTiler does not publish", () => {
    assert.equal(maptilerVariable("clouds"), null);
    assert.equal(maptilerVariable("gusts"), null);
    assert.equal(maptilerVariable("humidity"), null);
  });

  it("picks the keyframe closest to the timeline cursor", () => {
    const frames = [1000, 2000, 3000, 4000];
    assert.equal(nearestFrameIndex(frames, 2600), 2);
    assert.equal(nearestFrameIndex(frames, 100), 0);
    assert.equal(nearestFrameIndex(frames, 99_999), 3);
    assert.equal(nearestFrameIndex([], 1000), 0);
  });
});
