import { createHash } from "node:crypto";
import type { Bbox, Guide } from "@mapos/layer-sdk";
import { getGuide } from "./guide/index.js";
import { askCml } from "./cmlService.js";
import { fetchJson, fetchText } from "../utils/upstream.js";

export type DiscoverRegionLevel = "country" | "admin1" | "admin2" | "locality" | "neighbourhood";

export interface DiscoverHierarchyItem {
  name: string;
  level: DiscoverRegionLevel;
}

export type DiscoverBoundaryGeometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

export interface ResolvedDiscoverRegion {
  id: string;
  name: string;
  level: DiscoverRegionLevel;
  hierarchy: DiscoverHierarchyItem[];
  countryCode: string | null;
  boundary?: {
    geometry: DiscoverBoundaryGeometry;
    sourceId: typeof NOMINATIM_SOURCE_ID;
  };
  /** Provider joins stay internal; the public region projection is built explicitly below. */
  wikidataId?: string;
  nutsCode?: string;
  populationSeed?: { value: number; year: number | null };
}

export interface DiscoverContextInput {
  lng: number;
  lat: number;
  zoom: number;
  bbox?: Bbox;
  lang?: string;
  useCase?: string;
  activeLayerIds?: string[];
  allowModelFallback?: boolean;
}

export interface DiscoverCitation {
  id: string;
  label: string;
  attribution: string;
  url: string;
  license: string | null;
  fetchedAt: string;
}

export interface DiscoverSynthesis {
  kind: "structured" | "model";
  label: string;
  text: string;
  sourceIds: string[];
  model?: string;
}

export interface DiscoverStatistic {
  /** Stable capability-owned key. The panel renders this generically, so new statistics do not
   * require a fixed UI section. */
  id: string;
  label: string;
  value: number;
  unit: string;
  scope: {
    regionId: string;
    regionName: string;
    level: DiscoverRegionLevel;
    geographicCode?: string;
  };
  year: number | null;
  uncertainty: string;
  uncertaintyLabel: string;
  sourceIds: string[];
}

export interface DiscoverRegionOption {
  id: string;
  code: string;
  name: string;
  nutsLevel: 0 | 1 | 2 | 3;
  geometry: DiscoverBoundaryGeometry;
  sourceId: typeof GISCO_NUTS_SOURCE_ID;
}

export interface DiscoverRegionCatalogue {
  nutsLevel: 0 | 1 | 2 | 3;
  truncated: boolean;
  sourceId: typeof GISCO_NUTS_SOURCE_ID;
  regions: DiscoverRegionOption[];
}

export interface DiscoverContext {
  schemaVersion: "2.0.0";
  key: string;
  generatedAt: string;
  cache: { hit: boolean; expiresAt: string };
  region: Omit<ResolvedDiscoverRegion, "boundary"> | null;
  guide: Guide | null;
  synthesis: DiscoverSynthesis | null;
  statistics: DiscoverStatistic[];
  regionCatalogue: DiscoverRegionCatalogue | null;
  sources: DiscoverCitation[];
  capabilities: Array<{
    id: string;
    label: string;
    kind: DiscoverContextCapabilityKind;
    status: "ready" | "empty" | "error";
    sourceIds: string[];
  }>;
  blocks: Array<{
    id: "region" | "guide" | "statistics" | "model";
    status: "ready" | "empty" | "skipped";
    sourceIds: string[];
  }>;
  boundary: {
    status: "dataset-required" | "ready";
    geometry: DiscoverBoundaryGeometry | null;
    reason: string;
    sourceId: string | null;
  };
  emptyState: null | {
    title: string;
    message: string;
    actions: string[];
  };
}

export interface DiscoverModelResult {
  text: string;
  model: string;
  sourceIds?: string[];
}

export type DiscoverContextCapabilityKind = "guide" | "statistics" | "region-catalogue";

export type DiscoverContextCapabilityResult =
  | { kind: "guide"; value: Guide | null }
  | { kind: "statistics"; value: DiscoverStatistic[] }
  | { kind: "region-catalogue"; value: DiscoverRegionCatalogue | null };

/** Independently registered context source. A failing optional capability is isolated from the
 * remaining context and becomes visible in response diagnostics instead of breaking the panel. */
export interface DiscoverContextCapability {
  id: string;
  label: string;
  kind: DiscoverContextCapabilityKind;
  resolve(
    input: DiscoverContextInput,
    region: ResolvedDiscoverRegion | null,
    signal?: AbortSignal
  ): Promise<DiscoverContextCapabilityResult>;
}

export interface DiscoverContextDependencies {
  resolveRegion(
    input: DiscoverContextInput,
    signal?: AbortSignal
  ): Promise<ResolvedDiscoverRegion | null>;
  resolveGuide(
    input: DiscoverContextInput,
    region: ResolvedDiscoverRegion | null,
    signal?: AbortSignal
  ): Promise<Guide | null>;
  resolveStatistics?: (
    input: DiscoverContextInput,
    region: ResolvedDiscoverRegion | null,
    signal?: AbortSignal
  ) => Promise<DiscoverStatistic[]>;
  resolveRegionCatalogue?: (
    input: DiscoverContextInput,
    region: ResolvedDiscoverRegion | null,
    signal?: AbortSignal
  ) => Promise<DiscoverRegionCatalogue | null>;
  capabilities?: DiscoverContextCapability[];
  synthesize?: (
    input: DiscoverContextInput,
    structured: {
      region: ResolvedDiscoverRegion | null;
      guide: Guide | null;
      statistics: DiscoverStatistic[];
      regionCatalogue: DiscoverRegionCatalogue | null;
      sources: DiscoverCitation[];
    },
    signal?: AbortSignal
  ) => Promise<DiscoverModelResult | null>;
  now?: () => number;
  ttlMs?: number;
}

