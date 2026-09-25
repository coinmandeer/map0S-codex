import assert from "node:assert/strict";
import test from "node:test";
import { STAT_DATASETS, statDataset } from "./statDatasets.js";

test("every dataset names a licence, an attribution and a slug provider", () => {
  for (const dataset of STAT_DATASETS) {
    assert.ok(dataset.license, `${dataset.id} has no licence`);
    assert.ok(dataset.attribution, `${dataset.id} has no attribution`);
    assert.match(dataset.providerId, /^[a-z0-9-]+$/, `${dataset.id} has a display-name provider`);
    assert.ok(dataset.unit, `${dataset.id} has no unit`);
  }
});

test("every endpoint is https and asks for a machine-readable format", () => {
  for (const dataset of STAT_DATASETS) {
    const url = new URL(dataset.endpoint);
    assert.equal(url.protocol, "https:", `${dataset.id} is not https`);
    if (dataset.providerId !== "eurostat" && dataset.providerId !== "worldbank") continue; // Native JSON endpoints and POST adapters declare their wire format in the adapter.
    assert.match(
      url.searchParams.get("format") ?? "",
      /^(JSON|json)$/,
      `${dataset.id} does not request JSON`
    );
  }
});

test("a series published per hundred thousand is not normalised a second time", () => {
  const crime = statDataset("eurostat-crim-gen-reg")!;
  assert.equal(crime.normalization, "per_100k");
  assert.equal(new URL(crime.endpoint).searchParams.get("unit"), "P_HTHAB");
});

test("road deaths are requested at the level Eurostat actually publishes them", () => {
  const accidents = statDataset("eurostat-tran-r-acci")!;
  assert.equal(accidents.geoLevel, "nuts2");
  assert.equal(new URL(accidents.endpoint).searchParams.get("geoLevel"), "nuts2");
});

test("each dataset's geo level is one geo_units knows", () => {
  const levels = new Set(["country", "nuts0", "nuts1", "nuts2", "nuts3", "lau", "adm1"]);
  for (const dataset of STAT_DATASETS) {
    assert.ok(levels.has(dataset.geoLevel), `${dataset.id} joins onto an unknown level`);
  }
});

test("ids are unique, because they are the primary key of stat_series", () => {
  const ids = STAT_DATASETS.map((dataset) => dataset.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(statDataset("nope"), undefined);
});
