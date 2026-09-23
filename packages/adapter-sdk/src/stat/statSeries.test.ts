import assert from "node:assert/strict";
import test from "node:test";
import { parseJsonStat, parseSdmxJson, parseStatSeries, parseWorldBank } from "./statSeries.js";

/**
 * Eurostat shape, trimmed to two territories and two years. `size` is `[1, 1, 2, 2]` over
 * `[freq, unit, geo, time]`, so the flat keys are: 0 = CZ/2022, 1 = CZ/2023, 2 = AT/2022,
 * 3 = AT/2023. Those four numbers are the whole reason this test exists.
 */
const JSON_STAT = {
  version: "2.0",
  class: "dataset",
  label: "Police-recorded offences by NUTS 3 region",
  id: ["freq", "unit", "geo", "time"],
  size: [1, 1, 2, 2],
  dimension: {
    freq: { category: { index: { A: 0 } } },
    unit: { category: { index: { P_HTHAB: 0 }, label: { P_HTHAB: "Per hundred thousand" } } },
    geo: {
      category: {
        index: { CZ032: 0, AT127: 1 },
        label: { CZ032: "Plzeňský kraj", AT127: "Wiener Umland" }
      }
    },
    time: { category: { index: { "2022": 0, "2023": 1 } } }
  },
  value: { 0: 811.4, 1: 795, 2: 1204.7, 3: null },
  status: { 3: ":", 1: "p" }
};

test("JSON-stat flat keys land on the right territory and year", () => {
  const result = parseJsonStat(JSON_STAT);
  assert.deepEqual(
    result.observations.map((o) => [o.geoCode, o.period, o.value]),
    [
      ["CZ032", "2022", 811.4],
      ["CZ032", "2023", 795],
      ["AT127", "2022", 1204.7],
      ["AT127", "2023", null]
    ]
  );
});

test("JSON-stat carries labels, periods, unit and a provisional flag", () => {
  const result = parseJsonStat(JSON_STAT);
  assert.equal(result.geoLabels.CZ032, "Plzeňský kraj");
  assert.deepEqual(result.periods, ["2022", "2023"]);
  assert.equal(result.unit, "Per hundred thousand");
  assert.equal(result.label, "Police-recorded offences by NUTS 3 region");
  const provisional = result.observations.find((o) => o.period === "2023" && o.geoCode === "CZ032");
  assert.equal(provisional?.flag, "p");
  // ":" means "not available", which is the absence of a flag rather than a flag of its own.
  const missing = result.observations.find((o) => o.geoCode === "AT127" && o.period === "2023");
  assert.equal(missing?.flag, undefined);
});

test("JSON-stat with a category index as an array is read positionally", () => {
  const result = parseJsonStat({
    id: ["geo", "time"],
    size: [2, 1],
    dimension: {
      geo: { category: { index: ["DE", "FR"] } },
      time: { category: { index: ["2020"] } }
    },
    value: { 0: 1, 1: 2 }
  });
  assert.deepEqual(
    result.observations.map((o) => [o.geoCode, o.value]),
    [
      ["DE", 1],
      ["FR", 2]
    ]
  );
});

test("JSON-stat without a geo or time dimension yields nothing rather than guessing", () => {
  const result = parseJsonStat({
    id: ["unit", "nace"],
    size: [1, 1],
    dimension: {
      unit: { category: { index: { EUR: 0 } } },
      nace: { category: { index: { A: 0 } } }
    },
    value: { 0: 5 }
  });
  assert.deepEqual(result.observations, []);
});

test("SDMX-JSON splits the key between series and observation", () => {
  const result = parseSdmxJson({
    structure: {
      name: "Regional accounts",
      dimensions: {
        series: [
          { id: "MEASURE", values: [{ id: "GDP" }] },
          {
            id: "REF_AREA",
            values: [
              { id: "CZE", name: "Czechia" },
              { id: "AUT", name: "Austria" }
            ]
          }
        ],
        observation: [{ id: "TIME_PERIOD", values: [{ id: "2021" }, { id: "2022" }] }]
      }
    },
    dataSets: [
      {
        series: {
          "0:0": { observations: { 0: [42.1], 1: [43.9] } },
          "0:1": { observations: { 1: [51.2] } }
        }
      }
    ]
  });
  assert.deepEqual(
    result.observations.map((o) => [o.geoCode, o.period, o.value]),
    [
      ["CZE", "2021", 42.1],
      ["CZE", "2022", 43.9],
      ["AUT", "2022", 51.2]
    ]
  );
  assert.equal(result.geoLabels.AUT, "Austria");
});

test("World Bank rows keep the two-letter code and fall back to ISO-3 for aggregates", () => {
  const result = parseWorldBank([
    { page: 1, pages: 1 },
    [
      {
        indicator: { id: "SP.POP.TOTL", value: "Population, total" },
        country: { id: "CZ", value: "Czechia" },
        countryiso3code: "CZE",
        date: "2023",
        value: 10900000
      },
      {
        indicator: { id: "SP.POP.TOTL", value: "Population, total" },
        country: { value: "European Union" },
        countryiso3code: "EUU",
        date: "2023",
        value: 448000000
      },
      {
        indicator: { id: "SP.POP.TOTL" },
        country: { id: "SK", value: "Slovakia" },
        date: "2023",
        value: null
      }
    ]
  ]);
  assert.deepEqual(
    result.observations.map((o) => [o.geoCode, o.value]),
    [
      ["CZ", 10900000],
      ["EUU", 448000000],
      ["SK", null]
    ]
  );
  assert.equal(result.label, "Population, total");
});

test("the format is recognised from the payload, not declared by the caller", () => {
  assert.equal(parseStatSeries(JSON_STAT).observations.length, 4);
  assert.equal(parseStatSeries([{ page: 1 }, []]).observations.length, 0);
  assert.deepEqual(parseStatSeries({ nothing: true }).observations, []);
  assert.deepEqual(parseStatSeries(null).observations, []);
});
