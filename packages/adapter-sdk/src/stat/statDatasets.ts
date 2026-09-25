import { WORLD_BANK_COUNTRY_CODES } from "./worldBankCountries.js";
/**
 * The statistical series MapOS imports, and how each one is addressed.
 *
 * The rule from §23.4 is visible in the shape of this list: a dataset is looked for at
 * Eurostat / OECD / World Bank level first, and a national source is added only where it makes
 * the picture finer rather than merely different. So a theme's *primary* series covers a
 * continent at one resolution, and everything national arrives later as detail.
 *
 * `geoLevel` is the join key into `geo_units`, and it is per dataset rather than per theme
 * because Eurostat publishes crime at NUTS 3 and road deaths at NUTS 2 — the same theme can be
 * drawn at two resolutions depending on which series answers for a territory.
 */

import {
  NATIONAL_STATISTICS,
  parseNationalStatistics,
  sliceStatCube
} from "./nationalStatistics.js";
import { parseMunicipalPopulation } from "./municipalPopulation.js";
import { EUROPEAN_INDICATORS } from "./statIndicators.js";
import type { StatSeriesParseResult } from "./statSeries.js";
import { parseStatSeries } from "./statSeries.js";

export type StatNormalization = "raw" | "per_100k" | "per_km2" | "percent";

export interface StatDatasetDescriptor {
  id: string;
  name: string;
  /** Stable slug for rate limiting; never a display name. */
  providerId: string;
  /** Matches `geo_units.level`. */
  geoLevel: "country" | "nuts0" | "nuts1" | "nuts2" | "nuts3" | "lau" | "adm1";
  unit: string;
  normalization: StatNormalization;
  /** Lets a theme pick the colour direction without a table of special cases. */
  higherIsWorse: boolean;
  license: string;
  attribution: string;
  /** The page a human should read, not the endpoint. */
  documentationUrl: string;
  /** The request the importer makes. */
  endpoint: string;
  themeId?: string;
  group?: string;
  nameCs?: string;
  /** All non-geographic/time dimensions must resolve to one member. */
  dimensions?: Record<string, string>;
  geographyDimension?: string;
  timeDimension?: string;
  format?: "json-stat" | "worldbank" | "normalized";
  boundaryEdition?: string;
  commercialUse?: boolean;
  nationalAdapter?: "pxweb" | "gus" | "cbs" | "ine" | "statbank" | "ep-turnout";
  metric?: string;
  sliceDimensions?: boolean;
  requestSelection?: Record<string, string[]>;
  codeMap?: Record<string, string>;
}

const EUROSTAT = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data";
const EUROSTAT_LICENSE = "CC BY 4.0 (Eurostat re-use policy)";

