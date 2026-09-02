import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LayerManifestV2, TripPlan } from "@mapos/layer-sdk";
import { legendContributions, timelineContributions } from "./footerContributions.js";

function manifest(id: string, priority?: number): LayerManifestV2 {
  return {
    schema: "mapos.layer-manifest",
    schemaVersion: "2.0.0",
    sdkRange: ">=2 <3",
    id,
    name: id,
    description: id,
    category: "weather",
    geometryKinds: ["Raster"],
    renderer: { type: "raster" },
    source: { type: "computed" },
    queryPolicy: { strategy: "viewport" },
    attribution: [],
    capabilities: ["temporal"],
    temporal: { enabled: true, timelinePriority: priority }
  };
}

function manifestWithLegend(id: string): LayerManifestV2 {
  return {
    ...manifest(id),
    legend: {
      type: "continuous",
      title: "Magnituda",
      unit: "M",
      min: 1,
      max: 7
    }
  };
}

const plan: TripPlan = {
  id: "plan-1",
  name: "Dated plan",
  departureAt: "2026-09-02T08:00:00.000Z",
  variant: "fast",
  stops: [],
  vehicle: { profile: "car" },
  visibility: "private"
};

describe("footer timeline contributions", () => {
  it("stays absent when a mode has no active temporal controller", () => {
    assert.deepEqual(
      timelineContributions({}, null, () => undefined),
      []
    );
    assert.deepEqual(
      timelineContributions({ weather: { visible: false } }, null, () => manifest("weather")),
      []
    );
  });

  it("derives active layers from manifests and orders them by priority", () => {
    const manifests = new Map([
      ["weather", manifest("weather", 20)],
      ["events", manifest("events", 10)]
    ]);
    assert.deepEqual(
      timelineContributions({ weather: { visible: true }, events: { visible: true } }, null, (id) =>
        manifests.get(id)
      ).map(({ id }) => id),
      ["layer:weather", "layer:events"]
    );
  });

  it("registers weather exactly once in the shared TimelineHost", () => {
    const result = timelineContributions({ weather: { visible: true } }, plan, () =>
      manifest("weather", 20)
    );
    assert.equal(result.filter(({ id }) => id === "layer:weather").length, 1);
    assert.equal(result.filter(({ kind }) => kind === "layer").length, 1);
    assert.equal(result.filter(({ kind }) => kind === "dated-plan").length, 1);
  });

  it("adds a dated plan but ignores an invalid or absent date", () => {
    assert.deepEqual(
      timelineContributions({}, plan, () => undefined).map(({ id }) => id),
      ["plan:plan-1"]
    );
    assert.deepEqual(
      timelineContributions({}, { ...plan, departureAt: "" }, () => undefined),
      []
    );
  });
});

describe("footer legend contributions", () => {
  it("returns legends only for active layers that declare them", () => {
    const manifests = new Map([
      ["earthquakes", manifestWithLegend("earthquakes")],
      ["plain", manifest("plain")]
    ]);
    const result = legendContributions(
      {
        earthquakes: { visible: true },
        hidden: { visible: false },
        plain: { visible: true }
      },
      (id) => manifests.get(id)
    );
    assert.deepEqual(
      result.map(({ id, title }) => ({ id, title })),
      [{ id: "legend:earthquakes", title: "Magnituda" }]
    );
  });

  it("keeps one independent contribution per active manifest legend", () => {
    const manifests = new Map([
      ["earthquakes", manifestWithLegend("earthquakes")],
      [
        "events",
        {
          ...manifestWithLegend("events"),
          legend: {
            type: "categorical" as const,
            items: [{ label: "Naplánováno", color: "#e11d48" }]
          }
        }
      ]
    ]);
    const result = legendContributions(
      { earthquakes: { visible: true }, events: { visible: true } },
      (id) => manifests.get(id)
    );
    assert.deepEqual(
      result.map(({ layerId }) => layerId),
      ["earthquakes", "events"]
    );
  });
});
