/**
 * Where territory boundaries come from.
 *
 * Three families, chosen so coverage is continental first and national only where it adds
 * detail (§23.4): Eurostat GISCO for Europe, Natural Earth for the rest of the world's
 * countries, geoBoundaries for sub-national divisions outside Europe.
 *
 * Every entry names a generalisation, and that is the whole trick to making this importable.
 * GISCO publishes NUTS at 1M, 3M, 10M, 20M and 60M; the 1M edition of NUTS 3 is tens of
 * megabytes of coastline detail that no continental choropleth can show. 10M draws the same map
 * at a size the guarded fetch will actually accept, and a country zoom is served by the
 * national detail source rather than by more coastline.
 */

import type { GeoUnitRow } from "./geoUnitsImport.js";

export type GeoUnitLevel =
  "country" | "nuts0" | "nuts1" | "nuts2" | "nuts3" | "lau" | "adm1" | "adm2";

export interface GeoUnitSource {
  id: string;
  label: string;
  level: GeoUnitLevel;
  /** Stable slug for the rate limiter and the circuit breaker; never a display name. */
  providerId: string;
  edition: string;
  license: string;
  attribution: string;
  /** A single GeoJSON FeatureCollection. Entries needing a per-country request are `resolve`d. */
  url?: string;
  /** For sources whose download URL has to be looked up per country first. */
  countries?: readonly string[];
  resolveUrls?: (country: string) => string;
  normalize: (feature: GeoJsonFeature, source: GeoUnitSource) => GeoUnitRow | null;
  /** GISCO's largest 10M file is about 6 MB; the guarded fetch caps at 16 MiB anyway. */
  maxResponseBytes?: number;
  /** Left out of a bare `geo:units` run: too large to import casually, useful when asked for. */
  optional?: boolean;
  countryCode?: string;
}

export interface GeoJsonFeature {
  type?: string;
  properties?: Record<string, unknown> | null;
  geometry?: { type?: string; coordinates?: unknown } | null;
}

const NUTS_EDITION = "2024";
/** Pinned LAU edition, independently published from NUTS. */
const LAU_EDITION = "2024";
const GISCO = "https://gisco-services.ec.europa.eu/distribution/v2";

/** GISCO NUTS: `NUTS_ID` is the code, `NAME_LATN` the romanised name, `CNTR_CODE` the country. */
function nutsRow(feature: GeoJsonFeature, source: GeoUnitSource): GeoUnitRow | null {
  const properties = feature.properties ?? {};
  const code = text(properties.NUTS_ID);
  const geometry = feature.geometry;
  if (!code || !geometry) return null;
  const level = Number(properties.LEVL_CODE ?? code.length - 2);
  return {
    level: source.level,
    code,
    name: text(properties.NAME_LATN) ?? text(properties.NUTS_NAME) ?? code,
    // NUTS codes nest by prefix: CZ032 sits inside CZ03, which sits inside CZ0.
    parentCode: level > 0 ? code.slice(0, code.length - 1) : null,
    country: text(properties.CNTR_CODE) ?? code.slice(0, 2),
    sourceId: source.providerId,
    edition: source.edition,
    geometry,
    areaKm2: null
  };
}

/** GISCO LAU: municipalities. `GISCO_ID` is prefixed with the country, `LAU_ID` is not. */
function lauRow(feature: GeoJsonFeature, source: GeoUnitSource): GeoUnitRow | null {
  const properties = feature.properties ?? {};
  const country = text(properties.CNTR_CODE);
  const local = text(properties.LAU_ID);
  const code = text(properties.GISCO_ID) ?? (country && local ? `${country}_${local}` : null);
  const geometry = feature.geometry;
  if (!code || !geometry) return null;
  return {
    level: "lau",
    code,
    name: text(properties.LAU_NAME) ?? code,
    // A LAU knows its country but not its NUTS3 parent, and guessing one from the code would be
    // wrong for the several countries where the numbering is not hierarchical.
    parentCode: null,
    country: country ?? code.slice(0, 2),
    sourceId: source.providerId,
    edition: source.edition,
    geometry,
    areaKm2: numeric(properties.AREA_KM2)
  };
}

/** Natural Earth countries: ISO A2 with a documented `-99` for disputed entries. */
function naturalEarthRow(feature: GeoJsonFeature, source: GeoUnitSource): GeoUnitRow | null {
  const properties = feature.properties ?? {};
  const iso = text(properties.ISO_A2_EH) ?? text(properties.ISO_A2);
  const code = iso && iso !== "-99" ? iso : text(properties.ADM0_A3);
  const geometry = feature.geometry;
  if (!code || !geometry) return null;
  return {
    level: "country",
    code,
    name: text(properties.NAME_EN) ?? text(properties.NAME) ?? code,
    parentCode: null,
    country: code.length === 2 ? code : null,
    sourceId: source.providerId,
    edition: source.edition,
    geometry,
    areaKm2: null
  };
}

/** shapeISO can be the same country code for every region (e.g. ESP ADM1).
 * Use the provider's feature identity; ISO is descriptive, not a unique key. */