const LEGACY_STAT_DATASETS: readonly StatDatasetDescriptor[] = [
  {
    id: "eurostat-crim-gen-reg",
    name: "Intentional homicide",
    providerId: "eurostat",
    geoLevel: "nuts3",
    boundaryEdition: "2024",
    unit: "per 100 000 people",
    // Eurostat already publishes this per hundred thousand, so nothing is recomputed here —
    // normalising a normalised series is how a crime rate becomes nonsense.
    normalization: "per_100k",
    higherIsWorse: true,
    license: EUROSTAT_LICENSE,
    attribution: "Eurostat",
    documentationUrl: "https://ec.europa.eu/eurostat/databrowser/view/crim_gen_reg",
    endpoint: `${EUROSTAT}/crim_gen_reg?format=JSON&lang=EN&geoLevel=nuts3&unit=P_HTHAB&iccs=ICCS0101`,
    dimensions: { iccs: "ICCS0101" }
  },
  {
    id: "eurostat-tran-r-acci",
    name: "Road traffic deaths",
    providerId: "eurostat",
    // NUTS 2, not 3: this is where Eurostat publishes it, and pretending otherwise would join
    // onto codes that do not exist.
    geoLevel: "nuts2",
    boundaryEdition: "2024",
    unit: "people",
    normalization: "raw",
    higherIsWorse: true,
    license: EUROSTAT_LICENSE,
    attribution: "Eurostat",
    documentationUrl: "https://ec.europa.eu/eurostat/databrowser/view/tran_r_acci",
    endpoint: `${EUROSTAT}/tran_r_acci?format=JSON&lang=EN&geoLevel=nuts2&unit=NR&victim=KIL`
  },
  {
    id: "eurostat-demo-r-pjanaggr3",
    name: "Population",
    providerId: "eurostat",
    geoLevel: "nuts3",
    boundaryEdition: "2024",
    unit: "people",
    normalization: "raw",
    higherIsWorse: false,
    license: EUROSTAT_LICENSE,
    attribution: "Eurostat",
    documentationUrl: "https://ec.europa.eu/eurostat/databrowser/view/demo_r_pjanaggr3",
    endpoint: `${EUROSTAT}/demo_r_pjanaggr3?format=JSON&lang=EN&geoLevel=nuts3&sex=T&age=TOTAL&unit=NR`
  },
  {
    id: "worldbank-sp-pop-totl",
    name: "Population (world)",
    providerId: "worldbank",
    geoLevel: "country",
    unit: "people",
    normalization: "raw",
    higherIsWorse: false,
    license: "CC BY 4.0",
    attribution: "World Bank Open Data",
    documentationUrl: "https://data.worldbank.org/indicator/SP.POP.TOTL",
    // Outside Europe the country level is all there is, and it is what keeps a theme from
    // ending at the union border.
    endpoint:
      "https://api.worldbank.org/v2/country/all/indicator/SP.POP.TOTL?format=json&per_page=20000&date=2000:2026"
  },
  {
    id: "worldbank-pm25",
    themeId: "air",
    name: "Population-weighted PM2.5 exposure",
    providerId: "worldbank",
    geoLevel: "country",
    unit: "µg/m³",
    normalization: "raw",
    higherIsWorse: true,
    license: "CC BY 4.0",
    commercialUse: true,
    attribution: "World Bank / Global Burden of Disease",
    documentationUrl: "https://data.worldbank.org/indicator/EN.ATM.PM25.MC.M3",
    endpoint:
      "https://api.worldbank.org/v2/country/all/indicator/EN.ATM.PM25.MC.M3?format=json&per_page=20000&date=2000:2026"
  },
  ...(
    [
      [
        "senior-share",
        "Population aged 65 or over",
        "Podíl obyvatel ve věku 65+",
        "population",
        "SP.POP.65UP.TO.ZS",
        "%"
      ],
      [
        "electricity-access",
        "Access to electricity",
        "Přístup k elektřině",
        "energy",
        "EG.ELC.ACCS.ZS",
        "% of population"
      ],
      [
        "internet-use",
        "Individuals using the Internet",
        "Používání internetu",
        "digital",
        "IT.NET.USER.ZS",
        "% of population"
      ],
      ["forest-cover", "Forest area", "Lesní pokryv", "land", "AG.LND.FRST.ZS", "% of land"],
      ["physicians", "Physicians", "Lékaři", "health", "SH.MED.PHYS.ZS", "physicians/1,000 people"],
      [
        "hospital-beds",
        "Hospital beds",
        "Nemocniční lůžka",
        "health",
        "SH.MED.BEDS.ZS",
        "beds/1,000 people"
      ]
    ] as const
  ).map(([id, name, nameCs, group, code, unit]): StatDatasetDescriptor => ({
    id: `worldbank-${id}`,
    themeId: id,
    name,
    nameCs,
    group,
    providerId: "worldbank",
    geoLevel: "country",
    unit,
    normalization: unit.startsWith("%") ? "percent" : "raw",
    higherIsWorse: false,
    license: "CC BY 4.0",
    commercialUse: true,
    attribution: "World Bank",
    documentationUrl: `https://data.worldbank.org/indicator/${code}`,
    endpoint: `https://api.worldbank.org/v2/country/all/indicator/${code}?format=json&per_page=20000&date=2000:2026`
  }))
];

export const STAT_DATASETS: readonly StatDatasetDescriptor[] = [
  ...(["population", "population-density"] as const).map((metric): StatDatasetDescriptor => ({
    id: `lau-${metric}-2024`,
    themeId: metric,
    group: "population",
    name: metric === "population" ? "Municipal population (2024)" : "Population density",
    nameCs: metric === "population" ? "Obecní populace (2024)" : "Hustota obyvatel",
    providerId: "municipal-population",
    geoLevel: "lau",
    boundaryEdition: "2024",
    unit: metric === "population" ? "people" : "people/km²",
    normalization: metric === "population" ? "raw" : "per_km2",
    higherIsWorse: false,
    license: "GISCO dataset terms; INE re-use terms. Uses the existing published LAU 2024 edition.",
    attribution: "Eurostat GISCO / © EuroGeographics; Spain: INE annual population census 2024",
    documentationUrl:
      "https://ec.europa.eu/eurostat/web/gisco/geodata/statistical-units/local-administrative-units",
    endpoint:
      "https://gisco-services.ec.europa.eu/distribution/v2/lau/geojson/LAU_RG_01M_2024_4326.geojson",
    metric
  })),
  ...LEGACY_STAT_DATASETS,
  ...LEGACY_STAT_DATASETS.filter((d) => d.providerId === "eurostat").map((d) => ({
    ...d,
    id: `${d.id}-country`,
    geoLevel: "country" as const,
    themeId: (
      {
        "eurostat-crim-gen-reg": "crime",
        "eurostat-tran-r-acci": "accidents",
        "eurostat-demo-r-pjanaggr3": "population"
      } as Record<string, string>
    )[d.id],
    endpoint: d.endpoint.replace(/&geoLevel=nuts[0-3]/, ""),
    boundaryEdition: undefined
  })),
  ...EUROPEAN_INDICATORS,
  ...NATIONAL_STATISTICS
];

