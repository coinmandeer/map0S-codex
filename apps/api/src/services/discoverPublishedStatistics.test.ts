import test from "node:test";
import assert from "node:assert/strict";
import { discoverStatisticsFromRows } from "./discoverPublishedStatistics.js";

test("local population and wider AROPE keep their distinct territorial meaning", () => {
  const rows = discoverStatisticsFromRows([
    {
      dataset_id: "lau-population-2024",
      value: 141018,
      geo_level: "lau",
      geo_code: "ES_43148",
      name: "Tarragona",
      period: "2024",
      same_entity: true
    },
    {
      dataset_id: "eurostat-poverty",
      value: 14.5,
      geo_level: "nuts2",
      geo_code: "CZ08",
      name: "Moravskoslezsko",
      period: "2025",
      same_entity: false
    },
    {
      dataset_id: "eurostat-poverty-country",
      value: 11,
      geo_level: "country",
      geo_code: "CZ",
      name: "Česko",
      period: "2025",
      same_entity: false
    },
    {
      dataset_id: "lau-density-2024",
      value: null,
      geo_level: "lau",
      geo_code: "ES_43148",
      name: "Tarragona",
      period: "2024",
      same_entity: true
    }
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.uncertainty, "selected-area");
  assert.equal(rows[0]?.value, 141018);
  assert.equal(rows[1]?.scope.geographicCode, "CZ08");
  assert.match(rows[1]!.uncertaintyLabel, /širší/);
  assert.equal(rows[1]?.year, 2025);
});
