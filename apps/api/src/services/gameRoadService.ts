import type { Bbox } from "@mapos/layer-sdk";
import { ClientError } from "../utils/clientError.js";
import { fetchOverpass } from "../utils/overpass.js";

const CACHE_TTL_MS = 24 * 3600_000;
const cache = new Map<string, { at: number; roads: GameRoadFeature[]; bytes: number }>();
let cacheBytes = 0;
const CACHE_MAX_BYTES = 16 * 1024 * 1024;

export interface GameRoadFeature {
  id: string;
  geometry: { type: "LineString"; coordinates: [number, number][] };
  layer: { id: "road_highway" };
  osmWayId?: number;
  nodeIds?: number[];
  tags?: Record<string, string>;
}

function validateBbox(bbox: Bbox) {
  const [west, south, east, north] = bbox;
  if (
    ![west, south, east, north].every(Number.isFinite) ||
    west >= east ||
    south >= north ||
    west < -180 ||
    east > 180 ||
    south < -90 ||
    north > 90
  ) {
    throw new ClientError("Neplatný výřez silničního pole");
  }
  if (east - west > 0.04 || north - south > 0.04) {
    throw new ClientError("Silniční pole je příliš velké");
  }
}

const WALK_HIGHWAYS = new Set([
  "footway",
  "path",
  "pedestrian",
  "steps",
  "living_street",
  "residential",
  "unclassified"
]);
const ALLOWED_ACCESS = new Set(["yes", "designated", "permissive"]);
export function permitsFoot(tags: Record<string, string>): boolean {
  if (
    tags["access:conditional"] ||
    tags["foot:conditional"] ||
    tags.highway === "construction" ||
    tags.highway === "proposed"
  )
    return false;
  if (tags.foot && !ALLOWED_ACCESS.has(tags.foot)) return false;
  if (tags.access && !ALLOWED_ACCESS.has(tags.access) && !ALLOWED_ACCESS.has(tags.foot ?? ""))
    return false;
  return (
    WALK_HIGHWAYS.has(tags.highway ?? "") ||
    (["track", "cycleway", "service"].includes(tags.highway ?? "") &&
      ALLOWED_ACCESS.has(tags.foot ?? ""))
  );
}
interface RoadElement {
  type?: string;
  id?: number;
  nodes?: number[];
  tags?: Record<string, string>;
  geometry?: Array<{ lon?: number; lat?: number }>;
}
/** Preserve original node topology; never join geometric crossings at different elevations. */
export function walkableRoads(elements: RoadElement[]): GameRoadFeature[] {
  const blocked = new Set(
    elements
      .filter(
        (e) =>
          e.type === "node" &&
          e.tags &&
          (e.tags["access:conditional"] ||
            e.tags["foot:conditional"] ||
            (e.tags.foot && !ALLOWED_ACCESS.has(e.tags.foot)) ||
            (e.tags.access &&
              !ALLOWED_ACCESS.has(e.tags.access) &&
              !ALLOWED_ACCESS.has(e.tags.foot ?? "")) ||
            (e.tags.barrier &&
              !["bollard", "stile", "cycle_barrier", "entrance"].includes(e.tags.barrier) &&
              !ALLOWED_ACCESS.has(e.tags.foot ?? e.tags.access ?? "")))
      )
      .map((e) => e.id)
  );
  const roads: GameRoadFeature[] = [];
  for (const way of elements) {
    if (
      way.type !== "way" ||
      !Number.isSafeInteger(way.id) ||
      !permitsFoot(way.tags ?? {}) ||
      !way.nodes ||
      way.nodes.length !== way.geometry?.length
    )
      continue;
    let coordinates: [number, number][] = [],
      nodeIds: number[] = [],
      part = 0;
    const flush = () => {
      if (coordinates.length >= 2)
        roads.push({
          id: `osm-way-${way.id}-${part++}`,
          osmWayId: way.id,
          nodeIds,
          geometry: { type: "LineString", coordinates },
          layer: { id: "road_highway" },
          tags: Object.fromEntries(
            Object.entries(way.tags ?? {}).filter(([key]) =>
              ["highway", "foot", "access", "bridge", "tunnel", "layer"].includes(key)
            )
          )
        });
      coordinates = [];
      nodeIds = [];
    };
    way.geometry!.forEach((p, index) => {
      const node = way.nodes![index]!;
      if (blocked.has(node) || !Number.isFinite(p.lon) || !Number.isFinite(p.lat)) {
        flush();
        return;
      }
      coordinates.push([p.lon!, p.lat!]);
      nodeIds.push(node);
    });
    flush();
  }
  return roads;
}
export async function fetchGameRoads(bbox: Bbox, signal?: AbortSignal): Promise<GameRoadFeature[]> {
  validateBbox(bbox);
  signal?.throwIfAborted();
  const normalized = bbox.map(
    (value, index) => (index < 2 ? Math.floor(value * 10000) : Math.ceil(value * 10000)) / 10000
  ) as Bbox;
  const key = normalized.join(",");
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    cache.delete(key);
    cache.set(key, cached);
    return cached.roads;
  }
  const [w, s, e, n] = normalized;
  const query = `[out:json][timeout:5];(way["highway"](${s},${w},${n},${e});>;);out body geom;`;
  const data = await fetchOverpass<{ elements?: RoadElement[]; remark?: string }>(query, {
    timeoutMs: 7000,
    signal
  });
  signal?.throwIfAborted();
  if (data.remark) throw new Error("Pěší pole má neúplnou odpověď zdroje.");
  const roads = walkableRoads(data.elements ?? []);
  const bytes = Buffer.byteLength(JSON.stringify(roads));
  if (bytes > 8 * 1024 * 1024) throw new ClientError("Pěší pole je příliš podrobné. Přibliž mapu.");
  cacheBytes -= cache.get(key)?.bytes ?? 0;
  cache.delete(key);
  cache.set(key, { at: Date.now(), roads, bytes });
  cacheBytes += bytes;
  while (cacheBytes > CACHE_MAX_BYTES || cache.size > 128) {
    const oldest = cache.keys().next().value!;
    cacheBytes -= cache.get(oldest)!.bytes;
    cache.delete(oldest);
  }
  return roads;
}

/** Deterministic stand-in for browser tests. Production never calls this helper. */
export function memoryGameRoads(bbox: Bbox): GameRoadFeature[] {
  validateBbox(bbox);
  const [west, south, east, north] = bbox;
  const roads: GameRoadFeature[] = [];
  for (let index = 1; index < 12; index += 1) {
    const x = west + ((east - west) * index) / 12;
    const y = south + ((north - south) * index) / 12;
    roads.push({
      id: `memory-v-${index}`,
      geometry: {
        type: "LineString",
        coordinates: [
          [x, south],
          [x, north]
        ]
      },
      layer: { id: "road_highway" }
    });
    roads.push({
      id: `memory-h-${index}`,
      geometry: {
        type: "LineString",
        coordinates: [
          [west, y],
          [east, y]
        ]
      },
      layer: { id: "road_highway" }
    });
  }
  return roads;
}