export function createDiscoverContextCapabilityRegistry(
  capabilities: DiscoverContextCapability[]
): DiscoverContextCapability[] {
  const ids = new Set<string>();
  return capabilities.map((capability) => {
    if (!capability.id.trim() || ids.has(capability.id)) {
      throw new Error(`Duplicate or empty Discover capability id: ${capability.id}`);
    }
    ids.add(capability.id);
    return capability;
  });
}

function capabilitiesFor(dependencies: DiscoverContextDependencies): DiscoverContextCapability[] {
  if (dependencies.capabilities) {
    return createDiscoverContextCapabilityRegistry(dependencies.capabilities);
  }
  return createDiscoverContextCapabilityRegistry([
    {
      id: "guide",
      label: "Zdrojový průvodce",
      kind: "guide",
      resolve: async (input, region, signal) => ({
        kind: "guide",
        value: await dependencies.resolveGuide(input, region, signal)
      })
    },
    ...(dependencies.resolveStatistics
      ? [
          {
            id: "regional-statistics",
            label: "Otevřené statistiky",
            kind: "statistics" as const,
            resolve: async (
              input: DiscoverContextInput,
              region: ResolvedDiscoverRegion | null,
              signal?: AbortSignal
            ) => ({
              kind: "statistics" as const,
              value: await dependencies.resolveStatistics!(input, region, signal)
            })
          }
        ]
      : []),
    ...(dependencies.resolveRegionCatalogue
      ? [
          {
            id: "region-catalogue",
            label: "Správní oblasti",
            kind: "region-catalogue" as const,
            resolve: async (
              input: DiscoverContextInput,
              region: ResolvedDiscoverRegion | null,
              signal?: AbortSignal
            ) => ({
              kind: "region-catalogue" as const,
              value: await dependencies.resolveRegionCatalogue!(input, region, signal)
            })
          }
        ]
      : [])
  ]);
}

export interface DiscoverContextService {
  get(input: DiscoverContextInput, signal?: AbortSignal): Promise<DiscoverContext>;
  clear(): void;
}

interface NominatimReverseResult {
  osm_type?: string;
  osm_id?: number;
  display_name?: string;
  address?: Record<string, string | undefined> & { country_code?: string };
  extratags?: Record<string, string | undefined>;
  geojson?: unknown;
}

const NOMINATIM_SOURCE_ID = "nominatim-osm";
const WIKIDATA_SOURCE_PREFIX = "wikidata:";
const EUROSTAT_GDP_SOURCE_ID = "eurostat:nama_10r_3gdp";
const GISCO_NUTS_SOURCE_ID = "eurostat-gisco-nuts-2024";
const MAX_REGION_OPTIONS = 16;
const MAX_CONTEXT_CACHE_ENTRIES = 256;
const BOUNDARY_GATE_REASON =
  "Administrative boundary geometry is unavailable until a real dataset, ingest/update pipeline and zoom/hit-test policy are configured (GATE-002). A bbox is never substituted for a boundary.";
const BOUNDARY_READY_REASON =
  "Simplified administrative geometry returned by the same cached OpenStreetMap Nominatim reverse lookup.";

const LEVEL_FIELDS: Array<{
  level: DiscoverRegionLevel;
  keys: string[];
}> = [
  { level: "country", keys: ["country"] },
  { level: "admin1", keys: ["state", "region"] },
  { level: "admin2", keys: ["county", "state_district"] },
  { level: "locality", keys: ["municipality", "city", "town", "village"] },
  { level: "neighbourhood", keys: ["city_district", "suburb", "quarter", "neighbourhood"] }
];

function zoomBand(zoom: number): DiscoverRegionLevel {
  if (zoom <= 4) return "country";
  if (zoom <= 7) return "admin1";
  if (zoom <= 10) return "admin2";
  if (zoom <= 13) return "locality";
  return "neighbourhood";
}

function coordinatePrecision(level: DiscoverRegionLevel): number {
  if (level === "country") return 1;
  if (level === "admin1") return 2;
  if (level === "admin2") return 2;
  if (level === "locality") return 3;
  return 4;
}

function reverseZoom(level: DiscoverRegionLevel): number {
  if (level === "country") return 3;
  if (level === "admin1") return 5;
  if (level === "admin2") return 8;
  if (level === "locality") return 10;
  return 14;
}

function polygonThreshold(level: DiscoverRegionLevel): number {
  if (level === "country") return 0.03;
  if (level === "admin1") return 0.01;
  if (level === "admin2") return 0.005;
  if (level === "locality") return 0.001;
  return 0.0005;
}

function boundedPopulation(value: unknown): number | null {
  const parsed =
    typeof value === "string"
      ? Number(value.trim().replaceAll(" ", "").replaceAll(",", ""))
      : Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 20_000_000_000
    ? Math.round(parsed)
    : null;
}

function populationYear(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = value.match(/[+-]?(\d{4})/);
  const year = Number(match?.[1]);
  return Number.isInteger(year) && year >= 1800 && year <= new Date().getUTCFullYear() + 1
    ? year
    : null;
}

export function discoverContextKey(input: DiscoverContextInput): string {
  const band = zoomBand(input.zoom);
  const precision = coordinatePrecision(band);
  const layers = [...new Set(input.activeLayerIds ?? [])].sort().join(",");
  const catalogueExtent =
    giscoNutsLevelForZoom(input.zoom) !== null && validBbox(input.bbox)
      ? input.bbox.map((coordinate) => coordinate.toFixed(precision)).join(",")
      : "no-catalogue-extent";
  return [
    Number(input.lng).toFixed(precision),
    Number(input.lat).toFixed(precision),
    band,
    (input.lang ?? "cs").slice(0, 2).toLowerCase(),
    input.useCase?.trim().toLowerCase() || "general",
    layers,
    catalogueExtent,
    input.allowModelFallback ? "model" : "structured"
  ].join("|");
}

