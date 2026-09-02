import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type maplibregl from "maplibre-gl";
import type { LayerSpecification } from "maplibre-gl";
import { apply3dBuildings, BUILDINGS_LAYER_ID, supports3dBuildings } from "./buildings3d";

/**
 * The end-to-end suite serves stub tiles, so no real vector style ever loads there and the
 * extrusion layer never gets a source to attach to. What matters about this module — that it finds
 * the building polygons whatever the provider calls their source, and stays out of the way when
 * there are none — is decided from the style object alone, which is what these exercise.
 */

/** Background layers have no source, so the union type doesn't expose one. */
const sourceOf = (layer: LayerSpecification) => (layer as { source?: string }).source;

/** A fake with just the four style methods this module touches. */
function fakeMap(layers: LayerSpecification[]) {
  const style = [...layers];
  const added: { layer: LayerSpecification; before?: string }[] = [];
  const map = {
    getStyle: () => ({ layers: style }),
    getLayer: (id: string) => style.find((l) => l.id === id),
    removeLayer: (id: string) => {
      const at = style.findIndex((l) => l.id === id);
      if (at >= 0) style.splice(at, 1);
    },
    addLayer: (layer: LayerSpecification, before?: string) => {
      added.push({ layer, before });
      style.push(layer);
    }
  } as unknown as maplibregl.Map;
  return { map, added, style };
}

const vectorStyle = [
  { id: "bg", type: "background" },
  // The source name differs between providers — OpenFreeMap says "openmaptiles", CARTO "carto".
  { id: "building-fill", type: "fill", source: "carto", "source-layer": "building" },
  { id: "road-label", type: "symbol", source: "carto", "source-layer": "transportation_name" }
] as unknown as LayerSpecification[];

const rasterStyle = [
  { id: "background", type: "background" },
  { id: "basemap-raster", type: "raster", source: "basemap" }
] as unknown as LayerSpecification[];

describe("3D buildings", () => {
  it("finds the building polygons by what they carry, not by the source's name", () => {
    assert.equal(supports3dBuildings(fakeMap(vectorStyle).map), true);
    assert.equal(supports3dBuildings(fakeMap(rasterStyle).map), false);
  });

  it("draws the blocks under the labels so street names stay readable", () => {
    const { map, added } = fakeMap(vectorStyle);
    apply3dBuildings(map, true);

    assert.equal(added.length, 1);
    assert.equal(added[0]!.layer.type, "fill-extrusion");
    assert.equal(sourceOf(added[0]!.layer), "carto");
    assert.equal(added[0]!.before, "road-label");
  });

  it("does nothing on a background that has no geometry to extrude", () => {
    const { map, added } = fakeMap(rasterStyle);
    apply3dBuildings(map, true);
    assert.equal(added.length, 0);
  });

  it("can be called on every style load without stacking layers", () => {
    const { map, added } = fakeMap(vectorStyle);
    apply3dBuildings(map, true);
    apply3dBuildings(map, true);
    assert.equal(added.length, 1);
  });

  it("takes the layer away again when switched off, and tolerates being off already", () => {
    const { map, style } = fakeMap(vectorStyle);
    apply3dBuildings(map, true);
    apply3dBuildings(map, false);
    assert.equal(
      style.some((l) => l.id === BUILDINGS_LAYER_ID),
      false
    );
    apply3dBuildings(map, false);
  });

  it("never mistakes its own layer for the source of the buildings", () => {
    // The extrusion layer carries `source-layer: building` too, so a second pass over a style that
    // already contains it must not treat it as the thing to copy.
    const { map, added } = fakeMap(vectorStyle);
    apply3dBuildings(map, true);
    apply3dBuildings(map, false);
    apply3dBuildings(map, true);
    assert.equal(sourceOf(added.at(-1)!.layer), "carto");
  });
});
