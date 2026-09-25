import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { advance, liveViewports } from "./liveTraffic";
import { getLayerManifestV2, getLayerPlugin } from "../registry";
import "./liveTraffic";
import { MATERIAL_ICON_PATHS } from "../../map/materialIcons";

it("ships renderable silhouettes for both live vehicle layers", () => {
  assert.ok(MATERIAL_ICON_PATHS.flight?.startsWith("M"));
  assert.ok(MATERIAL_ICON_PATHS.directions_boat?.startsWith("M"));
});

describe("live traffic interpolation", () => {
  it("advances a fix along its heading instead of treating it as a new measurement", () => {
    const north = advance(14.42, 50.08, 0, 1000);
    assert.ok(north.lat > 50.08, "heading 0 moves north");
    assert.ok(Math.abs(north.lng - 14.42) < 1e-6);

    const east = advance(14.42, 50.08, 90, 1000);
    assert.ok(east.lng > 14.42, "heading 90 moves east");

    // One kilometre is about 0.009° of latitude anywhere.
    assert.ok(Math.abs(north.lat - 50.08 - 1000 / 111_195) < 0.0002);
  });

  it("does nothing without a usable heading or distance", () => {
    assert.deepEqual(advance(14.42, 50.08, Number.NaN, 1000), { lng: 14.42, lat: 50.08 });
    assert.deepEqual(advance(14.42, 50.08, 90, 0), { lng: 14.42, lat: 50.08 });
  });
});

describe("live traffic layers", () => {
  it("registers aircraft and vessels with their sources declared", () => {
    for (const id of ["live-aircraft", "live-vessels"]) {
      const plugin = getLayerPlugin(id);
      assert.ok(plugin, `${id} must be registered`);
      assert.equal(plugin.manifest.id, id);
      assert.equal(plugin.manifest.category, "transport");
      assert.ok(plugin.attribution?.length, `${id} must name its source`);
      const manifest = getLayerManifestV2(id);
      assert.ok(manifest?.detail?.fieldOrder?.length, `${id} must declare detail fields`);
    }
    const aircraft = getLayerPlugin("live-aircraft");
    assert.equal(aircraft?.attribution?.[0]?.label, "ADSB.lol");
    const vessels = getLayerPlugin("live-vessels");
    assert.deepEqual(
      vessels?.attribution?.map((entry) => entry.label),
      ["AISstream", "Digitraffic (Fintraffic)"],
      "the vessel layer must be honest about both possible sources"
    );
  });
});

it("preserves both sides of the antimeridian and wrapped worlds", () => {
  assert.deepEqual(liveViewports(170, -10, 190, 10), [
    [170, -10, 180, 10],
    [-180, -10, -170, 10]
  ]);
  assert.deepEqual(liveViewports(374, 49, 375, 51), [[14, 49, 15, 51]]);
  assert.deepEqual(liveViewports(-200, -90, 200, 90), [[-180, -85, 180, 85]]);
});