function validBbox(bbox: Bbox | undefined): bbox is Bbox {
  return Boolean(
    bbox &&
    bbox.length === 4 &&
    bbox.every(Number.isFinite) &&
    bbox[0] < bbox[2] &&
    bbox[1] < bbox[3]
  );
}

/** A query extent sized for guide lookup. It is deliberately not boundary geometry. */
export function guideQueryExtent(input: DiscoverContextInput): Bbox {
  if (validBbox(input.bbox)) return input.bbox;
  const halfSpan = Math.max(0.02, Math.min(1, 45 / 2 ** Math.max(1, input.zoom)));
  return [input.lng - halfSpan, input.lat - halfSpan, input.lng + halfSpan, input.lat + halfSpan];
}

function validPosition(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1]) &&
    value[0] >= -180 &&
    value[0] <= 180 &&
    value[1] >= -90 &&
    value[1] <= 90
  );
}

function validRing(value: unknown): value is number[][] {
  if (!Array.isArray(value) || value.length < 4 || !value.every(validPosition)) return false;
  const first = value[0]!;
  const last = value[value.length - 1]!;
  return first[0] === last[0] && first[1] === last[1];
}

export function normalizeNominatimBoundary(value: unknown): DiscoverBoundaryGeometry | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { type?: unknown; coordinates?: unknown };
  if (
    candidate.type === "Polygon" &&
    Array.isArray(candidate.coordinates) &&
    candidate.coordinates.length > 0 &&
    candidate.coordinates.every(validRing)
  ) {
    return candidate as DiscoverBoundaryGeometry;
  }
  if (
    candidate.type === "MultiPolygon" &&
    Array.isArray(candidate.coordinates) &&
    candidate.coordinates.length > 0 &&
    candidate.coordinates.every(
      (polygon) =>
        Array.isArray(polygon) && polygon.length > 0 && polygon.every((ring) => validRing(ring))
    )
  ) {
    return candidate as DiscoverBoundaryGeometry;
  }
  return null;
}

export function normalizeNominatimRegion(
  value: NominatimReverseResult | null | undefined,
  preferredLevel?: DiscoverRegionLevel
): ResolvedDiscoverRegion | null {
  if (!value?.address) return null;
  const hierarchy: DiscoverHierarchyItem[] = [];
  const seen = new Set<string>();
  for (const group of LEVEL_FIELDS) {
    const name = group.keys.map((key) => value.address?.[key]?.trim()).find(Boolean);
    if (!name || seen.has(name.toLocaleLowerCase())) continue;
    seen.add(name.toLocaleLowerCase());
    hierarchy.push({ name, level: group.level });
  }
  const selectedIndex = preferredLevel
    ? hierarchy.findIndex((item) => item.level === preferredLevel)
    : hierarchy.length - 1;
  const resolvedIndex = selectedIndex >= 0 ? selectedIndex : hierarchy.length - 1;
  const selected = hierarchy[resolvedIndex];
  if (!selected) return null;
  const selectedHierarchy = hierarchy.slice(0, resolvedIndex + 1);
  const sourceId =
    value.osm_type && Number.isFinite(value.osm_id)
      ? `${value.osm_type}:${value.osm_id}`
      : `point:${selected.name.toLocaleLowerCase()}`;
  const code = value.address.country_code?.trim().toUpperCase() ?? null;
  const geometry = normalizeNominatimBoundary(value.geojson);
  const wikidataId = value.extratags?.wikidata?.trim();
  const nutsCode = [value.extratags?.["ref:nuts:3"], value.extratags?.["ref:nuts"]]
    .map((candidate) => candidate?.trim().toUpperCase())
    .find((candidate) => candidate && /^[A-Z]{2}[A-Z0-9]{3}$/u.test(candidate));
  const osmPopulation = boundedPopulation(value.extratags?.population);
  return {
    id: `nominatim:${sourceId}`,
    name: selected.name,
    level: selected.level,
    hierarchy: selectedHierarchy,
    countryCode: code && code.length === 2 ? code : null,
    ...(geometry ? { boundary: { geometry, sourceId: NOMINATIM_SOURCE_ID } } : {}),
    ...(wikidataId && /^Q[1-9]\d{0,11}$/u.test(wikidataId) ? { wikidataId } : {}),
    ...(nutsCode ? { nutsCode } : {}),
    ...(osmPopulation
      ? {
          populationSeed: {
            value: osmPopulation,
            year: populationYear(value.extratags?.["population:date"])
          }
        }
      : {})
  };
}

export async function resolveDiscoverRegion(
  input: DiscoverContextInput,
  signal?: AbortSignal
): Promise<ResolvedDiscoverRegion | null> {
  try {
    if (signal?.aborted) return null;
    const level = zoomBand(input.zoom);
    const params = new URLSearchParams({
      format: "jsonv2",
      lat: String(input.lat),
      lon: String(input.lng),
      zoom: String(reverseZoom(level)),
      addressdetails: "1",
      extratags: "1",
      polygon_geojson: "1",
      polygon_threshold: String(polygonThreshold(level)),
      "accept-language": (input.lang ?? "cs").slice(0, 2).toLowerCase()
    });
    const value = await fetchJson<NominatimReverseResult>(
      `https://nominatim.openstreetmap.org/reverse?${params}`,
      {
        providerId: "nominatim",
        ttlMs: 24 * 60 * 60_000,
        timeoutMs: 6_000,
        minIntervalMs: 1_100,
        maxResponseBytes: 1024 * 1024
      }
    );
    if (signal?.aborted) return null;
    return normalizeNominatimRegion(value, level);
  } catch {
    return null;
  }
}

