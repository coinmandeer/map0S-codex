import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planV1ToV2 } from "@mapos/layer-sdk";
import {
  exportPlanGeoJson,
  exportPlanGpx,
  exportPlanKml,
  exportPlanMapOsJson
} from "./planExportService.js";

function exportablePlan() {
  const plan = planV1ToV2(
    {
      id: "export-plan",
      name: "Praha & Plzeň <výlet>",
      departureAt: "2026-09-01T08:00:00.000Z",
      variant: "fast",
      stops: [
        { id: "a", name: "Praha & okolí", lng: 14.42, lat: 50.08, dwellMinutes: 0 },
        { id: "b", name: "Plzeň", lng: 13.38, lat: 49.75, dwellMinutes: 30 }
      ],
      vehicle: { profile: "car" },
      visibility: "private"
    },
    { now: "2026-09-01T08:00:00.000Z" }
  );
  const segment = plan.segments[0]!;
  segment.status = "ready";
  segment.provider = "fixture-router";
  segment.selectedAlternativeId = "alternative-1";
  segment.alternatives = [
    {
      id: "alternative-1",
      providerId: "fixture-router",
      profile: "car",
      preference: "fast",
      geometry: {
        type: "LineString",
        coordinates: [
          [14.42, 50.08],
          [14, 50],
          [13.38, 49.75]
        ]
      },
      distanceM: 90_000,
      durationS: 4_500,
      warnings: [],
      computedAt: "2026-09-01T08:00:00.000Z"
    }
  ];
  return plan;
}

describe("deterministic plan exports", () => {
  it("exports ordered GeoJSON stops followed by selected route segments", () => {
    const plan = exportablePlan();
    const first = exportPlanGeoJson(plan);
    const second = exportPlanGeoJson(plan);
    assert.equal(first, second);
    assert.ok(first.endsWith("\n"));
    const data = JSON.parse(first) as {
      type: string;
      features: Array<{ id: string; geometry: { type: string }; properties: { order: number } }>;
    };
    assert.equal(data.type, "FeatureCollection");
    assert.deepEqual(
      data.features.map((feature) => feature.id),
      ["a", "b", plan.segments[0]!.id]
    );
    assert.equal(data.features[2]?.geometry.type, "LineString");
    assert.equal(data.features[2]?.properties.order, 0);
  });

  it("exports valid-shaped deterministic GPX with escaped text and ordered track points", () => {
    const plan = exportablePlan();
    const first = exportPlanGpx(plan);
    assert.equal(first, exportPlanGpx(plan));
    assert.match(first, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    assert.match(first, /xmlns="http:\/\/www\.topografix\.com\/GPX\/1\/1"/);
    assert.match(first, /Praha &amp; Plzeň &lt;výlet&gt;/);
    assert.match(first, /Praha &amp; okolí/);
    assert.equal((first.match(/<wpt /g) ?? []).length, 2);
    assert.equal((first.match(/<trkseg>/g) ?? []).length, 1);
    assert.equal((first.match(/<trkpt /g) ?? []).length, 3);
    assert.ok(first.indexOf('lon="14.42"') < first.indexOf('lon="13.38"'));
  });

  it("still exports all waypoints when no segment geometry is available", () => {
    const plan = exportablePlan();
    plan.segments[0]!.status = "failed";
    const gpx = exportPlanGpx(plan);
    assert.equal((gpx.match(/<wpt /g) ?? []).length, 2);
    assert.equal(gpx.includes("<trk>"), false);
    const geojson = JSON.parse(exportPlanGeoJson(plan)) as { features: unknown[] };
    assert.equal(geojson.features.length, 2);
  });

  it("exports escaped ordered KML stops and selected route lines", () => {
    const plan = exportablePlan();
    const kml = exportPlanKml(plan);
    assert.match(kml, /xmlns="http:\/\/www\.opengis\.net\/kml\/2\.2"/);
    assert.match(kml, /1\. Praha &amp; okolí/);
    assert.equal((kml.match(/<Point>/g) ?? []).length, 2);
    assert.equal((kml.match(/<LineString>/g) ?? []).length, 1);
    assert.match(kml, /14\.42,50\.08,0 14,50,0 13\.38,49\.75,0/);
  });

  it("exports a lossless MapOS JSON document", () => {
    const plan = exportablePlan();
    assert.deepEqual(JSON.parse(exportPlanMapOsJson(plan)), plan);
  });
});
