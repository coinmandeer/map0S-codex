import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planV1ToV2, type PlanDocumentV2, type RouteSegmentV2 } from "@mapos/layer-sdk";
import {
  longestRoutablePreview,
  routableSegmentPreviews,
  summarizePlanSegments,
  unselectedAlternativePreviews
} from "./planPresentation";

function plan(): PlanDocumentV2 {
  return planV1ToV2(
    {
      id: "partial-plan",
      name: "Partial route",
      departureAt: "2026-09-01T08:00:00.000Z",
      variant: "fast",
      stops: Array.from({ length: 5 }, (_, index) => ({
        id: `stop-${index}`,
        name: `Stop ${index}`,
        lng: 14 + index / 100,
        lat: 50,
        dwellMinutes: 0
      })),
      vehicle: { profile: "car" },
      visibility: "private"
    },
    { now: "2026-09-01T08:00:00.000Z" }
  );
}

function routed(segment: RouteSegmentV2, distanceM: number): RouteSegmentV2 {
  const alternativeId = `alternative-${segment.id}`;
  return {
    ...segment,
    status: "ready",
    alternatives: [
      {
        id: alternativeId,
        providerId: "fixture",
        profile: "car",
        preference: "fast",
        geometry: {
          type: "LineString",
          coordinates: [
            [14 + segment.order / 100, 50],
            [14 + (segment.order + 1) / 100, 50]
          ]
        },
        distanceM,
        durationS: distanceM / 10,
        warnings: []
      }
    ],
    selectedAlternativeId: alternativeId
  };
}

describe("planning partial-result presentation", () => {
  it("keeps successful segment totals when one neighbour fails", () => {
    const document = plan();
    document.segments = document.segments.map((segment, index) =>
      index === 1
        ? { ...segment, status: "failed", warnings: ["fixture failure"] }
        : routed(segment, (index + 1) * 1_000)
    );

    assert.deepEqual(summarizePlanSegments(document), {
      distanceM: 8_000,
      durationS: 800,
      ready: 3,
      failed: 1,
      stale: 0
    });
  });

  it("never joins successful geometry across a failed segment", () => {
    const document = plan();
    document.segments = document.segments.map((segment, index) =>
      index === 1 ? { ...segment, status: "failed" } : routed(segment, 1_000)
    );

    const preview = longestRoutablePreview(document);
    assert.deepEqual(preview?.coordinates, [
      [14.02, 50],
      [14.03, 50],
      [14.04, 50]
    ]);
    assert.equal(preview?.distanceM, 2_000);
    assert.deepEqual(
      routableSegmentPreviews(document).map((segment) => [segment.id, segment.order]),
      [
        [document.segments[0]!.id, 0],
        [document.segments[2]!.id, 2],
        [document.segments[3]!.id, 3]
      ]
    );
  });

  it("previews only the variants a segment was not routed with", () => {
    const document = plan();
    const first = routed(document.segments[0]!, 1_000);
    const chosen = first.alternatives[0]!;
    document.segments = [
      {
        ...first,
        alternatives: [
          chosen,
          { ...chosen, id: "variant-2", geometry: { type: "LineString", coordinates: [[14, 51]] } }
        ]
      },
      ...document.segments.slice(1).map((segment) => ({ ...segment, status: "failed" as const }))
    ];

    assert.deepEqual(unselectedAlternativePreviews(document), [
      {
        segmentId: first.id,
        alternativeId: "variant-2",
        coordinates: [[14, 51]]
      }
    ]);
  });
});
