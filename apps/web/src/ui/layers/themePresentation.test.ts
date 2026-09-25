import assert from "node:assert/strict";
import test from "node:test";
import { rankLabel, sparklinePoints } from "./ThemeValueCard";
import { shareLabel } from "./ThemesSection";

test("a source's line says the level, the years and the share of the view", () => {
  assert.equal(
    shareLabel({
      datasetId: "eurostat-crim-gen-reg",
      name: "Trestné činy",
      role: "primary",
      geoLevel: "nuts3",
      attribution: "Eurostat",
      license: "CC BY 4.0",
      documentationUrl: "https://example.test",
      share: 0.923,
      periodFrom: "2014",
      periodTo: "2023",
      units: 12
    }),
    "NUTS3 · 2014–2023 · covers 92% of the view"
  );
});

test("a single year is not written as a range", () => {
  const label = shareLabel({
    datasetId: "x",
    name: "x",
    role: "detail",
    geoLevel: "country",
    attribution: "x",
    license: "x",
    documentationUrl: "x",
    share: 0.5,
    periodFrom: "2023",
    periodTo: "2023",
    units: 1
  });
  assert.equal(label, "COUNTRY · 2023 · covers 50% of the view");
});

test("a source with no coverage says so instead of showing 0 %", () => {
  const label = shareLabel({
    datasetId: "x",
    name: "x",
    role: "detail",
    geoLevel: "nuts3",
    attribution: "x",
    license: "x",
    documentationUrl: "x",
    share: null,
    periodFrom: null,
    periodTo: null,
    units: 0
  });
  assert.equal(label, "does not cover this view");
});

const DETAIL = {
  themeId: "crime",
  code: "CZ031",
  name: "Jihočeský kraj",
  geoLevel: "nuts3",
  unit: "trestných činů na 100 000 obyvatel",
  period: "2023",
  value: 690.5,
  rank: 3,
  of: 14,
  series: [],
  source: { datasetId: "eurostat-crim-gen-reg", name: "Trestné činy", attribution: "Eurostat" }
};

test("the rank is phrased as a standing, not as a bare number", () => {
  assert.equal(rankLabel(DETAIL), "no. 3 of 14 · 2023");
});

test("a territory with no value gets the period alone rather than a made-up rank", () => {
  assert.equal(rankLabel({ ...DETAIL, value: null, rank: null }), "Period 2023");
  assert.equal(rankLabel({ ...DETAIL, of: 0 }), "Period 2023");
});

test("the sparkline spans the box and puts the highest year at the top", () => {
  const points = sparklinePoints([
    { period: "2021", value: 10 },
    { period: "2022", value: 30 },
    { period: "2023", value: 20 }
  ])
    .split(" ")
    .map((pair) => pair.split(",").map(Number) as [number, number]);

  assert.deepEqual(
    points.map(([x]) => x),
    [0, 50, 100]
  );
  assert.equal(points[1]![1], 2, "the maximum sits at the top of the 28-unit box");
  assert.equal(points[0]![1], 26, "the minimum sits at the bottom");
});

test("gaps in the series are skipped rather than drawn as zero", () => {
  const points = sparklinePoints([
    { period: "2021", value: 10 },
    { period: "2022", value: null },
    { period: "2023", value: 20 }
  ]);
  assert.equal(points.split(" ").length, 2);
});

test("a flat series is a flat line down the middle, not a division by zero", () => {
  assert.equal(
    sparklinePoints([
      { period: "2022", value: 5 },
      { period: "2023", value: 5 }
    ]),
    "0.0,14.0 100.0,14.0"
  );
});

test("fewer than two measured points cannot be a line", () => {
  assert.equal(sparklinePoints([{ period: "2023", value: 5 }]), "");
  assert.equal(sparklinePoints([]), "");
});