export async function resolveDiscoverGuide(
  input: DiscoverContextInput,
  region: ResolvedDiscoverRegion | null,
  signal?: AbortSignal
): Promise<Guide | null> {
  return getGuide(
    {
      bbox: guideQueryExtent(input),
      lang: (input.lang ?? "cs").slice(0, 2).toLowerCase(),
      name: region?.name
    },
    signal
  );
}

interface GiscoNutsFeatureCollection {
  numberMatched?: unknown;
  features?: Array<{
    type?: unknown;
    properties?: { nuts_id?: unknown; levl_code?: unknown };
    geometry?: unknown;
  }>;
}

interface EurostatRegionLabels {
  dimension?: {
    geo?: { category?: { label?: unknown } };
  };
}

/** One statistical boundary level is visible at a time; local/city zoom stays on Nominatim. */
export function giscoNutsLevelForZoom(zoom: number): 0 | 1 | 2 | 3 | null {
  if (zoom <= 4) return 0;
  if (zoom <= 5.5) return 1;
  if (zoom <= 6.5) return 2;
  if (zoom <= 10) return 3;
  return null;
}

function selectedNutsCode(
  region: ResolvedDiscoverRegion | null,
  nutsLevel: 0 | 1 | 2 | 3
): string | null {
  if (region?.nutsCode) return region.nutsCode.slice(0, 2 + nutsLevel);
  return nutsLevel === 0 ? (region?.countryCode ?? null) : null;
}

function regionLabelMap(value: unknown): Readonly<Record<string, string>> {
  const labels = (value as EurostatRegionLabels | null)?.dimension?.geo?.category?.label;
  if (!labels || typeof labels !== "object" || Array.isArray(labels)) return {};
  return Object.fromEntries(
    Object.entries(labels).flatMap(([code, label]) =>
      /^[A-Z]{2}[A-Z0-9]{0,3}$/u.test(code) && typeof label === "string" && label.trim()
        ? [[code, label.trim()]]
        : []
    )
  );
}

export function normalizeGiscoRegionCatalogue(
  value: unknown,
  nutsLevel: 0 | 1 | 2 | 3,
  labels: Readonly<Record<string, string>> = {},
  selectedCode: string | null = null
): DiscoverRegionCatalogue | null {
  const collection = value as GiscoNutsFeatureCollection | null;
  if (!collection || !Array.isArray(collection.features)) return null;
  const seen = new Set<string>();
  const regions: DiscoverRegionOption[] = [];
  for (const feature of collection.features) {
    const code = feature.properties?.nuts_id;
    const level = Number(feature.properties?.levl_code);
    const geometry = normalizeNominatimBoundary(feature.geometry);
    if (
      typeof code !== "string" ||
      !/^[A-Z]{2}[A-Z0-9]{0,3}$/u.test(code) ||
      level !== nutsLevel ||
      code === selectedCode ||
      seen.has(code) ||
      !geometry
    ) {
      continue;
    }
    seen.add(code);
    regions.push({
      id: `nuts:${code}`,
      code,
      name: labels[code] ?? code,
      nutsLevel,
      geometry,
      sourceId: GISCO_NUTS_SOURCE_ID
    });
    if (regions.length >= MAX_REGION_OPTIONS) break;
  }
  if (!regions.length) return null;
  const matched = Number(collection.numberMatched);
  return {
    nutsLevel,
    truncated: Number.isFinite(matched) && matched > collection.features.length,
    sourceId: GISCO_NUTS_SOURCE_ID,
    regions
  };
}

export async function resolveDiscoverRegionCatalogue(
  input: DiscoverContextInput,
  region: ResolvedDiscoverRegion | null,
  signal?: AbortSignal
): Promise<DiscoverRegionCatalogue | null> {
  const nutsLevel = giscoNutsLevelForZoom(input.zoom);
  if (nutsLevel === null || signal?.aborted) return null;
  const bbox = validBbox(input.bbox) ? input.bbox : guideQueryExtent(input);
  const params = new URLSearchParams({
    bbox: bbox.map((coordinate) => coordinate.toFixed(4)).join(","),
    limit: String(MAX_REGION_OPTIONS + 1),
    levl_code: String(nutsLevel)
  });
  try {
    const raw = await fetchText(
      `https://gisco-services.ec.europa.eu/features/collections/gisco.nuts_rg_20m_2024_4326/items.json?${params}`,
      {
        providerId: "eurostat-gisco-nuts",
        ttlMs: 7 * 24 * 60 * 60_000,
        timeoutMs: 8_000,
        minIntervalMs: 250,
        maxResponseBytes: 256 * 1024,
        acceptedContentTypes: ["application/geo+json", "application/json"],
        signal
      }
    );
    const features = JSON.parse(raw) as GiscoNutsFeatureCollection;
    const codes = [
      ...new Set(
        (features.features ?? []).flatMap((feature) => {
          const code = feature.properties?.nuts_id;
          return typeof code === "string" && /^[A-Z]{2}[A-Z0-9]{0,3}$/u.test(code) ? [code] : [];
        })
      )
    ].slice(0, MAX_REGION_OPTIONS + 1);
    const labelParams = new URLSearchParams({
      format: "JSON",
      lang: "en",
      freq: "A",
      unit: "EUR_HAB",
      lastTimePeriod: "1"
    });
    codes.forEach((code) => labelParams.append("geo", code));
    const labelResponse = codes.length
      ? await fetchJson<unknown>(
          `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/nama_10r_3gdp?${labelParams}`,
          {
            providerId: "eurostat-region-labels",
            ttlMs: 7 * 24 * 60 * 60_000,
            timeoutMs: 8_000,
            minIntervalMs: 250,
            maxResponseBytes: 64 * 1024,
            headers: { accept: "application/json" },
            signal
          }
        ).catch(() => null)
      : null;
    if (signal?.aborted) return null;
    return normalizeGiscoRegionCatalogue(
      features,
      nutsLevel,
      regionLabelMap(labelResponse),
      selectedNutsCode(region, nutsLevel)
    );
  } catch {
    return null;
  }
}

