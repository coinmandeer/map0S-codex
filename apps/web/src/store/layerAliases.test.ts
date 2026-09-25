import assert from "node:assert/strict";
import { test } from "node:test";
import { VANLIFE_CATEGORIES } from "@mapos/layer-sdk";
import { foldRetiredLayers, retiredLayerAlias } from "./layerAliases";

const initial = (id: string) => ({
  visible: true,
  opacity: 1,
  filters: id === "osm-poi" ? { categories: ["restaurant"] } : {}
});

test("a retired camping layer folds into the POI layer instead of drawing duplicates", () => {
  const folded = foldRetiredLayers(
    {
      "osm-poi": { visible: true, opacity: 0.8, filters: { categories: ["cafe", "camp_site"] } },
      vanlife: {
        visible: true,
        opacity: 1,
        filters: { categories: ["camp_site", "dump_station"] }
      },
      inaturalist: { visible: true, opacity: 1, filters: {} }
    },
    initial
  );
  assert.deepEqual(Object.keys(folded), ["osm-poi", "inaturalist"]);
  assert.deepEqual(folded["osm-poi"]!.filters.categories, ["cafe", "camp_site", "dump_station"]);
  assert.equal(folded["osm-poi"]!.opacity, 0.8, "the canonical layer keeps its own styling");
});

test("an untouched retired layer contributes the categories it used to draw", () => {
  const folded = foldRetiredLayers(
    { vanlife: { visible: true, opacity: 1, filters: {} } },
    initial
  );
  assert.equal(folded["osm-poi"]!.visible, true);
  assert.deepEqual(folded["osm-poi"]!.filters.categories, [...VANLIFE_CATEGORIES]);
});

test("a switched-off retired layer does not switch anything on", () => {
  const folded = foldRetiredLayers(
    {
      "osm-poi": { visible: false, opacity: 1, filters: { categories: ["cafe"] } },
      vanlife: { visible: false, opacity: 1, filters: {} }
    },
    initial
  );
  assert.equal(folded["osm-poi"]!.visible, false);
  assert.deepEqual(folded["osm-poi"]!.filters.categories, ["cafe"]);
});

test("stacks without retired ids are returned untouched", () => {
  const layers = { "osm-poi": { visible: true, opacity: 1, filters: {} } };
  assert.equal(foldRetiredLayers(layers, initial), layers);
  assert.equal(retiredLayerAlias("toString"), undefined);
});
