import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BasemapDefinition } from "@mapos/layer-sdk";
import {
  hasThemeTwin,
  shortHint,
  thumbHue,
  thumbKind,
  thumbSource
} from "./basemapPresentation.js";

function basemap(partial: Partial<BasemapDefinition> & { id: string }): BasemapDefinition {
  return {
    label: partial.id,
    group: "street",
    hint: "",
    kind: "vector",
    attribution: [],
    ...partial
  };
}

describe("basemap card presentation", () => {
  it("classifies the fallback fill by imagery, group and name", () => {
    assert.equal(thumbKind(basemap({ id: "esri-imagery", imagery: true })), "satellite");
    assert.equal(thumbKind(basemap({ id: "opentopomap", group: "terrain" })), "terrain");
    assert.equal(thumbKind(basemap({ id: "mapy-outdoor", group: "outdoor" })), "outdoor");
    assert.equal(thumbKind(basemap({ id: "carto-dark" })), "dark");
    assert.equal(thumbKind(basemap({ id: "carto-voyager" })), "street");
  });

  it("takes the thumbnail path by convention and lets a manifest override it", () => {
    assert.equal(thumbSource(basemap({ id: "carto-voyager" })), "/basemaps/carto-voyager.webp");
    assert.equal(
      thumbSource(basemap({ id: "google-roadmap", thumbnail: "/basemaps/google.svg" })),
      "/basemaps/google.svg"
    );
  });

  it("gives each id a stable hue inside one turn", () => {
    assert.equal(thumbHue("carto-voyager"), thumbHue("carto-voyager"));
    assert.ok(thumbHue("carto-voyager") >= 0 && thumbHue("carto-voyager") < 360);
    assert.notEqual(thumbHue("carto-voyager"), thumbHue("openfreemap-liberty"));
  });

  it("clips the hint on a word boundary", () => {
    assert.equal(shortHint("Výchozí čitelný podklad"), "Výchozí čitelný podklad");
    assert.equal(
      shortHint("Celoevropská satelitní mozaika z Copernicu, zdarma a bez klíče"),
      "Celoevropská satelitní mozaika z Copernicu,…"
    );
    assert.equal(shortHint("abcdefghij", 4), "abcd…");
  });

  it("marks the designs that follow the theme", () => {
    assert.equal(hasThemeTwin(basemap({ id: "carto-voyager", darkVariantId: "carto-dark" })), true);
    assert.equal(hasThemeTwin(basemap({ id: "carto-dark" })), false);
  });
});

it("Mapy cards use real same-origin Berlin tiles for each mapset", () => {
  for (const mapset of ["basic", "outdoor", "winter", "aerial"]) {
    const src = thumbSource(basemap({ id: `mapy-${mapset}`, proxy: { provider: "mapy", mapset } }));
    assert.ok(src.endsWith(`/mapy/tiles/${mapset}/11/1100/671`));
    assert.ok(!src.includes("apikey"));
  }
});