interface WikidataRestStatement {
  rank?: string;
  property?: { id?: string };
  value?: { type?: string; content?: { amount?: string } };
  qualifiers?: Array<{
    property?: { id?: string };
    value?: { type?: string; content?: { time?: string } };
  }>;
}

/** Selects the newest non-deprecated population statement and keeps its point-in-time year. */
export function latestWikidataPopulation(value: unknown): { value: number; year: number } | null {
  if (!value || typeof value !== "object") return null;
  const statements = (value as Record<string, unknown>).P1082;
  if (!Array.isArray(statements)) return null;
  const candidates = statements
    .filter(
      (statement): statement is WikidataRestStatement =>
        Boolean(statement && typeof statement === "object") &&
        (statement as WikidataRestStatement).rank !== "deprecated"
    )
    .map((statement) => {
      const population = boundedPopulation(statement.value?.content?.amount);
      const pointInTime = statement.qualifiers?.find(
        (qualifier) => qualifier.property?.id === "P585"
      )?.value?.content?.time;
      const year = populationYear(pointInTime);
      return population && year
        ? { value: population, year, preferred: statement.rank === "preferred" }
        : null;
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));
  const latest = candidates.sort(
    (left, right) => right.year - left.year || Number(right.preferred) - Number(left.preferred)
  )[0];
  return latest ? { value: latest.value, year: latest.year } : null;
}

interface EurostatJsonStat {
  id?: unknown;
  size?: unknown;
  value?: unknown;
  dimension?: {
    time?: { category?: { index?: unknown } };
  };
}

/** The request is filtered to a single NUTS region/unit/latest period, so exactly one cell is valid. */
export function latestEurostatGdpPerCapita(value: unknown): { value: number; year: number } | null {
  if (!value || typeof value !== "object") return null;
  const dataset = value as EurostatJsonStat;
  if (
    !Array.isArray(dataset.id) ||
    !dataset.id.includes("time") ||
    !Array.isArray(dataset.size) ||
    dataset.size.some((size) => size !== 1)
  ) {
    return null;
  }
  const timeIndex = dataset.dimension?.time?.category?.index;
  const yearText =
    timeIndex && typeof timeIndex === "object" && !Array.isArray(timeIndex)
      ? Object.keys(timeIndex)[0]
      : Array.isArray(timeIndex)
        ? timeIndex[0]
        : null;
  const year = populationYear(yearText);
  const rawValue =
    dataset.value && typeof dataset.value === "object" && !Array.isArray(dataset.value)
      ? Object.values(dataset.value)[0]
      : Array.isArray(dataset.value)
        ? dataset.value[0]
        : null;
  const amount = Number(rawValue);
  return year && Number.isFinite(amount) && amount > 0 && amount < 10_000_000
    ? { value: Math.round(amount), year }
    : null;
}

function populationStatistic(
  region: ResolvedDiscoverRegion,
  population: { value: number; year: number | null },
  sourceId: string
): DiscoverStatistic {
  return {
    id: "population",
    label: "Počet obyvatel",
    value: population.value,
    unit: "people",
    scope: { regionId: region.id, regionName: region.name, level: region.level },
    year: population.year,
    uncertainty: "reported-community-data",
    uncertaintyLabel:
      "Publikovaný údaj z otevřených komunitních dat; může se lišit od aktuální oficiální statistiky.",
    sourceIds: [sourceId]
  };
}

function gdpPerCapitaStatistic(
  region: ResolvedDiscoverRegion,
  amount: { value: number; year: number }
): DiscoverStatistic {
  return {
    id: "gdp-per-capita",
    label: "Regionální HDP na obyvatele",
    value: amount.value,
    unit: "eur-per-person",
    scope: {
      regionId: region.id,
      regionName: region.name,
      level: region.level,
      ...(region.nutsCode ? { geographicCode: region.nutsCode } : {})
    },
    year: amount.year,
    uncertainty: "regional-aggregate",
    uncertaintyLabel:
      "Roční regionální agregát v běžných cenách; není to průměrná mzda domácnosti ani předpověď.",
    sourceIds: [EUROSTAT_GDP_SOURCE_ID]
  };
}

export async function resolveDiscoverStatistics(
  _input: DiscoverContextInput,
  region: ResolvedDiscoverRegion | null,
  signal?: AbortSignal
): Promise<DiscoverStatistic[]> {
  if (!region || signal?.aborted) return [];
  const entityId = region.wikidataId;
  const [wikidataResult, eurostatResult] = await Promise.all([
    entityId
      ? fetchJson<unknown>(
          `https://www.wikidata.org/w/rest.php/wikibase/v1/entities/items/${entityId}/statements`,
          {
            providerId: "wikidata-statements",
            ttlMs: 7 * 24 * 60 * 60_000,
            timeoutMs: 8_000,
            minIntervalMs: 250,
            maxResponseBytes: 512 * 1024,
            headers: { accept: "application/json" },
            signal
          }
        ).catch(() => null)
      : Promise.resolve(null),
    region.nutsCode
      ? fetchJson<unknown>(
          `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/nama_10r_3gdp?format=JSON&lang=en&freq=A&geo=${encodeURIComponent(region.nutsCode)}&unit=EUR_HAB&lastTimePeriod=1`,
          {
            providerId: "eurostat-regional-gdp",
            ttlMs: 7 * 24 * 60 * 60_000,
            timeoutMs: 8_000,
            minIntervalMs: 250,
            maxResponseBytes: 128 * 1024,
            headers: { accept: "application/json" },
            signal
          }
        ).catch(() => null)
      : Promise.resolve(null)
  ]);
  if (signal?.aborted) return [];

  const statistics: DiscoverStatistic[] = [];
  const wikidataPopulation = latestWikidataPopulation(wikidataResult);
  if (wikidataPopulation && entityId) {
    statistics.push(
      populationStatistic(region, wikidataPopulation, `${WIKIDATA_SOURCE_PREFIX}${entityId}`)
    );
  } else if (region.populationSeed) {
    statistics.push(populationStatistic(region, region.populationSeed, NOMINATIM_SOURCE_ID));
  }
  const eurostatGdp = latestEurostatGdpPerCapita(eurostatResult);
  if (eurostatGdp) statistics.push(gdpPerCapitaStatistic(region, eurostatGdp));
  return statistics;
}

