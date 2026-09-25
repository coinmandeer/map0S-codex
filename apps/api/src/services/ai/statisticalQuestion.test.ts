import test from "node:test";
import assert from "node:assert/strict";
import { statDataset } from "@mapos/adapter-sdk";
import { parseStatisticalQuestion, formatStatisticalAnswer } from "./statisticalQuestion.js";

test("Czech poverty question owns its geography and ignores unrelated earlier countries", () => {
  assert.deepEqual(
    parseStatisticalQuestion("kde je největší chudoba v ČR", ["Co je ve Španělsku?"]),
    { themeId: "poverty", country: "CZ", period: undefined, lowest: false }
  );
  assert.equal(parseStatisticalQuestion("poverty in Czech Republic")?.country, "CZ");
});

test("worldwide statistical questions preserve sourced geometry, missing data and units", () => {
  assert.equal(parseStatisticalQuestion("Internet users in Brazil")?.country, "BR");
  const geometry = {
    type: "Polygon",
    coordinates: [
      [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 0]
      ]
    ]
  };
  const answer = formatStatisticalAnswer(
    { themeId: "poverty", country: "CZ", lowest: false },
    {
      countryName: "Česko",
      bbox: [12, 48, 19, 51],
      dataset: statDataset("eurostat-poverty"),
      period: "2024",
      expected: 2,
      rows: [{ code: "CZ01", name: "Region", value: 0 }],
      regions: [
        { code: "CZ01", name: "Region", value: 0, geometry, boundarySource: "gisco" },
        { code: "CZ02", name: "Bez dat", value: null, geometry, boundarySource: "gisco" }
      ]
    }
  );
  const artifact = answer.mapResults![0]!;
  assert.equal(artifact.data.features[0]!.properties.value, 0);
  assert.equal(artifact.data.features[1]!.properties.value, null);
  assert.equal(artifact.legend?.unit, "%");
  assert.equal(artifact.legend?.time, "2024");
  assert.ok(artifact.sources.some((s) => s.id === "boundary:gisco"));
});
test("short follow-ups inherit country, explicit country replaces it, unknown city never borrows it", () => {
  const history = ["kde je nejvetsi chudoba v CR"];
  assert.equal(parseStatisticalQuestion("A nezaměstnanost?", history)?.country, "CZ");
  assert.equal(parseStatisticalQuestion("A ve Španělsku?", history)?.country, "ES");
  assert.equal(parseStatisticalQuestion("A ve Španělsku?", history)?.themeId, "poverty");
  assert.equal(parseStatisticalQuestion("Chudoba v Praze", history)?.country, undefined);
  assert.equal(parseStatisticalQuestion("kolik tu žije obyvatel", history), null);
  assert.equal(parseStatisticalQuestion("kde jsem"), null);
});
test("ranking uses one measured series, sorted values, source and date, not user's position", () => {
  const result = formatStatisticalAnswer(
    { themeId: "poverty", country: "CZ", lowest: false },
    {
      countryName: "Česko",
      bbox: [12, 48, 19, 51],
      dataset: statDataset("eurostat-poverty"),
      period: "2024",
      expected: 8,
      rows: [
        { code: "CZ01", name: "Praha", value: 10 },
        { code: "CZ08", name: "Moravskoslezsko", value: 20 }
      ]
    }
  );
  assert.match(result.text, /Moravskoslezsko: 20 % \(2024\)/);
  assert.match(result.text, /2 z 8/);
  assert.match(result.text, /AROPE/);
  assert.doesNotMatch(result.text, /Jsi v/);
  assert.equal(result.cards[0]?.type, "statistic");
  const map = result.cards.find((c) => c.type === "statistic");
  assert(map?.excludedDatasetIds.includes("eurostat-poverty-country"));
  assert.equal(map?.period, "2024");
  assert.equal(result.sources.length, 1);
});
test("one national observation cannot answer internal inequality; no-data never becomes zero", () => {
  const data = {
    countryName: "Česko",
    bbox: [12, 48, 19, 51] as [number, number, number, number],
    expected: 1,
    dataset: statDataset("eurostat-poverty-country"),
    period: "2025",
    rows: [{ code: "CZ", name: "Česko", value: 11.5 }]
  };
  assert.match(
    formatStatisticalAnswer({ themeId: "poverty", country: "CZ", lowest: false }, data).text,
    /nelze z ní určit/
  );
  const empty = formatStatisticalAnswer(
    { themeId: "poverty", country: "CZ", period: "1999", lowest: false },
    { ...data, dataset: undefined, period: undefined, rows: [] }
  );
  assert.match(empty.text, /1999/);
  assert.doesNotMatch(empty.text, /0 %/);
  assert.equal(empty.cards.find((c) => c.type === "statistic")?.available, false);
});

test("follow-up chain carries requested year and stops inheriting after a different topic", () => {
  const history = ["chudoba v ČR 2024", "A nezaměstnanost?"];
  assert.deepEqual(parseStatisticalQuestion("A ve Španělsku?", history), {
    themeId: "unemployment",
    country: "ES",
    period: "2024",
    lowest: false
  });
  assert.equal(
    parseStatisticalQuestion("A chudoba?", [...history, "Kde je blízká restaurace?"])?.country,
    undefined
  );
  assert.equal(parseStatisticalQuestion("chudoba v České Lípě")?.country, undefined);
});
