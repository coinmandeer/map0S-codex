import assert from "node:assert/strict";
import test from "node:test";
import { OSM_POI_CATEGORIES, type Place, type DetailFieldValue } from "@mapos/layer-sdk";
import { detailProfile, orderDetailPanels, uniqueProviderFields } from "./detailProfile";

test("every category has practical facts; outdoor categories also lead with weather", () => {
  for (const [category, meta] of Object.entries(OSM_POI_CATEGORIES)) {
    const profile = detailProfile(category, "osm-poi");
    assert.equal(profile.primary[0], "prakticke");
    assert.equal(
      profile.primary.includes("pocasi"),
      ["nature", "stay", "sport"].includes(meta.group)
    );
    assert.equal(profile.primary.includes("wikipedia"), ["nature", "culture"].includes(meta.group));
  }
});

test("provider data takes precedence over a generic category for scientific records", () => {
  assert.equal(detailProfile("peak", "earthquakes").dataFirst, true);
  assert.deepEqual(detailProfile("peak", "earthquakes").primary, ["prakticke"]);
  assert.deepEqual(detailProfile("rock", "geology").primary, ["prakticke", "geologie"]);
});

test("unknown plugin sections stay available without inventing missing panels", () => {
  const panels = ["partner-facts", "pocasi", "mapillary", "prehled"].map((id) => ({ id }));
  const result = orderDetailPanels(panels, "unknown");
  assert.deepEqual(result.primary, []);
  assert.deepEqual(
    result.secondary.map((panel) => panel.id),
    ["partner-facts", "pocasi"]
  );
});

test("deduplicates contact facts but preserves different provider values and unrelated numbers", () => {
  const place = { address: "Main Street", elevationM: 42 } as Place;
  const fields = [
    { id: "address", label: "Address", value: "Main Street" },
    { id: "address", label: "Address", value: "Other Street" },
    { id: "magnitude", label: "Magnitude", value: 42 },
    { id: "copy", label: "Magnitude", value: 42 }
  ] as DetailFieldValue[];
  assert.deepEqual(
    uniqueProviderFields(fields, place).map((field) => field.id),
    ["address", "magnitude"]
  );
});