function sourceCitations(
  region: ResolvedDiscoverRegion | null,
  guide: Guide | null,
  statistics: DiscoverStatistic[],
  regionCatalogue: DiscoverRegionCatalogue | null,
  fetchedAt: string
): DiscoverCitation[] {
  const sources: DiscoverCitation[] = [];
  if (region) {
    sources.push({
      id: NOMINATIM_SOURCE_ID,
      label: "OpenStreetMap Nominatim",
      attribution: "© OpenStreetMap přispěvatelé",
      url: "https://www.openstreetmap.org/copyright",
      license: "ODbL 1.0",
      fetchedAt
    });
  }
  if (guide) {
    sources.push({
      id: `guide:${guide.sourceId}`,
      label: guide.sourceId,
      attribution: guide.attribution,
      url: guide.url ?? "https://www.wikivoyage.org/",
      license: null,
      fetchedAt
    });
  }
  for (const sourceId of new Set(statistics.flatMap((statistic) => statistic.sourceIds))) {
    if (!sourceId.startsWith(WIKIDATA_SOURCE_PREFIX)) continue;
    const entityId = sourceId.slice(WIKIDATA_SOURCE_PREFIX.length);
    sources.push({
      id: sourceId,
      label: "Wikidata",
      attribution: "Wikidata contributors",
      url: `https://www.wikidata.org/wiki/${entityId}`,
      license: "CC0 1.0",
      fetchedAt
    });
  }
  if (statistics.some((statistic) => statistic.sourceIds.includes(EUROSTAT_GDP_SOURCE_ID))) {
    sources.push({
      id: EUROSTAT_GDP_SOURCE_ID,
      label: "Eurostat · nama_10r_3gdp",
      attribution: "Eurostat regional accounts",
      url: "https://ec.europa.eu/eurostat/databrowser/view/nama_10r_3gdp/default/table",
      license: "Eurostat reuse policy",
      fetchedAt
    });
  }
  if (regionCatalogue?.regions.length) {
    sources.push({
      id: GISCO_NUTS_SOURCE_ID,
      label: "Eurostat GISCO · NUTS 2024",
      attribution: "European Commission — Eurostat/GISCO",
      url: "https://ec.europa.eu/eurostat/web/gisco/geodata/statistical-units/territorial-units-statistics",
      license: "GISCO/NUTS reuse notice (advisory)",
      fetchedAt
    });
  }
  return sources;
}

function structuredSynthesis(
  region: ResolvedDiscoverRegion | null,
  guide: Guide | null
): DiscoverSynthesis | null {
  const intro = guide?.sections.map((section) => section.intro?.trim()).find(Boolean);
  if (guide) {
    return {
      kind: "structured",
      label: "Zdrojový průvodce",
      text: intro ?? `Pro ${guide.area} jsou k dispozici ověřitelné tipy ve zdrojovém průvodci.`,
      sourceIds: [`guide:${guide.sourceId}`]
    };
  }
  if (region) {
    return {
      kind: "structured",
      label: "Kontext mapy",
      text: `Střed mapy leží v oblasti ${region.name}. Zapni datové vrstvy nebo použij ruční obnovení pro další ověřitelné informace.`,
      sourceIds: [NOMINATIM_SOURCE_ID]
    };
  }
  return null;
}

/** Builds an optional, source-aware guide summary from public context only. The browser cannot
 * inject private profile or plan data into this projection, and the response remains visibly
 * labelled as model output. */
export async function synthesizeDiscoverContext(
  input: DiscoverContextInput,
  structured: {
    region: ResolvedDiscoverRegion | null;
    guide: Guide | null;
    statistics: DiscoverStatistic[];
    regionCatalogue: DiscoverRegionCatalogue | null;
    sources: DiscoverCitation[];
  },
  signal?: AbortSignal
): Promise<DiscoverModelResult | null> {
  const publicContext = {
    center: {
      longitude: Number(input.lng.toFixed(4)),
      latitude: Number(input.lat.toFixed(4)),
      zoom: Number(input.zoom.toFixed(1))
    },
    useCase: input.useCase?.trim().slice(0, 80) || "discover",
    activeLayerIds: [...new Set(input.activeLayerIds ?? [])].slice(0, 40),
    region: structured.region
      ? {
          name: structured.region.name,
          level: structured.region.level,
          countryCode: structured.region.countryCode,
          hierarchy: structured.region.hierarchy
        }
      : null,
    guide: structured.guide
      ? {
          area: structured.guide.area,
          sections: structured.guide.sections.slice(0, 12).map((section) => ({
            title: section.title,
            intro: section.intro?.slice(0, 1_200),
            items: section.items.slice(0, 12).map((item) => ({
              name: item.name,
              description: item.description?.slice(0, 500)
            }))
          }))
        }
      : null,
    statistics: structured.statistics.map((statistic) => ({
      id: statistic.id,
      value: statistic.value,
      unit: statistic.unit,
      scope: statistic.scope,
      year: statistic.year,
      uncertainty: statistic.uncertainty
    })),
    regionOptions:
      structured.regionCatalogue?.regions.map((candidate) => ({
        code: candidate.code,
        name: candidate.name,
        nutsLevel: candidate.nutsLevel
      })) ?? [],
    sources: structured.sources.map((source) => ({ id: source.id, label: source.label }))
  };
  const digest = createHash("sha256").update(JSON.stringify(publicContext)).digest("hex");
  const answer = await askCml({
    cacheKey: `discover:${digest}`,
    verifiedPublic: true,
    system: [
      "Jsi stručný mapový průvodce MapOS. Odpovídej česky ve 2 až 4 krátkých větách.",
      "Používej pouze dodaný veřejný kontext. Nevymýšlej aktuální fakta, ceny, otevírací dobu ani konkrétní místa.",
      "Když zdroje nestačí, napiš obecný GPS-aware návrh a jasně přiznej omezení.",
      "Zohledni use case a aktivní vrstvy, ale netvrď, že jejich data byla prohledána, pokud v kontextu nejsou."
    ].join(" "),
    prompt: JSON.stringify(publicContext),
    maxTokens: 420,
    temperature: 0.25,
    ttlMs: 30 * 60_000,
    signal
  });
  return answer
    ? {
        text: answer.text,
        model: answer.model,
        sourceIds: structured.sources.map((source) => source.id)
      }
    : null;
}

