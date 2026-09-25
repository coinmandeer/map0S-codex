import { isPointFeature, type Bbox, type GeoFeature } from "@mapos/layer-sdk";
import { fetchJson, fetchText } from "../../utils/upstream.js";
import { countriesForPoint } from "../../data/euCountries.js";
import { bboxCenter, point, withinBbox, type DataSource, type DataSourceResult } from "./types.js";

/**
 * Shared bikes and scooters via GBFS (General Bikeshare Feed Specification).
 *
 * GBFS has no global endpoint — every operator publishes its own feed — so the work is finding
 * which feeds cover the viewport. MobilityData's `systems.csv` is the closest thing to a
 * registry, and it gives a country per system but no coordinates. The strategy:
 *
 *  1. narrow to systems in the country under the viewport,
 *  2. fetch those feeds (capped, in parallel, failures ignored),
 *  3. remember the bbox each system turned out to cover.
 *
 * Step 3 is what stops this from being wasteful: after the first visit to a city, later
 * requests go straight to the feeds known to overlap, and the cap stops mattering.
 */

const SYSTEMS_CSV = "https://raw.githubusercontent.com/MobilityData/gbfs/master/systems.csv";

/** Feeds probed at once while looking for the ones covering a viewport. Small enough to stay a
 *  polite neighbour, large enough that the search finishes in a few rounds. */
const PROBE_BATCH = 6;

/** Hard stop on a cold-cache search, so activating the layer can't hang on a country with a
 *  hundred operators. Whatever was learnt by then is kept and reused. */
const MAX_PROBED_SYSTEMS = 42;

interface GbfsSystem {
  countryCode: string;
  name: string;
  systemId: string;
  discoveryUrl: string;
}

/** Learned coverage per system id, filled in as feeds are fetched. */
const knownCoverage = new Map<
  string,
  { west: number; south: number; east: number; north: number }
>();

let systemsCache: { value: GbfsSystem[]; expiresAt: number } | null = null;

/** systems.csv is a plain RFC 4180 file; fields can be quoted and contain commas. */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      out.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out.map((f) => f.trim());
}

async function loadSystems(signal?: AbortSignal): Promise<GbfsSystem[]> {
  if (systemsCache && systemsCache.expiresAt > Date.now()) return systemsCache.value;

  const text = await fetchText(SYSTEMS_CSV, {
    providerId: "gbfs-registry",
    signal,
    ttlMs: 24 * 3600_000,
    timeoutMs: 15_000,
    maxResponseBytes: 2 * 1024 * 1024,
    acceptedContentTypes: ["text/plain", "text/csv"]
  });

  const [header, ...rows] = text.split(/\r?\n/).filter(Boolean);
  const columns = parseCsvLine(header ?? "");
  const idx = (name: string) => columns.findIndex((c) => c.toLowerCase() === name.toLowerCase());
  const countryAt = idx("Country Code");
  const nameAt = idx("Name");
  const systemAt = idx("System ID");
  const urlAt = idx("Auto-Discovery URL");
  const authAt = idx("Authentication Type");

  const systems = rows.flatMap((row): GbfsSystem[] => {
    const cells = parseCsvLine(row);
    const discoveryUrl = cells[urlAt] ?? "";
    const auth = (cells[authAt] ?? "").toLowerCase();
    // Feeds behind an API key can't be read without registering per operator.
    if (!discoveryUrl.startsWith("https://") || (auth && auth !== "no authentication")) return [];
    return [
      {
        countryCode: (cells[countryAt] ?? "").toUpperCase(),
        name: cells[nameAt] ?? "",
        systemId: cells[systemAt] || discoveryUrl,
        discoveryUrl
      }
    ];
  });

  systemsCache = { value: systems, expiresAt: Date.now() + 24 * 3600_000 };
  return systems;
}

interface GbfsFeedList {
  data?: Record<string, { feeds?: Array<{ name?: string; url?: string }> }> & {
    feeds?: Array<{ name?: string; url?: string }>;
  };
}

/** GBFS 1.x keys feeds by language, 3.x puts them at the top level. Both shapes appear in the
 *  wild, often from the same operator across versions. */
