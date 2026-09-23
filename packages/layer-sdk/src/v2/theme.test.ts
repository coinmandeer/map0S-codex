import assert from "node:assert/strict";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { THEME_V2_SCHEMA } from "./schemas.js";
import { higherIsWorse, isThemeManifestV2, type ThemeManifestV2 } from "./theme.js";

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validate = ajv.compile(THEME_V2_SCHEMA);

const CRIME: ThemeManifestV2 = {
  schema: "mapos.theme",
  schemaVersion: "2.0.0",
  id: "crime",
  name: "Kriminalita",
  icon: "local_police",
  unit: "trestných činů na 100 000 obyvatel",
  normalization: "per_100k",
  directionGoodBad: "higher-is-worse",
  sources: [
    { datasetId: "eurostat-crim-gen-reg", role: "primary" },
    { datasetId: "cz-mapakriminality", role: "detail", themeMapping: { multiplier: 1 } }
  ],
  legend: { classes: 5, method: "quantile" },
  disclosure: "Definice trestných činů se mezi státy liší."
};

test("a theme with a primary and a detail source validates", () => {
  assert.equal(validate(CRIME), true, ajv.errorsText(validate.errors));
});

test("the guard agrees with the schema on a valid manifest", () => {
  assert.equal(isThemeManifestV2(CRIME), true);
  assert.equal(isThemeManifestV2({ ...CRIME, schema: "mapos.layer-manifest" }), false);
  assert.equal(isThemeManifestV2(null), false);
});

test("a source role outside the three the renderer knows is rejected", () => {
  assert.equal(
    validate({ ...CRIME, sources: [{ datasetId: "x", role: "background" }] }),
    false,
    "an unknown role must not validate — the renderer has no branch for it"
  );
});

test("an unknown property is rejected rather than silently carried", () => {
  assert.equal(validate({ ...CRIME, colour: "red" }), false);
});

test("the id has to be a slug, because it appears in the tile URL", () => {
  assert.equal(validate({ ...CRIME, id: "Crime Theme" }), false);
  assert.equal(validate({ ...CRIME, id: "air-quality" }), true);
});

test("unit and sources are required, since a value with no unit cannot be a legend", () => {
  const { unit: _unit, ...withoutUnit } = CRIME;
  assert.equal(validate(withoutUnit), false);
  const { sources: _sources, ...withoutSources } = CRIME;
  assert.equal(validate(withoutSources), false);
});

test("a theme may have no sources yet, as long as the array is there", () => {
  assert.equal(validate({ ...CRIME, id: "air", sources: [] }), true);
});

test("class breaks need at least two bounds to describe one class", () => {
  assert.equal(validate({ ...CRIME, classBreaks: [0, 100, 500] }), true);
  assert.equal(validate({ ...CRIME, classBreaks: [0] }), false);
});

test("direction reduces to the boolean the ramp needs", () => {
  assert.equal(higherIsWorse(CRIME), true);
  assert.equal(higherIsWorse({ ...CRIME, directionGoodBad: "neutral" }), false);
  assert.equal(higherIsWorse({ ...CRIME, directionGoodBad: undefined }), false);
});
