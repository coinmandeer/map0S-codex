/**
 * Reading statistics out of the three shapes the open statistical services publish.
 *
 * Eurostat and most of the European system speak JSON-stat 2.0, OECD and the SDMX world speak
 * SDMX-JSON, the World Bank has its own array format. All three answer the same question — a
 * value for a territory in a period — and all three encode it differently enough that a shared
 * parser would be a pile of conditionals. So there are three parsers with one output type, and
 * everything downstream (`stat_series`, the theme tiles, the choropleth) sees only that type.
 *
 * The awkward part in each of them is how an observation is addressed. JSON-stat stores a sparse
 * map keyed by a single flattened index over all dimensions, so reading it means recovering the
 * dimension positions by integer division. SDMX-JSON splits the key in two: a colon-joined
 * series key of dimension positions, and an observation key for the time dimension. Getting
 * either wrong produces plausible numbers attached to the wrong country, which no schema check
 * would catch — hence the fixtures in the tests.
 */

export interface StatObservation {
  /** Exact immutable edition for a source whose year is published per country. */
  boundaryEdition?: string;
  /** The territory code as the service publishes it, before any mapping onto `geo_units`. */
  geoCode: string;
  /** `2023`, `2023-Q1`, `2023-07`; ordered lexicographically by construction. */
  period: string;
  value: number | null;
  /** Upstream quality flag: `p` provisional, `e` estimated, `:` not available. */
  flag?: string;
}

export interface StatSeriesParseResult {
  observations: StatObservation[];
  /** Human-readable names for the codes, when the service ships them. */
  geoLabels: Record<string, string>;
  /** Every period present, sorted, so a timeline knows its range without a second pass. */
  periods: string[];
  unit?: string;
  label?: string;
}

/** JSON-stat 2.0, as served by Eurostat's statistics API. */
export function parseJsonStat(payload: unknown): StatSeriesParseResult {
  const root = asRecord(payload);
  const ids = asStringArray(root.id);
  const sizes = asNumberArray(root.size);
  const dimensions = asRecord(root.dimension);
  if (ids.length !== sizes.length || ids.length === 0) return empty();

  const geoDimension = ids.find((id) => GEO_DIMENSIONS.has(id.toLowerCase()));
  const timeDimension = ids.find((id) => TIME_DIMENSIONS.has(id.toLowerCase()));
  if (!geoDimension || !timeDimension) return empty();

  const index = (dimension: string) => {
    const category = asRecord(asRecord(dimensions[dimension]).category);
    return categoryOrder(category.index, sizes[ids.indexOf(dimension)] ?? 0);
  };
  const geoCodes = index(geoDimension);
  const periods = index(timeDimension);
  const geoLabels = categoryLabels(asRecord(asRecord(dimensions[geoDimension]).category).label);

  // Strides for the row-major layout `size` describes: the last dimension is contiguous.
  const strides = new Array<number>(ids.length).fill(1);
  for (let position = ids.length - 2; position >= 0; position -= 1) {
    strides[position] = strides[position + 1]! * (sizes[position + 1] ?? 1);
  }
  const geoStride = strides[ids.indexOf(geoDimension)]!;
  const geoSize = sizes[ids.indexOf(geoDimension)]!;
  const timeStride = strides[ids.indexOf(timeDimension)]!;
  const timeSize = sizes[ids.indexOf(timeDimension)]!;

  const values =
    root.value && typeof root.value === "object" ? (root.value as Record<string, unknown>) : {};
  const statuses =
    root.status && typeof root.status === "object" ? (root.status as Record<string, unknown>) : {};
  const observations: StatObservation[] = [];
  for (const [rawKey, rawValue] of Object.entries(values)) {
    const flat = Number(rawKey);
    if (!Number.isInteger(flat)) continue;
    const geoPosition = Math.floor(flat / geoStride) % geoSize;
    const timePosition = Math.floor(flat / timeStride) % timeSize;
    const geoCode = geoCodes[geoPosition];
    const period = periods[timePosition];
    if (!geoCode || !period) continue;
    const flag = flagOf(statuses[rawKey]);
    observations.push({
      geoCode,
      period,
      value: numeric(rawValue),
      ...(flag ? { flag } : {})
    });
  }

  return {
    observations,
    geoLabels,
    periods: sortedPeriods(observations),
    unit: jsonStatUnit(dimensions, ids),
    label: text(root.label)
  };
}

