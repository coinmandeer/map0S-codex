import assert from "node:assert/strict";
import test from "node:test";
import type { StatObservation } from "@mapos/adapter-sdk";
import { coverageFromObservations } from "./themeCoverage.js";

function observation(geoCode: string, period: string, value: number | null): StatObservation {
  return { geoCode, period, value };
}

test("a territory's coverage spans the first and last period that carried a value", () => {
  const rows = coverageFromObservations("crime", "eurostat-crim-gen-reg", "nuts3", [
    observation("CZ031", "2021", 640.1),
    observation("CZ031", "2023", 690.5),
    observation("CZ031", "2022", 655.0)
  ]);

  assert.equal(rows.length, 1);
  assert.deepEqual(
    { from: rows[0]!.periodFrom, to: rows[0]!.periodTo, observations: rows[0]!.observations },
    { from: "2021", to: "2023", observations: 3 }
  );
});

test("a territory listed but never measured does not count as covered", () => {
  const rows = coverageFromObservations("crime", "eurostat-crim-gen-reg", "nuts3", [
    observation("CZ031", "2022", 640.1),
    observation("CZ032", "2022", null),
    observation("CZ032", "2023", null)
  ]);

  assert.deepEqual(
    rows.map((row) => row.geoCode),
    ["CZ031"],
    "a source that names a region and reports nothing for it must not outrank one with data"
  );
});

test("periods are ordered as strings, which is why the format has to be sortable", () => {
  const rows = coverageFromObservations("population", "worldbank-sp-pop-totl", "country", [
    observation("CZ", "2019", 10),
    observation("CZ", "2009", 10),
    observation("CZ", "2020", 10)
  ]);
  assert.equal(rows[0]!.periodFrom, "2009");
  assert.equal(rows[0]!.periodTo, "2020");
});

test("theme, source and level travel with every row, since the table is keyed on all four", () => {
  const rows = coverageFromObservations(
    "population",
    "eurostat-demo-r-pjanaggr3",
    "nuts3",
    [observation("CZ031", "2023", 1)],
    0.8
  );
  assert.deepEqual(rows[0], {
    themeId: "population",
    sourceId: "eurostat-demo-r-pjanaggr3",
    geoLevel: "nuts3",
    geoCode: "CZ031",
    periodFrom: "2023",
    periodTo: "2023",
    observations: 1,
    quality: 0.8
  });
});