function withCacheMetadata(
  context: DiscoverContext,
  hit: boolean,
  expiresAt: number
): DiscoverContext {
  return {
    ...context,
    cache: { hit, expiresAt: new Date(expiresAt).toISOString() }
  };
}

export function createDiscoverContextService(
  dependencies: DiscoverContextDependencies
): DiscoverContextService {
  const now = dependencies.now ?? Date.now;
  const ttlMs = dependencies.ttlMs ?? 15 * 60_000;
  const registeredCapabilities = capabilitiesFor(dependencies);
  const cache = new Map<string, { expiresAt: number; value: DiscoverContext }>();
  const pending = new Map<string, Promise<DiscoverContext>>();

  const get = async (input: DiscoverContextInput, signal?: AbortSignal) => {
    const key = discoverContextKey(input);
    const cached = cache.get(key);
    const currentTime = now();
    if (cached && cached.expiresAt > currentTime) {
      return withCacheMetadata(cached.value, true, cached.expiresAt);
    }
    const existing = pending.get(key);
    if (existing) return existing;

    const work = (async (): Promise<DiscoverContext> => {
      // Ordering is intentional: structured sources are exhausted before the optional model seam.
      const region = await dependencies.resolveRegion(input, signal);
      const capabilitySettled = await Promise.allSettled(
        registeredCapabilities.map((capability) => capability.resolve(input, region, signal))
      );
      let guide: Guide | null = null;
      const statistics: DiscoverStatistic[] = [];
      let regionCatalogue: DiscoverRegionCatalogue | null = null;
      const capabilityRuns: Array<
        DiscoverContextCapability & {
          status: "ready" | "empty" | "error";
          sourceIds: string[];
        }
      > = [];
      for (const [index, capability] of registeredCapabilities.entries()) {
        const settled = capabilitySettled[index]!;
        if (settled.status === "rejected") {
          capabilityRuns.push({ ...capability, status: "error", sourceIds: [] });
          continue;
        }
        const result = settled.value;
        if (result.kind === "guide" && result.value && !guide) guide = result.value;
        if (result.kind === "statistics") statistics.push(...result.value);
        if (result.kind === "region-catalogue" && result.value && !regionCatalogue) {
          regionCatalogue = result.value;
        }
        const sourceIds =
          result.kind === "guide"
            ? result.value
              ? [`guide:${result.value.sourceId}`]
              : []
            : result.kind === "statistics"
              ? [...new Set(result.value.flatMap((statistic) => statistic.sourceIds))]
              : result.value
                ? [result.value.sourceId]
                : [];
        const hasValue =
          result.kind === "statistics" ? result.value.length > 0 : result.value !== null;
        capabilityRuns.push({
          ...capability,
          status: hasValue ? "ready" : "empty",
          sourceIds
        });
      }
      const fetchedAt = new Date(now()).toISOString();
      const sources = sourceCitations(region, guide, statistics, regionCatalogue, fetchedAt);
      let synthesis = structuredSynthesis(region, guide);
      let modelStatus: "ready" | "empty" | "skipped" = "skipped";

      if (input.allowModelFallback && dependencies.synthesize) {
        const model = await dependencies.synthesize(
          input,
          { region, guide, statistics, regionCatalogue, sources },
          signal
        );
        const knownSourceIds = new Set(sources.map((source) => source.id));
        const claimed = (model?.sourceIds ?? []).filter((id) => knownSourceIds.has(id));
        if (model?.text.trim()) {
          synthesis = {
            kind: "model",
            label: claimed.length
              ? "Modelové shrnutí ze zdrojů"
              : "Modelový návrh bez ověřených místních faktů",
            text: model.text.trim(),
            sourceIds: claimed,
            model: model.model
          };
          modelStatus = "ready";
        } else {
          modelStatus = "empty";
        }
      }

      const generatedAt = new Date(now()).toISOString();
      const expiresAt = now() + ttlMs;
      const publicRegion = region
        ? {
            id: region.id,
            name: region.name,
            level: region.level,
            hierarchy: region.hierarchy,
            countryCode: region.countryCode
          }
        : null;
      const context: DiscoverContext = {
        schemaVersion: "2.0.0",
        key,
        generatedAt,
        cache: { hit: false, expiresAt: new Date(expiresAt).toISOString() },
        region: publicRegion,
        guide,
        synthesis,
        statistics,
        regionCatalogue,
        sources,
        capabilities: capabilityRuns.map(({ id, label, kind, status, sourceIds }) => ({
          id,
          label,
          kind,
          status,
          sourceIds
        })),
        blocks: [
          {
            id: "region",
            status: region ? "ready" : "empty",
            sourceIds: [
              ...(region ? [NOMINATIM_SOURCE_ID] : []),
              ...(regionCatalogue?.regions.length ? [GISCO_NUTS_SOURCE_ID] : [])
            ]
          },
          {
            id: "guide",
            status: guide ? "ready" : "empty",
            sourceIds: guide ? [`guide:${guide.sourceId}`] : []
          },
          {
            id: "statistics",
            status: statistics.length ? "ready" : "empty",
            sourceIds: [...new Set(statistics.flatMap((statistic) => statistic.sourceIds))]
          },
          {
            id: "model",
            status: modelStatus,
            sourceIds: synthesis?.kind === "model" ? synthesis.sourceIds : []
          }
        ],
        boundary: region?.boundary
          ? {
              status: "ready",
              geometry: region.boundary.geometry,
              reason: BOUNDARY_READY_REASON,
              sourceId: region.boundary.sourceId
            }
          : {
              status: "dataset-required",
              geometry: null,
              reason: BOUNDARY_GATE_REASON,
              sourceId: null
            },
        emptyState: synthesis
          ? null
          : {
              title: "Mapa zůstává připravená",
              message:
                "Pro tento výřez zatím nemáme dost citovatelných podkladů. Body na mapě jsou stále použitelné a kontext lze obnovit po posunu.",
              actions: [
                "Zapnout relevantní vrstvu",
                "Posunout nebo přiblížit mapu",
                "Přidat ověřený zdroj"
              ]
            }
      };
      if (cache.size >= MAX_CONTEXT_CACHE_ENTRIES) {
        const oldest = cache.keys().next().value;
        if (oldest) cache.delete(oldest);
      }
      cache.set(key, { expiresAt, value: context });
      return context;
    })().finally(() => pending.delete(key));

    pending.set(key, work);
    return work;
  };

  return {
    get,
    clear() {
      cache.clear();
      pending.clear();
    }
  };
}

