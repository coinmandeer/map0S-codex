import assert from "node:assert/strict";
import test from "node:test";
// This synthetic geometry fixture exercises the explicitly enabled regional profile.
process.env.MAPOS_ALLOW_NONCOMMERCIAL_DATA = "1";
import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";
import { fixtureThemeQueries } from "./themeFixtures.js";
import { themeTile } from "./themeService.js";

/** The offline tile is only useful if it decodes to what the choropleth reads, so the test
 *  decodes it rather than checking that some bytes came back. */
function decode(tile: Uint8Array) {
  return new VectorTile(new Pbf(tile));
}

test("the offline tile carries a units layer whose features hold code, name and value", async () => {
  const tile = await themeTile("crime", 7, 69, 44, "2023", fixtureThemeQueries);
  assert.ok(tile, "no tile for a viewport the fixture covers");

  const decoded = decode(tile!);
  const layer = decoded.layers.units;
  assert.ok(layer, `expected a "units" layer, got ${Object.keys(decoded.layers).join(", ")}`);
  assert.ok(layer!.length > 0);

  const properties = layer!.feature(0).properties;
  assert.ok(typeof properties.code === "string");
  assert.ok(typeof properties.name === "string");
  assert.equal(properties.period, "2023");
  assert.equal(typeof properties.value, "number");
});

test("the value follows the requested period", async () => {
  const read = async (period: string) => {
    const tile = await themeTile("crime", 7, 69, 44, period, fixtureThemeQueries);
    const layer = decode(tile!).layers.units!;
    const values = new Map<string, unknown>();
    for (let index = 0; index < layer.length; index += 1) {
      const feature = layer.feature(index);
      values.set(String(feature.properties.code), feature.properties.value);
    }
    return values;
  };
  const of2022 = await read("2022");
  const of2023 = await read("2023");
  // 7/69/44 covers the Jihočeský box, so that is the row whose value has to move with the year.
  assert.equal(of2022.get("CZ031"), 640.1);
  assert.equal(of2023.get("CZ031"), 690.5);
});

test("a tile outside the fixture territories is nothing rather than an empty layer", async () => {
  // Somewhere in the Pacific at the same zoom.
  assert.equal(await themeTile("crime", 7, 10, 60, "2023", fixtureThemeQueries), null);
});

test("zooming out switches the fixture to the level that zoom draws", async () => {
  const country = await themeTile("population", 2, 2, 1, "2023", fixtureThemeQueries);
  const layer = decode(country!).layers.units!;
  assert.equal(layer.feature(0).properties.level, "country");
  assert.equal(layer.feature(0).properties.code, "CZ");
});

test("fixture quantiles come back as six ordered bounds", async () => {
  const cuts = await fixtureThemeQueries.quantiles("eurostat-crim-gen-reg", "2023");
  assert.equal(cuts.length, 6);
  assert.deepEqual(
    cuts,
    [...cuts].sort((a, b) => a - b)
  );
});
