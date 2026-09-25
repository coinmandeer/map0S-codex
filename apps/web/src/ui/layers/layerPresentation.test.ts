import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  categoryCountLabel,
  drawerSummary,
  layerDomainColor,
  layerIcon,
  layerRowSubtitle,
  plural,
  poiCategoryIcon
} from "./layerPresentation.js";

describe("layers drawer presentation", () => {
  it("prefers the per-layer icon and falls back to the category", () => {
    assert.equal(layerIcon("earthquakes", "environment"), "volcano");
    assert.equal(layerIcon("some-new-layer", "transport"), "directions_bus");
    assert.equal(layerIcon("another", "outdoor"), "hiking");
  });

  it("returns a theme token for the domain colour so dark mode follows", () => {
    assert.equal(layerDomainColor("game"), "var(--layer-game)");
    assert.ok(layerDomainColor("routing").startsWith("var(--layer-"));
  });

  it("maps POI categories onto the icon set and never returns an unknown glyph", () => {
    assert.equal(poiCategoryIcon("castle"), "castle");
    assert.equal(poiCategoryIcon("brewery"), "sports_bar");
    assert.equal(poiCategoryIcon("not-a-category"), "place");
  });

  it("keeps the row subtitle to one line and appends only blocking facts", () => {
    assert.equal(
      layerRowSubtitle({ description: "Otřesy z globální sítě USGS, velikost podle magnitudy" }),
      "Otřesy z globální sítě USGS, velikost podle magnitudy"
    );
    assert.equal(
      layerRowSubtitle({ description: "Kempy z OSM. Druhá věta se nezobrazuje." }),
      "Kempy z OSM"
    );
    assert.equal(
      layerRowSubtitle({ description: "Park4Night místa", experimental: true, locked: true }),
      "Park4Night místa · potřebuje klíč · beta"
    );
  });

  it("summarises the drawer footer with Czech plurals", () => {
    assert.equal(
      drawerSummary({ layerCount: 0, overlayCount: 0, weatherOn: false, featureCount: 0 }),
      "Nic není zapnuté"
    );
    assert.equal(
      drawerSummary({ layerCount: 1, overlayCount: 0, weatherOn: false, featureCount: 0 }),
      "Zapnuto 1 vrstva"
    );
    assert.equal(
      drawerSummary({ layerCount: 2, overlayCount: 1, weatherOn: false, featureCount: 180 }),
      "Zapnuto 3 vrstvy · ~180 bodů ve výřezu"
    );
    assert.equal(
      drawerSummary({ layerCount: 4, overlayCount: 1, weatherOn: true, featureCount: 2 }),
      "Zapnuto 6 vrstev · ~2 body ve výřezu"
    );
  });

  it("counts a preset's categories", () => {
    assert.equal(categoryCountLabel(1), "1 kategorie");
    assert.equal(categoryCountLabel(3), "3 kategorie");
    assert.equal(categoryCountLabel(10), "10 kategorií");
  });

  it("picks the plural form by count", () => {
    assert.deepEqual(
      [1, 2, 4, 5, 11].map((n) => plural(n, "a", "b", "c")),
      ["a", "b", "b", "c", "c"]
    );
  });
});