export const discoverContextService = createDiscoverContextService({
  resolveRegion: resolveDiscoverRegion,
  resolveGuide: resolveDiscoverGuide,
  capabilities: [
    {
      id: "guide",
      label: "Zdrojový průvodce",
      kind: "guide",
      resolve: async (input, region, signal) => ({
        kind: "guide",
        value: await resolveDiscoverGuide(input, region, signal)
      })
    },
    {
      id: "regional-statistics",
      label: "Obyvatelstvo a ekonomika",
      kind: "statistics",
      resolve: async (input, region, signal) => ({
        kind: "statistics",
        value: await resolveDiscoverStatistics(input, region, signal)
      })
    },
    {
      id: "region-catalogue",
      label: "Správní oblasti",
      kind: "region-catalogue",
      resolve: async (input, region, signal) => ({
        kind: "region-catalogue",
        value: await resolveDiscoverRegionCatalogue(input, region, signal)
      })
    }
  ],
  synthesize: synthesizeDiscoverContext
});

/** Deterministic no-network service for the explicit offline fixture composition. */
export function createOfflineDiscoverContextService(): DiscoverContextService {
  return createDiscoverContextService({
    resolveRegion: async () => null,
    resolveGuide: async () => null,
    now: () => Date.parse("2026-09-01T12:00:00.000Z")
  });
}

export async function reverseGeocodeCountry(lng: number, lat: number): Promise<string | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=3&addressdetails=1`;
    const data = await fetchJson<{ address?: { country_code?: string } }>(url, {
      providerId: "nominatim",
      ttlMs: 24 * 60 * 60_000,
      timeoutMs: 6_000,
      minIntervalMs: 1_100,
      maxResponseBytes: 256 * 1024
    });
    const code = data.address?.country_code?.toUpperCase();
    return code && code.length === 2 ? code : null;
  } catch {
    return null;
  }
}

/**
 * The town or village a point sits in.
 *
 * Names repeat across the country, and a model handed only a name fills in the place it happens
 * to know: asked about Riegrovy sady in Plzeň it wrote about the Prague park of the same name,
 * Vinohrady and Žižkov included. Saying where we are removes the guess.
 */
export async function reverseGeocodePlaceName(lng: number, lat: number): Promise<string | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=12&addressdetails=1`;
    const data = await fetchJson<{
      address?: { city?: string; town?: string; village?: string; municipality?: string };
    }>(url, {
      providerId: "nominatim",
      ttlMs: 24 * 60 * 60_000,
      timeoutMs: 6_000,
      minIntervalMs: 1_100,
      maxResponseBytes: 256 * 1024
    });
    const a = data.address;
    return a?.city || a?.town || a?.village || a?.municipality || null;
  } catch {
    return null;
  }
}

export async function loadWikipediaPois(bounds: {
  west: number;
  south: number;
  east: number;
  north: number;
}) {
  const { west, south, east, north } = bounds;
  const centerLat = (south + north) / 2;
  const centerLng = (west + east) / 2;
  const url = `https://en.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=${centerLat}|${centerLng}&gsradius=25000&gslimit=20&format=json&origin=*`;
  try {
    const data = await fetchJson<{
      query?: {
        geosearch?: Array<{
          pageid: number;
          title: string;
          lat: number;
          lon: number;
          dist: number;
        }>;
      };
    }>(url, {
      providerId: "wikipedia-geosearch",
      ttlMs: 60 * 60_000,
      timeoutMs: 8_000,
      minIntervalMs: 100,
      maxResponseBytes: 512 * 1024
    });
    return (data.query?.geosearch ?? [])
      .filter((p) => p.lon >= west && p.lon <= east && p.lat >= south && p.lat <= north)
      .map((p) => ({
        pageId: p.pageid,
        title: p.title,
        lng: p.lon,
        lat: p.lat,
        distanceM: p.dist
      }));
  } catch {
    return [];
  }
}
