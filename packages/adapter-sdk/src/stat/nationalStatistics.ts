import type { StatDatasetDescriptor } from "./statDatasets.js";
import type { StatSeriesParseResult } from "./statSeries.js";

/** National series retain their own definitions; they never silently replace a harmonised rate. */
export const NATIONAL_STATISTICS: StatDatasetDescriptor[] = [
  {
    id: "ep-turnout",
    themeId: "ep-turnout",
    group: "elections",
    name: "European Parliament election turnout",
    nameCs: "Účast ve volbách do Evropského parlamentu",
    providerId: "european-parliament",
    geoLevel: "country",
    unit: "%",
    normalization: "percent",
    higherIsWorse: false,
    license: "European Parliament re-use notice",
    commercialUse: true,
    attribution: "European Parliament",
    documentationUrl: "https://results.elections.europa.eu/en/tools/download-datasheets/",
    endpoint: "https://results.elections.europa.eu/data-sheets/json/turnout.json",
    nationalAdapter: "ep-turnout"
  },
  {
    id: "dst-population",
    themeId: "population",
    name: "Population at start of quarter",
    providerId: "dst",
    geoLevel: "country",
    unit: "people",
    normalization: "raw",
    higherIsWorse: false,
    license: "CC BY 4.0",
    commercialUse: true,
    attribution: "Statistics Denmark",
    documentationUrl: "https://www.dst.dk/en/Statistik/hjaelp-til-statistikbanken/api",
    endpoint: "https://api.statbank.dk/v1/data",
    nationalAdapter: "statbank",
    geographyDimension: "OMRÅDE",
    timeDimension: "Tid",
    requestSelection: {
      OMRÅDE: ["000"],
      KØN: ["TOT"],
      ALDER: ["IALT"],
      CIVILSTAND: ["TOT"],
      Tid: ["*"]
    },
    codeMap: { "000": "DK" }
  },
  ...(["tourism-nights", "foreign-tourism"] as const).map((id): StatDatasetDescriptor => ({
    id: `csu-${id}`,
    themeId: id,
    name:
      id === "tourism-nights"
        ? "Overnight stays in collective accommodation"
        : "Foreign overnight stays in collective accommodation",
    providerId: "csu",
    geoLevel: "nuts3",
    unit: "nights",
    normalization: "raw",
    higherIsWorse: false,
    license: "ČSÚ open data terms",
    commercialUse: true,
    attribution: "Český statistický úřad",
    documentationUrl: "https://csu.gov.cz/zakladni-informace-pro-pouziti-api-datastatu",
    endpoint: "https://data.csu.gov.cz/api/dotaz/v1/data/vybery/CRUHVD1T2",
    geographyDimension: "Uz012",
    timeDimension: "CasR",
    dimensions: { IndicatorType: "2655", REZIDENCE: id === "tourism-nights" ? "0" : "17" },
    boundaryEdition: "2024",
    sliceDimensions: true
  })),
  ...(["population", "senior-share"] as const).map((id): StatDatasetDescriptor => ({
    id: `statfi-${id}`,
    themeId: id,
    name: id === "population" ? "Population at year end" : "Population aged 65 or over",
    providerId: "statfi",
    geoLevel: "country",
    unit: id === "population" ? "people" : "%",
    normalization: id === "population" ? "raw" : "percent",
    higherIsWorse: false,
    license: "CC BY 4.0",
    commercialUse: true,
    attribution: "Statistics Finland",
    documentationUrl:
      "https://stat.fi/en/services/statistical-data-services/open-data-and-interfaces/interface-use-of-databases",
    endpoint: "https://pxdata.stat.fi/PxWeb/api/v1/en/StatFin/11ra.px",
    nationalAdapter: "pxweb",
    geographyDimension: "alue_23_20260101",
    timeDimension: "timeperiod_y",
    dimensions: { contentscode: id === "population" ? "vaerak-vaesto" : "vaesto_yli64_p" },
    requestSelection: { alue_23_20260101: ["SSS"] },
    codeMap: { SSS: "FI" }
  })),
  {
    id: "gus-population",
    themeId: "population",
    name: "Population at year end",
    providerId: "gus",
    geoLevel: "country",
    unit: "people",
    normalization: "raw",
    higherIsWorse: false,
    license: "GUS public information re-use terms",
    commercialUse: true,
    attribution: "Statistics Poland (GUS)",
    documentationUrl: "https://api.stat.gov.pl/Home/BdlApi?lang=en",
    endpoint:
      "https://bdl.stat.gov.pl/api/v1/data/by-variable/72305?unit-level=0&format=json&lang=en&page-size=100",
    nationalAdapter: "gus"
  },
  ...(["population", "senior-share", "population-density"] as const).map(
    (id): StatDatasetDescriptor => ({
      id: `cbs-${id}`,
      themeId: id,
      name:
        id === "population"
          ? "Population on 1 January"
          : id === "senior-share"
            ? "Population aged 65 or over"
            : "Population density",
      providerId: "cbs",
      geoLevel: "country",
      unit: id === "population" ? "people" : id === "senior-share" ? "%" : "people/km²",
      normalization: id === "senior-share" ? "percent" : "raw",
      higherIsWorse: false,
      license: "CC BY 4.0",
      commercialUse: true,
      attribution: "CBS Statistics Netherlands",
      documentationUrl: "https://www.cbs.nl/en-gb/our-services/open-data/statline-as-open-data",
      endpoint: "https://opendata.cbs.nl/ODataApi/OData/37296eng/TypedDataSet?$format=json",
      nationalAdapter: "cbs",
      metric: id
    })
  ),
  {
    id: "ine-population",
    themeId: "population",
    name: "Population census (historical series)",
    providerId: "ine",
    geoLevel: "country",
    unit: "people",
    normalization: "raw",
    higherIsWorse: false,
    license: "INE re-use terms",
    commercialUse: true,
    attribution: "Instituto Nacional de Estadística",
    documentationUrl: "https://ine.es/dyngs/DAB/es/index.htm?cid=1099",
    endpoint: "https://servicios.ine.es/wstempus/jsCache/EN/DATOS_TABLA/2852",
    nationalAdapter: "ine"
  }
];

