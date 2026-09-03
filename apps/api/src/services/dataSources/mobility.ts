import { isPointFeature, type Bbox, type GeoFeature } from "@mapos/layer-sdk";
import { fetchJson, fetchText } from "../../utils/upstream.js";
import { countriesForPoint } from "../../data/euCountries.js";
import { bboxCenter, point, withinBbox, type DataSource } from "./types.js";

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

async function loadSystems(): Promise<GbfsSystem[]> {
  if (systemsCache && systemsCache.expiresAt > Date.now()) return systemsCache.value;

  const text = await fetchText(SYSTEMS_CSV, {
    providerId: "gbfs-registry",
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

async function loadStations(system: GbfsSystem): Promise<GeoFeature[]> {
  const discovery = await fetchJson<GbfsFeedList>(system.discoveryUrl, {
    providerId: "gbfs-discovery",
    ttlMs: 6 * 3600_000,
    timeoutMs: 8000
  });

  const stationUrl = findFeedUrl(discovery, "station_information");
  if (!stationUrl) return [];

  const stations = await fetchJson<{ data?: { stations?: Station[] } }>(stationUrl, {
    providerId: "gbfs-stations",
    ttlMs: 10 * 60_000,
    timeoutMs: 8000
  });

  const features: GeoFeature[] = [];
  let west = 180;
  let south = 90;
  let east = -180;
  let north = -90;

  for (const station of stations.data?.stations ?? []) {
    if (typeof station.lat !== "number" || typeof station.lon !== "number") continue;
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
          capacity: station.capacity
        }
      )
    );
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
  async load(bbox) {
    const { lng, lat } = bboxCenter(bbox);
    const countries = countriesForPoint(lng, lat).map((c) => c.iso);
    const candidates = (await loadSystems()).filter((s) => countries.includes(s.countryCode));

    // Once a system's coverage is known, a repeat visit costs exactly the feeds that city
    // needs — no searching at all.
    const known = candidates.filter((s) => covers(s.systemId, bbox));
    if (known.length) {
      return inBbox(bbox, await fetchAll(known));
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
      const wave = unexplored.slice(i, i + PROBE_BATCH);
      const features = await fetchAll(wave);
      const hits = inBbox(bbox, features);
      if (hits.length) {
        found.push(...hits);
        break;
      }
    }
    return found;
  }
};

async function fetchAll(systems: GbfsSystem[]): Promise<GeoFeature[]> {
  // One operator's broken feed must not empty the layer for the others sharing the viewport.
  const results = await Promise.allSettled(systems.map((s) => loadStations(s)));
  return results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
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

export const __testing = { parseCsvLine, findFeedUrl, knownCoverage };