export function statDataset(id: string): StatDatasetDescriptor | undefined {
  return STAT_DATASETS.find((dataset) => dataset.id === id);
}

/** Reads a payload with the parser the payload's own shape implies. */
export function parseStatDataset(
  dataset: StatDatasetDescriptor,
  payload: unknown
): StatSeriesParseResult {
  if (dataset.providerId === "municipal-population")
    return parseMunicipalPopulation(payload, dataset.metric === "population-density");
  if (dataset.nationalAdapter === "statbank") {
    const wrapped = payload as {
      dataset: {
        dimension: Record<string, unknown> & { id: string[]; size: number[] };
        value: unknown;
      };
    };
    const cube = wrapped.dataset;
    payload = { ...cube, id: cube.dimension.id, size: cube.dimension.size };
  }
  if (dataset.providerId === "worldbank" && Array.isArray(payload) && Number(payload[0]?.pages) > 1)
    throw new Error(`${dataset.id}: incomplete World Bank pagination`);
  const normalized = parseNationalStatistics(dataset, payload);
  const root = (
    dataset.sliceDimensions
      ? sliceStatCube(payload as Parameters<typeof sliceStatCube>[0], dataset.dimensions ?? {})
      : payload
  ) as Record<string, unknown>;
  let input = root;
  if (root && Array.isArray(root.id) && root.dimension) {
    const ids = root.id as string[];
    const sizes = root.size as number[];
    const geo = dataset.geographyDimension ?? "geo";
    const time = dataset.timeDimension ?? "time";
    for (const [id, expected] of Object.entries(dataset.dimensions ?? {})) {
      const index = ids.indexOf(id);
      if (index < 0) continue; // Some APIs omit dimensions fixed in the endpoint itself.
      const dimension = (
        root.dimension as Record<string, { category: { index: Record<string, number> | string[] } }>
      )[id];
      const categories = dimension?.category.index;
      if (
        sizes[index] === 1 &&
        !(Array.isArray(categories)
          ? categories.includes(expected)
          : categories && Object.hasOwn(categories, expected))
      )
        throw new Error(`${dataset.id}: unexpected category ${id}; expected ${expected}`);
    }
    for (let i = 0; i < ids.length; i++) {
      if (![geo, time].includes(ids[i]!) && sizes[i]! > 1) {
        throw new Error(`${dataset.id}: ambiguous dimension ${ids[i]} (${sizes[i]} members)`);
      }
    }
    input = {
      ...root,
      id: ids.map((id) => (id === geo ? "geo" : id === time ? "time" : id)),
      dimension: Object.fromEntries(
        Object.entries(root.dimension as object).map(([id, value]) => [
          id === geo ? "geo" : id === time ? "time" : id,
          value
        ])
      )
    };
  }
  const parsed = normalized ?? parseStatSeries(input);
  const seen = new Set<string>();
  parsed.observations = parsed.observations.filter((row) => {
    if (dataset.nationalAdapter === "statbank") {
      if (!/^\d{4}K1$/.test(row.period)) return false;
      row.period = row.period.slice(0, 4);
    }
    if (dataset.codeMap) {
      const code = dataset.codeMap[row.geoCode];
      if (!code) throw new Error(`Unmapped territory ${row.geoCode}`);
      row.geoCode = code;
    }
    if (dataset.providerId === "csu" && row.geoCode.length !== 5) return false;
    if (dataset.providerId === "eurostat") {
      const length = dataset.geoLevel === "country" ? 2 : Number(dataset.geoLevel.slice(-1)) + 2;
      if (!/^[A-Z]{2}[A-Z0-9]*$/.test(row.geoCode) || row.geoCode.length !== length) return false;
      if (dataset.geoLevel === "country")
        row.geoCode =
          ({ EL: "GR", UK: "GB" } as Record<string, string>)[row.geoCode] ?? row.geoCode;
    }
    if (dataset.providerId === "worldbank" && !WORLD_BANK_COUNTRY_CODES.has(row.geoCode))
      return false;
    const key = `${row.geoCode}\0${row.period}`;
    if (seen.has(key))
      throw new Error(`${dataset.id}: duplicate observation ${row.geoCode}/${row.period}`);
    seen.add(key);
    return true;
  });
  parsed.periods = [...new Set(parsed.observations.map((row) => row.period))].sort();
  return parsed;
}