/** Only provider-specific wire formats live here; publications still use the common contract. */
export function parseNationalStatistics(
  d: StatDatasetDescriptor,
  payload: unknown
): StatSeriesParseResult | null {
  const rows: StatSeriesParseResult["observations"] = [];
  const root = payload as {
    years?: {
      yearId: unknown;
      turnoutByYear?: {
        turnoutByCountry?: { percent: unknown; countryId: string; status: string }[];
      };
    }[];
    totalRecords?: unknown;
    results?: { id: string; values?: { year: unknown; val: unknown; attrId: number }[] }[];
    "odata.nextLink"?: string;
    "@odata.nextLink"?: string;
    value?: {
      Periods: string;
      TotalPopulation_1?: unknown;
      PopulationDensity_78?: unknown;
      k_65To80Years_18?: unknown;
      k_80YearsOrOlder_19?: unknown;
    }[];
  };
  if (d.nationalAdapter === "ep-turnout") {
    for (const year of root.years ?? [])
      for (const r of year.turnoutByYear?.turnoutByCountry ?? []) {
        const value = number(r.percent);
        if (value !== null && (value < 0 || value > 100)) throw Error("Invalid election turnout");
        rows.push({
          geoCode: r.countryId === "EL" ? "GR" : r.countryId === "UK" ? "GB" : r.countryId,
          period: String(year.yearId),
          value,
          flag: r.status === "FINAL" || r.status === "OFFICIAL" ? undefined : r.status
        });
      }
  } else if (d.nationalAdapter === "gus") {
    if (Number(root.totalRecords) !== (root.results ?? []).length)
      throw Error("Incomplete GUS pagination");
    for (const area of root.results ?? []) {
      if (area.id !== "000000000000") throw Error("Unmapped GUS territory");
      for (const v of area.values ?? [])
        rows.push({
          geoCode: "PL",
          period: String(v.year),
          value: number(v.val),
          flag: v.attrId === 1 ? undefined : `gus:${v.attrId}`
        });
    }
  } else if (d.nationalAdapter === "cbs") {
    if (root["odata.nextLink"] || root["@odata.nextLink"]) throw Error("Incomplete CBS pagination");
    for (const r of root.value ?? []) {
      if (!/^\d{4}JJ00$/.test(r.Periods)) continue;
      const value =
        d.metric === "population"
          ? number(r.TotalPopulation_1)
          : d.metric === "population-density"
            ? number(r.PopulationDensity_78)
            : typeof r.k_65To80Years_18 === "number" && typeof r.k_80YearsOrOlder_19 === "number"
              ? r.k_65To80Years_18 + r.k_80YearsOrOlder_19
              : null;
      rows.push({ geoCode: "NL", period: r.Periods.slice(0, 4), value });
    }
  } else if (d.nationalAdapter === "ine") {
    if (!Array.isArray(payload)) throw Error("Invalid INE response");
    const total = payload.find((r) => r.COD === "DPOP1");
    if (!total) throw Error("INE population series missing");
    for (const r of total.Data ?? [])
      rows.push({
        geoCode: "ES",
        period: String(r.Anyo),
        value: r.Secreto ? null : number(r.Valor),
        flag: r.Secreto ? "confidential" : undefined
      });
  } else return null;
  const observations = rows.filter(
    (r) => /^\d{4}$/.test(r.period) && (d.nationalAdapter === "ep-turnout" || r.period >= "2000")
  );
  return {
    observations,
    periods: [...new Set(observations.map((r) => r.period))].sort(),
    geoLabels: {}
  };
}
function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Slice a deliberately selected cube; unexpected unselected dimensions are still rejected. */
export function sliceStatCube(
  payload: {
    id: string[];
    size: number[];
    dimension: Record<
      string,
      {
        category: { index: string[] | Record<string, number>; [key: string]: unknown };
        [key: string]: unknown;
      }
    >;
    value?: Record<string, unknown> | unknown[];
    status?: Record<string, unknown>;
    [key: string]: unknown;
  },
  selection: Record<string, string>
) {
  const ids = payload.id as string[],
    sizes = payload.size as number[];
  const dimension = { ...payload.dimension };
  const target = [...sizes];
  const positions = new Map<number, number>();
  for (const [id, code] of Object.entries(selection)) {
    const axis = ids.indexOf(id);
    if (axis < 0) throw Error(`Missing dimension ${id}`);
    const cat = dimension[id]!.category;
    const pos = Array.isArray(cat.index) ? cat.index.indexOf(code) : cat.index[code];
    if (pos === undefined || !Number.isInteger(pos) || pos < 0)
      throw Error(`Missing category ${id}=${code}`);
    positions.set(axis, pos);
    target[axis] = 1;
    dimension[id] = { ...dimension[id], category: { ...cat, index: { [code]: 0 } } };
  }
  const value: Record<string, unknown> = {},
    status: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(payload.value ?? {})) {
    let flat = Number(key),
      out = 0,
      stride = 1,
      keep = true;
    for (let axis = ids.length - 1; axis >= 0; axis--) {
      const pos = flat % sizes[axis]!;
      flat = Math.floor(flat / sizes[axis]!);
      if (positions.has(axis) && positions.get(axis) !== pos) keep = false;
      out += (positions.has(axis) ? 0 : pos) * stride;
      stride *= target[axis]!;
    }
    if (keep) {
      value[out] = v;
      if (payload.status?.[key] != null) status[out] = payload.status[key];
    }
  }
  return { ...payload, dimension, size: target, value, status };
}