function findFeedUrl(discovery: GbfsFeedList, wanted: string): string | undefined {
  const data = discovery.data;
  if (!data) return undefined;
  if (Array.isArray(data.feeds)) {
    return data.feeds.find((f) => f.name === wanted)?.url;
  }
  for (const value of Object.values(data)) {
    if (value && Array.isArray((value as { feeds?: unknown }).feeds)) {
      const feeds = (value as { feeds: Array<{ name?: string; url?: string }> }).feeds;
      const hit = feeds.find((f) => f.name === wanted)?.url;
      if (hit) return hit;
    }
  }
  return undefined;
}

interface Station {
  station_id?: string;
  name?: string | Array<{ text?: string }>;
  lat?: number;
  lon?: number;
  capacity?: number;
}

interface StationStatus {
  station_id?: string;
  last_reported?: number | string;
  num_vehicles_available?: number;
  num_bikes_available?: number;
  num_docks_available?: number;
  is_installed?: boolean | number;
  is_renting?: boolean | number;
  is_returning?: boolean | number;
}

function stationAvailability(status: StationStatus | undefined, now = Date.now()) {
  const timestamp =
    typeof status?.last_reported === "number"
      ? status.last_reported * 1000
      : Date.parse(status?.last_reported ?? "");
  if (
    !status ||
    !Number.isFinite(timestamp) ||
    now - timestamp > 5 * 60_000 ||
    timestamp > now + 60_000
  )
    return { availabilityStatus: "unknown" };
  const count = (value: unknown) =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
  const flag = (value: unknown) =>
    value === true || value === 1 ? true : value === false || value === 0 ? false : null;
  return {
    availabilityStatus: "reported",
    reportedAt: new Date(timestamp).toISOString(),
    vehiclesAvailable: count(status.num_vehicles_available ?? status.num_bikes_available),
    docksAvailable: count(status.num_docks_available),
    installed: flag(status.is_installed),
    renting: flag(status.is_renting),
    returning: flag(status.is_returning)
  };
}

interface FreeVehicle {
  vehicle_id?: string;
  bike_id?: string;
  station_id?: string;
  lat?: number;
  lon?: number;
  is_reserved?: boolean | number;
  is_disabled?: boolean | number;
  last_reported?: number | string;
  vehicle_type_id?: string;
  current_range_meters?: number;
  current_fuel_percent?: number;
}
interface VehicleFeed {
  last_updated?: number | string;
  data?: { vehicles?: FreeVehicle[]; bikes?: FreeVehicle[] };
}
function freeVehicleFeatures(
  system: GbfsSystem,
  feed: VehicleFeed | null,
  now = Date.now()
): GeoFeature[] {
  const fresh = (stamp: number | string | undefined) =>
    stationAvailability({ last_reported: stamp }, now).availabilityStatus === "reported";
  if (!feed || !fresh(feed.last_updated)) return [];
  return (feed.data?.vehicles ?? feed.data?.bikes ?? []).flatMap((vehicle) => {
    const id = vehicle.vehicle_id ?? vehicle.bike_id;
    if (
      !id ||
      vehicle.station_id ||
      typeof vehicle.lat !== "number" ||
      typeof vehicle.lon !== "number" ||
      !Number.isFinite(vehicle.lat) ||
      !Number.isFinite(vehicle.lon) ||
      Math.abs(vehicle.lat) > 90 ||
      Math.abs(vehicle.lon) > 180 ||
      !(vehicle.is_reserved === false || vehicle.is_reserved === 0) ||
      !(vehicle.is_disabled === false || vehicle.is_disabled === 0) ||
      (vehicle.last_reported !== undefined && !fresh(vehicle.last_reported))
    )
      return [];
    return [
      point(
        `gbfs:${system.systemId}:vehicle:${id}`,
        `${system.name} · volné vozidlo`,
        vehicle.lon,
        vehicle.lat,
        "shared-mobility",
        {
          category: "shared-vehicle",
          operator: system.name,
          availabilityStatus: "reported",
          reportedAt:
            typeof feed.last_updated === "number"
              ? new Date(feed.last_updated * 1000).toISOString()
              : feed.last_updated,
          vehicleTypeId: vehicle.vehicle_type_id ?? null,
          rangeMeters:
            typeof vehicle.current_range_meters === "number" &&
            Number.isFinite(vehicle.current_range_meters) &&
            vehicle.current_range_meters >= 0
              ? vehicle.current_range_meters
              : null,
          sourceUrl: system.discoveryUrl,
          description:
            "Dostupnost podle posledního hlášení do pěti minut. Může se změnit; pronájem ověřte u provozovatele."
        }
      )
    ];
  });
}

