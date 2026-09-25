/**
 * Themes in offline mode.
 *
 * The offline server has no PostGIS, so it cannot run `ST_AsMVT`. It encodes the same vector
 * tile in JavaScript instead, from a handful of fixture territories — which means the client
 * path being exercised in the tests is the real one: same URL, same content type, same
 * `units` layer, same `value` attribute the choropleth colours by.
 *
 * The fixture geometry is deliberately coarse. It exists so a tile has polygons in it at the
 * zooms the audit captures, not to be a map of anywhere.
 */

import geojsonvt from "geojson-vt";
import vtpbf from "vt-pbf";
import { statDataset } from "@mapos/adapter-sdk";
import { fixtureTableSeries } from "./tableFixtures.js";
import { THEMES } from "./themeRegistry.js";
import type { ThemeQueries, ThemeTileRequest } from "./themeService.js";

interface FixtureUnit {
  level: string;
  code: string;
  name: string;
  /** Value per period, for whichever dataset answers at this unit's level. */
  values: Record<string, number>;
  /** Values per period for one named dataset, where two datasets answer at the same level.
   *  Air quality and population are both published per country, and 10.9 million µg/m³ of
   *  PM2.5 would be a memorable fixture for the wrong reason. */
  perDataset?: Record<string, Record<string, number>>;
  /** Bounding box, drawn as a rectangle: [west, south, east, north]. */
  bbox: [number, number, number, number];
}

/** Four boxes over central Europe, roughly where the regions they are named after are. */
const UNITS: readonly FixtureUnit[] = [
  {
    level: "nuts3",
    code: "CZ032",
    name: "Plzeňský kraj",
    values: { "2022": 811.4, "2023": 795.2 },
    bbox: [12.1, 49.1, 13.9, 50.1]
  },
  {
    level: "nuts3",
    code: "CZ031",
    name: "Jihočeský kraj",
    values: { "2022": 640.1, "2023": 690.5 },
    bbox: [13.9, 48.6, 15.3, 49.6]
  },
  {
    level: "nuts3",
    code: "CZ010",
    name: "Praha",
    values: { "2022": 2410.8, "2023": 2290.3 },
    bbox: [14.2, 49.9, 14.7, 50.2]
  },
  {
    level: "nuts2",
    code: "CZ03",
    name: "Jihozápad",
    values: { "2022": 121, "2023": 108 },
    bbox: [12.1, 48.6, 15.3, 50.1]
  },
  {
    level: "country",
    code: "CZ",
    name: "Česko",
    values: { "2022": 10_827_529, "2023": 10_900_555 },
    perDataset: { "eurostat-sdg-11-50": { "2022": 15.6, "2023": 14.2 } },
    bbox: [12.1, 48.5, 18.9, 51.1]
  },
  // Two more countries so the country level has a distribution rather than a single value: a
  // choropleth with one territory in it has no classes and therefore no legend.
  {
    level: "country",
    code: "SK",
    name: "Slovensko",
    values: { "2022": 5_434_712, "2023": 5_428_792 },
    perDataset: { "eurostat-sdg-11-50": { "2022": 18.1, "2023": 17.4 } },
    bbox: [16.8, 47.7, 22.6, 49.6]
  },
  {
    level: "country",
    code: "AT",
    name: "Rakousko",
    values: { "2022": 9_041_851, "2023": 9_158_750 },
    perDataset: { "eurostat-sdg-11-50": { "2022": 11.3, "2023": 10.4 } },
    bbox: [9.5, 46.4, 17.2, 49.0]
  }
];

const PERIODS = ["2022", "2023"];

/** The value a named dataset reports for a territory, falling back to the level's own value. */
function unitValue(unit: FixtureUnit, datasetId: string, period: string): number | null {
  return unit.perDataset?.[datasetId]?.[period] ?? unit.values[period] ?? null;
}

function rectangle(bbox: readonly [number, number, number, number]) {
  const [west, south, east, north] = bbox;
  return [
    [
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south]
    ]
  ];
}

/** A user's imported table, keyed by territory code, or null when this is a theme dataset. */
function tableValues(datasetId: string): Map<string, number | null> | null {
  const stored = fixtureTableSeries(datasetId);
  if (!datasetId.startsWith("table:") || !stored) return null;
  return new Map(stored.observations.map((entry) => [entry.geoCode, entry.value]));
}

