import test from "node:test";
import assert from "node:assert/strict";
import {
  CATALOG_GROUPS,
  catalogItemPatch,
  catalogItemState,
  catalogGroupState
} from "./catalogModel";

test("subgroup counts distinguish paused, mixed, full and unavailable items", () => {
  const items = CATALOG_GROUPS.find((g) => g.id === "czech-land")!.items.slice(0, 3);
  const layer = (visible: boolean) => ({ visible, opacity: 0.5, filters: {} });
  assert.equal(catalogGroupState(items, {}, () => undefined).state, false);
  const layers = { [items[0]!.id]: layer(true), [items[1]!.id]: layer(false) };
  assert.equal(catalogGroupState(items, layers, () => undefined).state, "mixed");
  const limited = catalogGroupState(items, layers, (item) =>
    item.id === items[0]!.id ? undefined : "Unavailable"
  );
  assert.equal(limited.state, true);
  assert.equal(limited.available, 1);
  assert.equal(catalogGroupState(items, {}, () => "Unavailable").available, 0);
});

test("atlas categories have stable order, unique IDs and preserve source-specific facets", () => {
  assert.deepEqual(
    CATALOG_GROUPS.filter((g) => g.id !== "mine").map((g) => g.id),
    [
      "czech-land",
      "places",
      "weather",
      "transport",
      "nature",
      "events",
      "media",
      "society",
      "space",
      "community"
    ]
  );
  const items = CATALOG_GROUPS.flatMap((g) => g.items);
  assert.equal(new Set(items.map((i) => i.id)).size, items.length);
  assert.equal(CATALOG_GROUPS.find((g) => g.id === "space")?.items[0]?.layer, "satellites");
  const layers = {
    "street-objects": {
      visible: true,
      opacity: 1,
      filters: { categories: ["power", "signs", "furniture"] }
    }
  };
  const patch = catalogItemPatch(
    {
      id: "power",
      layer: "street-objects",
      cs: "",
      en: "",
      facet: "categories",
      values: ["power"]
    },
    layers,
    false,
    true
  )!;
  assert.deepEqual(patch.categories, ["signs", "furniture"]);
  assert.equal(
    catalogItemState(
      {
        id: "signs",
        layer: "street-objects",
        cs: "",
        en: "",
        facet: "categories",
        values: ["signs"]
      },
      { "street-objects": { ...layers["street-objects"], filters: patch } }
    ).enabled,
    true
  );
});
