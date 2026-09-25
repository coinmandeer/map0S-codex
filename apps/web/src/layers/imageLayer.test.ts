import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type maplibregl from "maplibre-gl";
import { createImageLayer } from "./imageLayer";

interface AddedSource {
  url?: string;
  coordinates?: [number, number][];
  attribution?: string;
}

/** Just enough of MapLibre's layer/source bookkeeping to observe what the handle does. */
function fakeMap() {
  const sources = new Map<string, AddedSource>();
  const layers = new Map<string, { beforeId?: string; layout: Record<string, unknown> }>();

  const map = {
    getStyle: () => ({
      layers: [
        { id: "base-fill", type: "fill" },
        { id: "labels", type: "symbol" }
      ]
    }),
    getSource: (id: string) => sources.get(id),
    getLayer: (id: string) => layers.get(id),
    addSource: (id: string, src: AddedSource) => {
      sources.set(id, src);
    },
    addLayer: (spec: { id: string; layout?: Record<string, unknown> }, beforeId?: string) => {
      layers.set(spec.id, { beforeId, layout: spec.layout ?? {} });
    },
    removeLayer: (id: string) => layers.delete(id),
    removeSource: (id: string) => sources.delete(id),
    setLayoutProperty: (id: string, key: string, value: unknown) => {
      const l = layers.get(id);
      if (l) l.layout[key] = value;
    }
  } as unknown as maplibregl.Map;

  return { map, sources, layers };
}

const BOUNDS = [12, 48, 19, 51] as [number, number, number, number];

function setup() {
  const fake = fakeMap();
  const handle = createImageLayer(fake.map, "funny", {
    url: "/layers/funny.png",
    bounds: BOUNDS,
    attribution: "CC-BY test"
  });
  return {
    ...fake,
    update: () => handle.update(BOUNDS, {}),
    setVisible: (next: boolean) => handle.setVisible(next),
    setOpacity: (next: number) => handle.setOpacity(next),
    detach: () => handle.detach()
  };
}

describe("image layer factory", () => {
  it("draws one image between the four corners of its bounds, clockwise from the top-left", async () => {
    const s = setup();
    await s.update();

    const source = s.sources.get("source-image-funny");
    assert.equal(source?.url, "/layers/funny.png");
    assert.deepEqual(source?.coordinates, [
      [12, 51],
      [19, 51],
      [19, 48],
      [12, 48]
    ]);
    assert.equal(s.layers.get("image-funny")?.beforeId, "labels");
  });

  it("hides and shows through layout visibility without touching the source", async () => {
    const s = setup();
    await s.update();
    const before = s.sources.size;

    s.setVisible(false);
    assert.equal(s.layers.get("image-funny")?.layout.visibility, "none");
    s.setVisible(true);
    assert.equal(s.layers.get("image-funny")?.layout.visibility, "visible");
    assert.equal(s.sources.size, before);
  });

  it("detach removes the layer and the source", async () => {
    const s = setup();
    await s.update();
    s.detach();

    assert.equal(s.layers.has("image-funny"), false);
    assert.equal(s.sources.has("source-image-funny"), false);
  });
});