/** Global countries from imported boundaries; never probe the entire global registry. */
async function countriesForViewport(bbox: Bbox): Promise<string[]> {
  if (process.env.DATABASE_URL) {
    try {
      const { sql } = await import("../../db/index.js");
      const rows = await sql`SELECT DISTINCT country FROM geo_units
        WHERE level='country' AND country ~ '^[A-Z]{2}$'
        AND ST_Intersects(geom, ST_MakeEnvelope(${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]},4326)) LIMIT 12`;
      if (rows.length) return rows.map((row) => String(row.country));
    } catch {
      /* An unavailable boundary database retains the regional fallback. */
    }
  }
  const { lng, lat } = bboxCenter(bbox);
  return countriesForPoint(lng, lat).map((country) => country.iso);
}

async function loadStations(system: GbfsSystem, signal?: AbortSignal): Promise<GeoFeature[]> {
  const discovery = await fetchJson<GbfsFeedList>(system.discoveryUrl, {
    providerId: "gbfs-discovery",
    signal,
    ttlMs: 6 * 3600_000,
    timeoutMs: 8000
  });

  const optionalFeed = async <T>(name: string, ttlMs: number): Promise<T | null> => {
    const url = findFeedUrl(discovery, name);
    if (!url?.startsWith("https://")) return null;
    try {
      return await fetchJson<T>(url, {
        providerId: `gbfs-${name}`,
        signal,
        ttlMs,
        timeoutMs: 5000,
        retries: 0
      });
    } catch {
      signal?.throwIfAborted();
      return null;
    }
  };
  const [statusFeed, information, stations, vehicles] = await Promise.all([
    optionalFeed<{ data?: { stations?: StationStatus[] } }>("station_status", 30_000),
    optionalFeed<{
      data?: {
        license_id?: string;
        license_url?: string;
        attribution_name?: string;
        attribution_url?: string;
      };
    }>("system_information", 24 * 3600_000),
    optionalFeed<{ data?: { stations?: Station[] } }>("station_information", 10 * 60_000),
    optionalFeed<VehicleFeed>(
      findFeedUrl(discovery, "vehicle_status") ? "vehicle_status" : "free_bike_status",
      30_000
    )
  ]);
  const statuses = new Map(
    (statusFeed?.data?.stations ?? []).map((status) => [status.station_id, status])
  );

  const features: GeoFeature[] = [];
  let west = 180;
  let south = 90;
  let east = -180;
  let north = -90;

  for (const station of stations?.data?.stations ?? []) {
    if (
      !station.station_id ||
      !Number.isFinite(station.lat) ||
      !Number.isFinite(station.lon) ||
      typeof station.lat !== "number" ||
      typeof station.lon !== "number" ||
      Math.abs(station.lat) > 90 ||
      Math.abs(station.lon) > 180
    )
      continue;
    west = Math.min(west, station.lon);
    east = Math.max(east, station.lon);
    south = Math.min(south, station.lat);
    north = Math.max(north, station.lat);

    const name =
      typeof station.name === "string" ? station.name : (station.name?.[0]?.text ?? "Stanice");

    features.push(
      point(
        `gbfs:${system.systemId}:${station.station_id}`,
        name,
        station.lon,
        station.lat,
        "shared-mobility",
        {
          category: "bike-share",
          operator: system.name,
          capacity: station.capacity,
          ...stationAvailability(statuses.get(station.station_id)),
          sourceUrl: system.discoveryUrl,
          license: information?.data?.license_id ?? null,
          licenseUrl: information?.data?.license_url?.startsWith("https://")
            ? information.data.license_url
            : null,
          attribution: information?.data?.attribution_name ?? system.name
        }
      )
    );
  }

  for (const feature of freeVehicleFeatures(system, vehicles)) {
    if (!isPointFeature(feature)) continue;
    const [lng, lat] = feature.geometry.coordinates;
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
    feature.properties.license = information?.data?.license_id ?? null;
    feature.properties.licenseUrl = information?.data?.license_url?.startsWith("https://")
      ? information.data.license_url
      : null;
    feature.properties.attribution = information?.data?.attribution_name ?? system.name;
    features.push(feature);
  }
  if (features.length) knownCoverage.set(system.systemId, { west, south, east, north });
  return features;
}