function geoBoundariesRow(feature: GeoJsonFeature, source: GeoUnitSource): GeoUnitRow | null {
  const properties = feature.properties ?? {};
  const code = text(properties.shapeID);
  const geometry = feature.geometry;
  if (!code || !geometry) return null;
  return {
    level: source.level,
    code,
    name: text(properties.shapeName) ?? code,
    parentCode: null,
    country: source.countryCode ?? text(properties.shapeGroup) ?? null,
    sourceId: source.providerId,
    edition: source.edition,
    geometry,
    areaKm2: null
  };
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numeric(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const nuts = (level: 0 | 1 | 2 | 3): GeoUnitSource => ({
  id: `gisco-nuts${level}`,
  label: `Eurostat GISCO NUTS ${level} (${NUTS_EDITION})`,
  level: `nuts${level}` as GeoUnitLevel,
  providerId: "gisco-nuts",
  edition: NUTS_EDITION,
  license:
    "GISCO dataset terms; EuroGeographics attribution; commercial use requires licence review",
  attribution: "© EuroGeographics, Eurostat GISCO",
  url: `${GISCO}/nuts/geojson/NUTS_RG_10M_${NUTS_EDITION}_4326_LEVL_${level}.geojson`,
  normalize: nutsRow
});

/** Geographic Europe plus transcontinental neighbours, including non-EU states.
 * Availability is determined by imported metadata, not inferred from this catalogue. */
export const EUROPE_BOUNDARY_COUNTRIES = [
  "AL:ALB",
  "AD:AND",
  "AT:AUT",
  "BY:BLR",
  "BE:BEL",
  "BA:BIH",
  "BG:BGR",
  "HR:HRV",
  "CY:CYP",
  "CZ:CZE",
  "DK:DNK",
  "EE:EST",
  "FI:FIN",
  "FR:FRA",
  "DE:DEU",
  "GR:GRC",
  "HU:HUN",
  "IS:ISL",
  "IE:IRL",
  "IT:ITA",
  "XK:XKX",
  "LV:LVA",
  "LI:LIE",
  "LT:LTU",
  "LU:LUX",
  "MT:MLT",
  "MD:MDA",
  "MC:MCO",
  "ME:MNE",
  "NL:NLD",
  "MK:MKD",
  "NO:NOR",
  "PL:POL",
  "PT:PRT",
  "RO:ROU",
  "RU:RUS",
  "SM:SMR",
  "RS:SRB",
  "SK:SVK",
  "SI:SVN",
  "ES:ESP",
  "SE:SWE",
  "CH:CHE",
  "TR:TUR",
  "UA:UKR",
  "GB:GBR",
  "VA:VAT",
  "GE:GEO",
  "AM:ARM",
  "AZ:AZE"
] as const;

const europeanAdminSources: GeoUnitSource[] = EUROPE_BOUNDARY_COUNTRIES.flatMap((pair) => {
  const [a2, a3] = pair.split(":") as [string, string];
  return (["adm1", "adm2"] as const).map((level) => ({
    id: `gb-${a2.toLowerCase()}-${level}`,
    label: `geoBoundaries ${a2} ${level.toUpperCase()}`,
    level,
    providerId: `gb-${a2.toLowerCase()}-${level}`,
    edition: "current",
    countryCode: a2,
    license: "CC BY 4.0 compliant gbOpen; see country source metadata",
    attribution: "geoBoundaries (William & Mary geoLab)",
    countries: [a3],
    resolveUrls: (country) =>
      `https://www.geoboundaries.org/api/current/gbOpen/${country}/${level.toUpperCase()}/`,
    normalize: geoBoundariesRow,
    optional: true
  }));
});

export const GEO_UNIT_SOURCES: readonly GeoUnitSource[] = [
  ...europeanAdminSources,
  nuts(0),
  nuts(1),
  nuts(2),
  nuts(3),
  {
    id: "gisco-lau",
    label: `Eurostat GISCO LAU (${LAU_EDITION})`,
    level: "lau",
    providerId: "gisco-lau",
    edition: LAU_EDITION,
    license:
      "GISCO dataset terms; EuroGeographics attribution; commercial use requires licence review",
    attribution: "© EuroGeographics, Eurostat GISCO",
    url: `${GISCO}/lau/geojson/LAU_RG_01M_${LAU_EDITION}_4326.geojson`,
    // A hundred thousand municipalities in one file. It is the finest level MapOS can draw and
    // the only one worth having for a city-scale theme, but importing it is a decision someone
    // makes rather than something a first run does by accident.
    optional: true,
    maxResponseBytes: 256 * 1024 * 1024,
    normalize: lauRow
  },
  {
    id: "natural-earth-countries",
    label: "Natural Earth countries 1:50m",
    level: "country",
    providerId: "natural-earth",
    // Pinned to a release tag: `master` would change the boundaries under a stored code.
    edition: "v5.1.2",
    license: "Public domain",
    attribution: "Natural Earth",
    url: "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_admin_0_countries.geojson",
    maxResponseBytes: 16 * 1024 * 1024,
    normalize: naturalEarthRow
  },
  {
    id: "geoboundaries-adm1",
    label: "geoBoundaries ADM1 (open)",
    level: "adm1",
    providerId: "geoboundaries",
    edition: "current",
    license: "CC BY 4.0 / ODbL, per contributing country",
    attribution: "geoBoundaries (William & Mary geoLab)",
    // One request per country: the combined ADM1 file is a bulk download far past the guarded
    // fetch's ceiling, and the per-country files are simplified for exactly this use.
    countries: ["USA", "CAN", "BRA", "IND", "AUS", "ZAF", "JPN", "MEX", "ARG", "IDN"],
    resolveUrls: (country) => `https://www.geoboundaries.org/api/current/gbOpen/${country}/ADM1/`,
    normalize: geoBoundariesRow
  }
];

/** What a run with no arguments imports: everything except the sources that need a decision. */
export function defaultGeoUnitSourceIds(): string[] {
  return GEO_UNIT_SOURCES.filter((source) => !source.optional).map((source) => source.id);
}

export function geoUnitSource(id: string): GeoUnitSource | undefined {
  return GEO_UNIT_SOURCES.find((source) => source.id === id);
}
