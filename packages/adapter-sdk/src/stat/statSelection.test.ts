import test from "node:test";
import assert from "node:assert/strict";
import { parseStatDataset, statDataset } from "./statDatasets.js";
import { sliceStatCube } from "./nationalStatistics.js";
test("World Bank retains global economies and excludes aggregate regions", () => {
  const result = parseStatDataset(statDataset("worldbank-sp-pop-totl")!, [
    { pages: 1 },
    ["CZ", "US", "BR", "IN", "ZA", "AU", "NA", "EU", "1W"].map((id) => ({
      country: { id, value: id },
      date: "2024",
      value: 10
    }))
  ]);
  assert.deepEqual(
    result.observations.map((r) => r.geoCode),
    ["CZ", "US", "BR", "IN", "ZA", "AU", "NA"]
  );
});
const cube = {
  id: ["iccs", "geo", "time"],
  size: [2, 1, 2],
  dimension: {
    iccs: { category: { index: { ICCS0101: 0, ICCS0401: 1 } } },
    geo: { category: { index: { CZ010: 0 } } },
    time: { category: { index: { 2022: 0, 2023: 1 } } }
  },
  value: [0, null, 10, 20],
  status: { 1: "c" }
};
test("unselected crime categories are rejected instead of overwriting one territory", () => {
  assert.throws(
    () => parseStatDataset(statDataset("eurostat-crim-gen-reg")!, cube),
    /ambiguous dimension iccs/
  );
});
test("explicit cube slice preserves zeros and confidentiality", () => {
  const slice = sliceStatCube(cube, { iccs: "ICCS0101" });
  const parsed = parseStatDataset(statDataset("eurostat-crim-gen-reg")!, slice);
  assert.deepEqual(parsed.observations, [
    { geoCode: "CZ010", period: "2022", value: 0 },
    { geoCode: "CZ010", period: "2023", value: null, flag: "c" }
  ]);
});
test("a provider returning a different selected metric is rejected", () => {
  assert.throws(
    () =>
      parseStatDataset(
        statDataset("eurostat-crim-gen-reg")!,
        sliceStatCube(cube, { iccs: "ICCS0401" })
      ),
    /unexpected category/
  );
});
test("country code conversion does not conceal duplicates", () => {
  const d = statDataset("eurostat-gdp-country")!;
  assert.throws(
    () =>
      parseStatDataset(d, {
        id: ["geo", "time"],
        size: [2, 1],
        dimension: {
          geo: { category: { index: { EL: 0, GR: 1 } } },
          time: { category: { index: { 2020: 0 } } }
        },
        value: [1, 2]
      }),
    /duplicate observation/
  );
});
test("incomplete World Bank pages cannot publish a partial release", () => {
  assert.throws(
    () => parseStatDataset(statDataset("worldbank-sp-pop-totl")!, [{ pages: 2 }, []]),
    /pagination/
  );
});
