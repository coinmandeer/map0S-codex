import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { StyleSpecification } from "maplibre-gl";
import { availableBasemaps, usesMapyTiles } from "@mapos/layer-sdk";
import { overlayForBasemap, resolveBasemap, styleForBasemap } from "./basemapStyle";

const ctx = {
  theme: "light" as const,
  apiBase: "/api",
  labels: true,
  capabilities: { mapy: true } as Record<string, boolean | string>
};

function inline(style: string | StyleSpecification): StyleSpecification {
  assert.equal(typeof style, "object", "expected an inline style, got a style URL");
  return style as StyleSpecification;
}

describe("basemap style", () => {
  it("hands a keyless vector background straight to MapLibre as a URL", () => {
    const style = styleForBasemap(resolveBasemap("carto-voyager", "light"), ctx);
    assert.equal(style, "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json");
  });

  it("follows the dark theme to a background's dark twin", () => {
    assert.equal(resolveBasemap("carto-voyager", "dark").id, "carto-dark");
    // A background with no twin stays put rather than falling back to some default dark map.
    assert.equal(resolveBasemap("mapy-outdoor", "dark").id, "mapy-outdoor");
  });

  it("routes keyed tiles through the proxy, never exposing a key in the URL", () => {
    const style = inline(styleForBasemap(resolveBasemap("mapy-outdoor", "light"), ctx));
    const source = style.sources.basemap as { tiles: string[] };
    assert.equal(source.tiles[0], "/api/basemap/mapy/outdoor/{z}/{x}/{y}?retina=1");
    assert.ok(!JSON.stringify(style).includes("apikey"));
  });

  it("stacks labels over imagery and leaves drawn maps alone", () => {
    const aerial = inline(styleForBasemap(resolveBasemap("mapy-aerial", "light"), ctx));
    assert.ok(aerial.sources.labels, "imagery should get a label overlay");
    assert.equal(aerial.layers.at(-1)?.id, "basemap-labels");

    const drawn = resolveBasemap("mapy-basic", "light");
    assert.equal(overlayForBasemap(drawn, ctx), null);
  });

  it("drops the label overlay when the user switched labels off", () => {
    const style = inline(
      styleForBasemap(resolveBasemap("mapy-aerial", "light"), { ...ctx, labels: false })
    );
    assert.equal(style.sources.labels, undefined);
  });

  it("labels imagery with its own provider's names where there are any", () => {
    // Mapy's labels are drawn for Mapy's photos; everyone else gets the global CARTO set.
    assert.equal(overlayForBasemap(resolveBasemap("mapy-aerial", "light"), ctx)?.id, "mapy-names");
    assert.equal(
      overlayForBasemap(resolveBasemap("esri-imagery", "light"), ctx)?.id,
      "carto-labels"
    );
  });

  it("falls back to keyless labels when Mapy has no key", () => {
    const noKey = { ...ctx, capabilities: { mapy: false } };
    const overlay = overlayForBasemap(resolveBasemap("mapy-aerial", "light"), noKey);
    assert.equal(overlay?.id, "carto-labels");
  });

  it("counts Mapy as shown when only the labels are theirs", () => {
    const aerial = resolveBasemap("mapy-aerial", "light");
    assert.equal(usesMapyTiles(aerial.id, overlayForBasemap(aerial, ctx)), true);
    assert.equal(usesMapyTiles("esri-imagery", null), false);
    assert.equal(
      usesMapyTiles("esri-imagery", { id: "mapy-names", label: "", attribution: [] }),
      true
    );
  });

  it("hides backgrounds whose key the server doesn't hold", () => {
    const ids = availableBasemaps({ mapy: false }).map((b) => b.id);
    assert.ok(!ids.includes("mapy-outdoor"));
    assert.ok(!ids.includes("google-satellite"));
    // Keyless ones are always there, which is what makes a fresh clone render a map.
    assert.ok(ids.includes("carto-voyager"));
    assert.ok(ids.includes("eox-s2cloudless"));
  });

  it("leaves imagery unfiltered in dark mode but dims drawn maps", () => {
    const dark = { ...ctx, theme: "dark" as const };
    const aerial = inline(styleForBasemap(resolveBasemap("mapy-aerial", "dark"), dark));
    const paintOf = (style: StyleSpecification) =>
      (
        style.layers.find((l) => l.id === "basemap-raster") as unknown as {
          paint: Record<string, unknown>;
        }
      ).paint;

    assert.deepEqual(paintOf(aerial), {});
    const basic = inline(styleForBasemap(resolveBasemap("mapy-basic", "dark"), dark));
    assert.ok(paintOf(basic)["raster-brightness-max"]);
  });
});
