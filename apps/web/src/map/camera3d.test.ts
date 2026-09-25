import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type maplibregl from "maplibre-gl";
import {
  BUILDINGS_PITCH,
  TERRAIN_PITCH,
  is3dActive,
  set3dInteraction,
  target3dPitch
} from "./camera3d";
import { applyTerrain3d, HILLSHADE_SOURCE_ID, TERRAIN_SOURCE_ID } from "./terrain3d";
import { buildingPaint } from "./buildings3d";

describe("3D camera", () => {
  it("keeps the steepest pitch any active 3D feature asks for", () => {
    const flat = { buildings3d: false, terrain3d: false, canExtrude: true };
    assert.equal(target3dPitch(flat), 0);
    assert.equal(target3dPitch({ ...flat, terrain3d: true }), TERRAIN_PITCH);
    assert.equal(target3dPitch({ ...flat, buildings3d: true }), BUILDINGS_PITCH);
    // Turning buildings off while terrain stays on must not flatten the camera.
    assert.equal(
      target3dPitch({ buildings3d: true, terrain3d: true, canExtrude: true }),
      BUILDINGS_PITCH
    );
    assert.equal(target3dPitch({ buildings3d: false, terrain3d: true, canExtrude: true }), 45);
  });

  it("does not count buildings over a background that cannot extrude", () => {
    const raster = { buildings3d: true, terrain3d: false, canExtrude: false };
    assert.equal(is3dActive(raster), false);
    assert.equal(target3dPitch(raster), 0);
    assert.equal(is3dActive({ ...raster, terrain3d: true }), true);
  });

  it("enables rotation and tilt gestures only while 3D is on", () => {
    const calls: string[] = [];
    const handler = (name: string) => ({
      enable: () => calls.push(`${name}:on`),
      disable: () => calls.push(`${name}:off`),
      enableRotation: () => calls.push(`${name}:rot-on`),
      disableRotation: () => calls.push(`${name}:rot-off`)
    });
    const map = {
      dragRotate: handler("drag"),
      touchPitch: handler("pitch"),
      touchZoomRotate: handler("touch"),
      keyboard: handler("keys")
    } as unknown as maplibregl.Map;
    set3dInteraction(map, true);
    assert.deepEqual(calls, ["drag:on", "pitch:on", "touch:rot-on", "keys:rot-on"]);
    calls.length = 0;
    set3dInteraction(map, false);
    assert.deepEqual(calls, ["drag:off", "pitch:off", "touch:rot-off", "keys:rot-off"]);
  });
});

describe("terrain", () => {
  it("gives the terrain mesh and the hillshade separate DEM sources", () => {
    const sources = new Map<string, unknown>();
    const layers: Array<{ id: string; source?: string }> = [];
    let terrain: { source: string } | null = null;
    const map = {
      getSource: (id: string) => sources.get(id),
      addSource: (id: string, spec: unknown) => sources.set(id, spec),
      removeSource: (id: string) => sources.delete(id),
      getLayer: (id: string) => layers.find((l) => l.id === id),
      addLayer: (layer: { id: string; source?: string }) => layers.push(layer),
      removeLayer: (id: string) =>
        layers.splice(
          layers.findIndex((l) => l.id === id),
          1
        ),
      getStyle: () => ({ layers }),
      setTerrain: (value: { source: string } | null) => (terrain = value),
      getTerrain: () => terrain
    } as unknown as maplibregl.Map;
    applyTerrain3d(map, true);
    assert.equal(terrain!.source, TERRAIN_SOURCE_ID);
    assert.equal(layers[0]!.source, HILLSHADE_SOURCE_ID);
    assert.ok(sources.has(TERRAIN_SOURCE_ID) && sources.has(HILLSHADE_SOURCE_ID));
    applyTerrain3d(map, false);
    assert.equal(sources.size, 0);
    assert.equal(layers.length, 0);
  });
});

describe("building colours", () => {
  it("follow the theme instead of one light stone on a dark map", () => {
    const light = JSON.stringify(buildingPaint("light")?.["fill-extrusion-color"]);
    const dark = JSON.stringify(buildingPaint("dark")?.["fill-extrusion-color"]);
    assert.notEqual(light, dark);
    assert.match(dark, /#2b3140/);
  });
});
