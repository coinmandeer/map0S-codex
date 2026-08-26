import assert from "node:assert/strict";
import { test } from "node:test";
import { keywordsFor, labelMatchesCategory, isMapySearchable } from "./mapyKeywords.js";
import { langsForBbox, isoForBbox } from "./euCountries.js";

test("keywords are localized and budget-capped", () => {
  assert.deepEqual(keywordsFor("castle", "cs"), ["hrad", "zámek", "tvrz"]);
  assert.ok(keywordsFor("castle", "de").includes("Burg"));
  assert.ok(keywordsFor("viewpoint", "fr").includes("point de vue"));
  for (const lang of ["cs", "de", "en", "pl"] as const) {
    assert.ok(keywordsFor("castle", lang).length <= 3);
  }
});

test("countries without a Mapy locale get English plus local hints", () => {
  const hu = keywordsFor("castle", "en", "HU");
  assert.ok(hu.includes("vár"), "Hungarian endonym must lead the English fallback");
  assert.ok(hu.length <= 3);
});

test("category labels accept real places and reject same-keyword noise", () => {
  // Every pair below was observed in a live api.mapy.com response.
  assert.ok(labelMatchesCategory("Hrad", "castle", "cs"));
  assert.ok(labelMatchesCategory("Zámek", "castle", "cs"));
  assert.ok(labelMatchesCategory("Chateau", "castle", "en"));
  assert.ok(labelMatchesCategory("Castle", "castle", "en"));
  assert.ok(labelMatchesCategory("Rozhledna", "viewpoint", "cs"));
  assert.ok(labelMatchesCategory("Hora, výškový bod", "peak", "cs"));
  assert.ok(labelMatchesCategory("Muzeum v přírodě, skanzen", "museum", "cs"));

  assert.equal(labelMatchesCategory("Nákladní doprava", "castle", "cs"), false);
  assert.equal(labelMatchesCategory("Dětské hřiště", "castle", "cs"), false);
  assert.equal(labelMatchesCategory("Zastávka tramvaje", "museum", "cs"), false);
  assert.equal(labelMatchesCategory("Gemeindezentrum", "castle", "de"), false);
  assert.equal(labelMatchesCategory("Bürgerhaus", "castle", "de"), false);
  assert.equal(labelMatchesCategory("Prodejní galerie", "museum", "cs"), false);
  assert.equal(labelMatchesCategory("Festung, Bunker", "castle", "de"), false);
});

test("unnamed amenities are not name-searchable", () => {
  assert.equal(isMapySearchable("parking"), false);
  assert.equal(isMapySearchable("drinking_water"), false);
  assert.equal(isMapySearchable("castle"), true);
});

test("viewport language follows the country under the bbox centroid", () => {
  assert.deepEqual(langsForBbox([14.3, 50.0, 14.5, 50.15]), ["cs"]);
  assert.equal(isoForBbox([14.3, 50.0, 14.5, 50.15]), "CZ");
  assert.deepEqual(langsForBbox([2.2, 48.8, 2.4, 48.9]), ["fr"]);
  // Mid-Atlantic: nothing matches, and guessing beats failing.
  assert.deepEqual(langsForBbox([-30, 40, -28, 42]), ["en"]);
});
