import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GeoFeature } from "@mapos/layer-sdk";
import {
  EVENT_DETAIL_TRACK_END,
  EVENT_TIMELINE_MAX,
  buildEventHistogram,
  dayToEventTimelinePosition,
  eventFilterPatch,
  eventRangeFromFilters,
  eventRangePresets,
  eventTimelinePositionToDay
} from "./timeline";

const BASE = new Date("2026-09-01T08:00:00.000Z");

describe("nonlinear event year timeline", () => {
  it("allocates 65% of the track to the first 90 days and round-trips key boundaries", () => {
    assert.equal(dayToEventTimelinePosition(0), 0);
    assert.equal(dayToEventTimelinePosition(90), EVENT_DETAIL_TRACK_END);
    assert.equal(dayToEventTimelinePosition(365), EVENT_TIMELINE_MAX);
    for (const day of [0, 7, 30, 90, 180, 365]) {
      assert.ok(Math.abs(eventTimelinePositionToDay(dayToEventTimelinePosition(day)) - day) <= 1);
    }
  });

  it("offers the complete preset set and round-trips URL filter dates", () => {
    assert.deepEqual(
      eventRangePresets(BASE).map((preset) => preset.id),
      ["today", "weekend", "week", "month", "three-months", "year"]
    );
    const patch = eventFilterPatch([0, 90], BASE);
    assert.deepEqual(eventRangeFromFilters(patch, BASE), [0, 90]);
  });

  it("buckets visible feature density using the same nonlinear scale", () => {
    const feature = (id: string, startsAt: string): GeoFeature => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [14.4, 50.1] },
      properties: { id, name: id, layerId: "events", startsAt }
    });
    const histogram = buildEventHistogram(
      [feature("near", "2026-09-08T08:00:00.000Z"), feature("far", "2027-08-20T08:00:00.000Z")],
      BASE,
      10
    );
    assert.equal(
      histogram.reduce((sum, count) => sum + count, 0),
      2
    );
    assert.ok(histogram.slice(0, 7).some(Boolean));
    assert.ok(histogram.slice(7).some(Boolean));
  });
});