function collectionFor(request: ThemeTileRequest) {
  const table = tableValues(request.datasetId);
  return {
    type: "FeatureCollection",
    features: UNITS.filter((unit) => unit.level === request.geoLevel).map((unit) => ({
      type: "Feature",
      properties: {
        code: unit.code,
        name: unit.name,
        level: unit.level,
        value: table
          ? (table.get(unit.code) ?? null)
          : unitValue(unit, request.datasetId, request.period),
        period: request.period,
        datasetId: request.datasetId
      },
      geometry: { type: "Polygon", coordinates: rectangle(unit.bbox) }
    }))
  };
}

export const fixtureThemeQueries: ThemeQueries = {
  async periods(datasetIds) {
    const tables = datasetIds
      .map((id) => fixtureTableSeries(id))
      .filter((stored): stored is NonNullable<typeof stored> => Boolean(stored));
    if (tables.length) return [...new Set(tables.map((stored) => stored.period))].sort();
    return datasetIds.some((id) => statDataset(id)) ? [...PERIODS] : [];
  },

  async quantiles(datasetId, period) {
    const table = tableValues(datasetId);
    const values = table
      ? [...table.values()].filter((value): value is number => typeof value === "number")
      : UNITS.map((unit) => unitValue(unit, datasetId, period)).filter(
          (value): value is number => typeof value === "number"
        );
    if (!values.length) return [];
    const sorted = [...values].sort((a, b) => a - b);
    const at = (fraction: number) =>
      sorted[Math.min(sorted.length - 1, Math.floor(fraction * (sorted.length - 1)))]!;
    return [sorted[0]!, at(0.2), at(0.4), at(0.6), at(0.8), sorted[sorted.length - 1]!];
  },

  async tile(request) {
    const collection = collectionFor(request);
    if (!collection.features.length) return null;
    const index = geojsonvt(collection, { maxZoom: 14, extent: 4096, buffer: 64 });
    const tile = index.getTile(request.z, request.x, request.y);
    if (!tile || !tile.features.length) return null;
    return vtpbf.fromGeojsonVt({ units: tile }, { version: 2 });
  },

  async coverage(themeId, bbox) {
    const extent = area(bbox);
    return THEMES.filter((entry) => entry.id === themeId)
      .flatMap((entry) => entry.sources)
      .flatMap((source) => {
        const dataset = statDataset(source.datasetId);
        if (!dataset) return [];
        const covered = UNITS.filter(
          (unit) => unit.level === dataset.geoLevel && overlap(unit.bbox, bbox) > 0
        );
        if (!covered.length) return [];
        const periods = covered
          .flatMap((unit) => Object.keys(unit.perDataset?.[dataset.id] ?? unit.values))
          .sort();
        return [
          {
            sourceId: dataset.id,
            geoLevel: dataset.geoLevel,
            periodFrom: periods[0] ?? null,
            periodTo: periods[periods.length - 1] ?? null,
            units: covered.length,
            share: Math.min(
              1,
              covered.reduce((sum, unit) => sum + overlap(unit.bbox, bbox), 0) / (extent || 1)
            )
          }
        ];
      });
  },

  async unit({ datasetId, geoLevel, geoCode, period }) {
    const found = UNITS.find((entry) => entry.level === geoLevel && entry.code === geoCode);
    if (!found) return null;
    const inPeriod = UNITS.filter((entry) => entry.level === geoLevel)
      .map((entry) => unitValue(entry, datasetId, period))
      .filter((value): value is number => typeof value === "number")
      .sort((a, b) => b - a);
    const value = unitValue(found, datasetId, period);
    return {
      name: found.name,
      value,
      rank: value === null ? null : inPeriod.indexOf(value) + 1,
      of: inPeriod.length,
      series: PERIODS.map((entry) => ({
        period: entry,
        value: unitValue(found, datasetId, entry)
      }))
    };
  },

  async hasGeoUnits() {
    return true;
  }
};

function area(box: readonly [number, number, number, number]): number {
  return Math.max(0, box[2] - box[0]) * Math.max(0, box[3] - box[1]);
}

/** Rectangle intersection in degrees: enough for a share, and the fixtures are rectangles. */
function overlap(
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number]
): number {
  return area([
    Math.max(a[0], b[0]),
    Math.max(a[1], b[1]),
    Math.min(a[2], b[2]),
    Math.min(a[3], b[3])
  ]);
}