function covers(systemId: string, bbox: Bbox): boolean {
  const cov = knownCoverage.get(systemId);
  if (!cov) return false;
  const [west, south, east, north] = bbox;
  return cov.west <= east && cov.east >= west && cov.south <= north && cov.north >= south;
}

export const sharedMobility: DataSource = {
  id: "shared-mobility",
  tooLarge: (bbox) =>
    (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]) > 4
      ? "Přibližte mapu na město pro dostupnost sdílených kol."
      : null,
  async load(bbox, _query, signal) {
    signal?.throwIfAborted();
    const countries = await countriesForViewport(bbox);
    if (!countries.length)
      return {
        features: [],
        status: "partial",
        notice: "Pro tuto oblast chybí import hranic států pro výběr poskytovatelů."
      };
    const candidates = (await loadSystems(signal)).filter((s) => countries.includes(s.countryCode));

    // Once a system's coverage is known, a repeat visit costs exactly the feeds that city
    // needs — no searching at all.
    const known = candidates.filter((s) => covers(s.systemId, bbox));
    if (known.length) {
      const result = await fetchAll(known, signal);
      // An incomplete registry cannot establish complete geographic coverage.
      return {
        ...result,
        features: inBbox(bbox, result.features),
        status: "partial",
        notice: result.notice ?? "Načtené známé systémy; úplné pokrytí poskytovatelů není ověřené."
      } as DataSourceResult;
    }

    // Cold cache: systems.csv gives a country but no coordinates, so coverage has to be
    // discovered. Probing in waves and stopping at the end of the wave that first hits the
    // viewport avoids both the naive "try the first N alphabetically" (which never reaches
    // Praha in a list of 45 Czech systems) and fetching every operator in the country.
    const unexplored = candidates
      .filter((s) => !knownCoverage.has(s.systemId))
      .slice(0, MAX_PROBED_SYSTEMS);

    const found: GeoFeature[] = [];
    for (let i = 0; i < unexplored.length; i += PROBE_BATCH) {
      signal?.throwIfAborted();
      const wave = unexplored.slice(i, i + PROBE_BATCH);
      const features = await fetchAll(wave, signal);
      const hits = inBbox(bbox, features.features);
      if (hits.length) {
        found.push(...hits);
        break;
      }
    }
    return {
      features: found,
      status: "partial",
      notice: "Průzkum poskytovatelů je omezený; výsledky nejsou úplným přehledem oblasti."
    };
  }
};

async function fetchAll(systems: GbfsSystem[], signal?: AbortSignal): Promise<DataSourceResult> {
  // One operator's broken feed must not empty the layer for the others sharing the viewport.
  const results = await Promise.allSettled(systems.map((s) => loadStations(s, signal)));
  signal?.throwIfAborted();
  if (results.length && results.every((r) => r.status === "rejected"))
    throw (results[0] as PromiseRejectedResult).reason;
  const failed = results.filter((r) => r.status === "rejected").length;
  return {
    features: results.flatMap((r) => (r.status === "fulfilled" ? r.value : [])),
    status: failed ? "partial" : "complete",
    notice: failed ? `${failed} z ${results.length} poskytovatelů neodpovědělo.` : undefined
  };
}

function inBbox(bbox: Bbox, features: GeoFeature[]): GeoFeature[] {
  // GBFS reports stations, so every feature here is a point.
  return features.filter((f) => {
    if (!isPointFeature(f)) return false;
    const [lng, lat] = f.geometry.coordinates;
    return withinBbox(bbox, lng, lat);
  });
}

export const mobilitySources: DataSource[] = [sharedMobility];

export const __testing = {
  parseCsvLine,
  findFeedUrl,
  knownCoverage,
  stationAvailability,
  freeVehicleFeatures
};