/** SDMX-JSON 1.0 data messages, as served by OECD and the ECB. */
export function parseSdmxJson(payload: unknown): StatSeriesParseResult {
  const root = asRecord(payload);
  const structure = asRecord(root.structure);
  const structureDimensions = asRecord(structure.dimensions);
  const seriesDimensions = asArray(structureDimensions.series).map(asRecord);
  const observationDimensions = asArray(structureDimensions.observation).map(asRecord);

  const geoPosition = seriesDimensions.findIndex((dimension) =>
    GEO_DIMENSIONS.has(String(dimension.id ?? "").toLowerCase())
  );
  const timeDimension = observationDimensions.find((dimension) =>
    TIME_DIMENSIONS.has(String(dimension.id ?? "").toLowerCase())
  );
  if (geoPosition < 0 || !timeDimension) return empty();

  const geoValues = asArray(seriesDimensions[geoPosition]!.values).map(asRecord);
  const periodValues = asArray(timeDimension.values).map(asRecord);
  const geoLabels: Record<string, string> = {};
  for (const value of geoValues) {
    const id = text(value.id);
    const name = text(value.name);
    if (id && name) geoLabels[id] = name;
  }

  const dataSets = asArray(root.dataSets).map(asRecord);
  const observations: StatObservation[] = [];
  for (const dataSet of dataSets) {
    for (const [seriesKey, rawSeries] of Object.entries(asRecord(dataSet.series))) {
      const positions = seriesKey.split(":").map(Number);
      const geoCode = text(geoValues[positions[geoPosition] ?? -1]?.id);
      if (!geoCode) continue;
      for (const [observationKey, rawObservation] of Object.entries(
        asRecord(asRecord(rawSeries).observations)
      )) {
        const period = text(periodValues[Number(observationKey)]?.id);
        if (!period) continue;
        // An observation is an array whose first entry is the value; the rest are attribute
        // indices, which is where a flag lives when the service attaches one.
        const cells = asArray(rawObservation);
        observations.push({ geoCode, period, value: numeric(cells[0]) });
      }
    }
  }

  return {
    observations,
    geoLabels,
    periods: sortedPeriods(observations),
    unit: text(asRecord(structure.attributes).unit),
    label: text(structure.name)
  };
}

/** World Bank API v2: `[metadata, rows]`. */
export function parseWorldBank(payload: unknown): StatSeriesParseResult {
  const rows = Array.isArray(payload) ? asArray(payload[1]).map(asRecord) : [];
  const geoLabels: Record<string, string> = {};
  const observations: StatObservation[] = [];
  for (const row of rows) {
    const country = asRecord(row.country);
    // The ISO-2 id is what `geo_units` stores for a country; `countryiso3code` is the fallback
    // for the aggregate rows ("EUU", "WLD") that have no two-letter code.
    const geoCode = text(country.id) ?? text(row.countryiso3code);
    const period = text(row.date);
    if (!geoCode || !period) continue;
    const label = text(country.value);
    if (label) geoLabels[geoCode] = label;
    observations.push({ geoCode, period, value: numeric(row.value) });
  }
  return {
    observations,
    geoLabels,
    periods: sortedPeriods(observations),
    label: text(asRecord(rows[0]?.indicator).value)
  };
}

/** Picks the parser from what the payload looks like, so a catalogue entry names a URL and not
 *  a format the service might change under it. */
export function parseStatSeries(payload: unknown): StatSeriesParseResult {
  const root = asRecord(payload);
  if (Array.isArray(payload)) return parseWorldBank(payload);
  if (root.dataSets && root.structure) return parseSdmxJson(payload);
  if (root.value && root.dimension) return parseJsonStat(payload);
  return empty();
}

const GEO_DIMENSIONS = new Set(["geo", "ref_area", "reg_id", "location", "country", "area"]);
const TIME_DIMENSIONS = new Set(["time", "time_period", "period", "year"]);

function empty(): StatSeriesParseResult {
  return { observations: [], geoLabels: {}, periods: [] };
}

/** JSON-stat category indices may be a map of code → position or a plain ordered array. */
function categoryOrder(index: unknown, size: number): string[] {
  if (Array.isArray(index)) return index.map(String);
  const order = new Array<string>(size);
  for (const [code, position] of Object.entries(asRecord(index))) {
    const slot = Number(position);
    if (Number.isInteger(slot) && slot >= 0) order[slot] = code;
  }
  return order;
}

function categoryLabels(label: unknown): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const [code, value] of Object.entries(asRecord(label))) {
    const name = text(value);
    if (name) labels[code] = name;
  }
  return labels;
}

/** Eurostat carries the unit as a one-member dimension rather than a field. */
function jsonStatUnit(
  dimensions: Record<string, unknown>,
  ids: readonly string[]
): string | undefined {
  const unitId = ids.find((id) => id.toLowerCase() === "unit");
  if (!unitId) return undefined;
  const category = asRecord(asRecord(dimensions[unitId]).category);
  const labels = categoryLabels(category.label);
  const first = Object.values(labels)[0];
  return first ?? Object.keys(asRecord(category.index))[0];
}

function flagOf(value: unknown): string | undefined {
  const flag = text(value);
  return flag && flag !== ":" ? flag : undefined;
}

function sortedPeriods(observations: readonly StatObservation[]): string[] {
  return [...new Set(observations.map((observation) => observation.period))].sort();
}

function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asStringArray(value: unknown): string[] {
  return asArray(value).map(String);
}

function asNumberArray(value: unknown): number[] {
  return asArray(value).map(Number);
}
