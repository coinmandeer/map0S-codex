import assert from "node:assert/strict";
import test from "node:test";
import { setActiveLocale } from "../../i18n";
import { allLayerPlugins, getLayerManifestV2, unregisterLayer } from "../registry";
import { fillColorExpression, NO_DATA_COLOR } from "./choropleth";
import {
  formatValue,
  legendFor,
  syncThemeLayers,
  themeLayerId,
  type ThemeDetail
} from "./themeLayers";

const CRIME: ThemeDetail = {
  id: "crime",
  name: "Kriminalita",
  icon: "local_police",
  unit: "trestných činů na 100 000 obyvatel",
  higherIsWorse: true,
  disclosure: "Srovnávejte opatrně.",
  sourceCount: 1,
  period: "2023",
  periods: ["2023", "2022"],
  ready: true,
  breaks: [
    { from: 0, to: 500, color: "#ffffb2" },
    { from: 500, to: 900, color: "#fecc5c" },
    { from: 900, to: 1400, color: "#fd8d3c" },
    { from: 1400, to: 2000, color: "#f03b20" },
    { from: 2000, to: 4200, color: "#bd0026" }
  ],
  sources: [
    {
      datasetId: "eurostat-crim-gen-reg",
      name: "Policejně evidované trestné činy",
      role: "primary",
      geoLevel: "nuts3",
      attribution: "Eurostat",
      license: "CC BY 4.0",
      documentationUrl: "https://ec.europa.eu/eurostat/databrowser/view/crim_gen_reg"
    }
  ]
};

test("a ready theme becomes a registered layer in the Témata section", () => {
  const added = syncThemeLayers([CRIME]);
  assert.deepEqual(added, [themeLayerId("crime")]);

  const manifest = getLayerManifestV2(themeLayerId("crime"));
  assert.ok(manifest, "the theme layer is not in the registry");
  assert.equal(manifest!.category, "statistics");
  assert.equal(manifest!.renderer.type, "choropleth");
  assert.equal(manifest!.source.type, "vector-tiles");
  assert.match(manifest!.source.tileTemplate ?? "", /\/v2\/themes\/crime\/tiles\/\{z\}/);
  // The period has to be in the URL, or switching year would serve a cached tile of last year.
  assert.match(manifest!.source.tileTemplate ?? "", /period=2023/);
  assert.ok(allLayerPlugins().some((plugin) => plugin.manifest.id === themeLayerId("crime")));

  unregisterLayer(themeLayerId("crime"));
});

test("attribution identifies both values and geometry", () => {
  syncThemeLayers([CRIME]);
  const manifest = getLayerManifestV2(themeLayerId("crime"))!;
  assert.deepEqual(manifest.attribution, [
    {
      label: "Natural Earth · public domain",
      url: "https://www.naturalearthdata.com/about/terms-of-use/"
    },
    { label: "Eurostat", url: "https://ec.europa.eu/eurostat/databrowser/view/crim_gen_reg" }
  ]);
  unregisterLayer(themeLayerId("crime"));
});

test("a theme with no data is not registered, so no overlay draws nothing", () => {
  assert.deepEqual(syncThemeLayers([{ ...CRIME, ready: false }]), []);
  assert.equal(getLayerManifestV2(themeLayerId("crime")), undefined);
  assert.deepEqual(syncThemeLayers([{ ...CRIME, period: null }]), []);
});

test("syncing twice registers once, and a theme that stops being ready is removed", () => {
  syncThemeLayers([CRIME]);
  assert.deepEqual(syncThemeLayers([CRIME]), []);
  assert.ok(getLayerManifestV2(themeLayerId("crime")));

  syncThemeLayers([]);
  assert.equal(getLayerManifestV2(themeLayerId("crime")), undefined);
});

test("the legend is continuous, bounded by the classes, and names the no-data hatch", () => {
  const legend = legendFor(CRIME);
  assert.equal(legend.type, "continuous");
  assert.equal(legend.unit, CRIME.unit);
  assert.equal(legend.min, 0);
  assert.equal(legend.max, 4200);
  assert.equal(legend.stops?.length, 5);
  assert.equal(legend.stops?.[0]?.color, "#ffffb2");
  assert.deepEqual(
    legend.items?.map((item) => [item.label, item.color]),
    [["No data", NO_DATA_COLOR]]
  );
});

test("a theme with no classes still gets a legend that says what the hatch means", () => {
  const legend = legendFor({ ...CRIME, breaks: [] });
  assert.equal(legend.stops, undefined);
  assert.equal(legend.items?.length, 1);
});

test("the fill expression sends a missing value to the no-data colour, not the lowest class", () => {
  const expression = fillColorExpression(CRIME.breaks) as unknown[];
  assert.equal(expression[0], "case");
  assert.deepEqual(expression[1], ["==", ["get", "value"], null]);
  assert.equal(expression[2], NO_DATA_COLOR);

  const steps = expression[3] as unknown[];
  assert.equal(steps[0], "step");
  // Four stops for five classes: the first class is the step's default.
  assert.equal(steps[2], "#ffffb2");
  assert.deepEqual(steps.slice(3), [
    500,
    "#fecc5c",
    900,
    "#fd8d3c",
    1400,
    "#f03b20",
    2000,
    "#bd0026"
  ]);
});

test("with no classes everything is the no-data colour rather than an invalid expression", () => {
  assert.equal(fillColorExpression([]), NO_DATA_COLOR);
});

test("values keep a decimal only where one carries information, in the reader's language", () => {
  setActiveLocale("en");
  assert.equal(formatValue(811.42), "811");
  assert.equal(formatValue(8.14), "8.1");
  assert.match(formatValue(10900555), /^10[,\s]?900[,\s]?555$/u);

  // The same number, read by somebody who chose Czech: a comma for the decimal separator.
  setActiveLocale("cs");
  assert.equal(formatValue(8.14), "8,1");
  assert.match(formatValue(10900555), /^10\s?900\s?555$/u);
  setActiveLocale("en");
});

test("switching a source off rebuilds the layer with a tile url that excludes it", () => {
  syncThemeLayers([CRIME]);
  const before = getLayerManifestV2(themeLayerId("crime"))!.source.tileTemplate;

  const added = syncThemeLayers([{ ...CRIME, excluded: ["eurostat-crim-gen-reg"] }]);
  const after = getLayerManifestV2(themeLayerId("crime"))!.source.tileTemplate;

  assert.deepEqual(added, [themeLayerId("crime")], "the layer has to be registered again");
  assert.notEqual(after, before);
  assert.match(after!, /exclude=eurostat-crim-gen-reg/);
  unregisterLayer(themeLayerId("crime"));
});

test("an unchanged theme is left alone rather than torn down and rebuilt", () => {
  syncThemeLayers([CRIME]);
  // A rebuild on every poll would drop the source and refetch every visible tile.
  assert.deepEqual(syncThemeLayers([CRIME]), []);
  unregisterLayer(themeLayerId("crime"));
});

test("moving to another period changes the tile url, so the map follows the legend", () => {
  syncThemeLayers([CRIME]);
  syncThemeLayers([{ ...CRIME, period: "2022" }]);
  assert.match(getLayerManifestV2(themeLayerId("crime"))!.source.tileTemplate!, /period=2022/);
  unregisterLayer(themeLayerId("crime"));
});
