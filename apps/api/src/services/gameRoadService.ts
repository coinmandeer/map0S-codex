import type { Bbox } from "@mapos/layer-sdk";
import { ClientError } from "../utils/clientError.js";
import { fetchOverpass } from "../utils/overpass.js";

const CACHE_TTL_MS = 24 * 3600_000;
const cache = new Map<string, { at: number; roads: GameRoadFeature[] }>();

export interface GameRoadFeature {
  id: string;
  geometry: { type: "LineString"; coordinates: [number, number][] };
  layer: { id: "road_highway" };
}

function validateBbox(bbox: Bbox) {
  const [west, south, east, north] = bbox;
  if (![west, south, east, north].every(Number.isFinite) || west >= east || south >= north) {
    throw new ClientError("Neplatný výřez silničního pole");
  }
  if (east - west > 0.04 || north - south > 0.04) {
    throw new ClientError("Silniční pole je příliš velké");
  }
}

export async function fetchGameRoads(bbox: Bbox): Promise<GameRoadFeature[]> {
  validateBbox(bbox);
  const key = bbox.map((value) => value.toFixed(4)).join(",");
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.roads;

  const [west, south, east, north] = bbox;
  const query = `[out:json][timeout:5];way["highway"](${south},${west},${north},${east});out geom;`;
  const data = await fetchOverpass<{
    elements?: Array<{
      id?: number;
      geometry?: Array<{ lon?: number; lat?: number }>;
    }>;
  }>(query, { timeoutMs: 7_000 });
  const roads = (data.elements ?? []).flatMap((element) => {
    const coordinates = (element.geometry ?? [])
      .filter((point) => Number.isFinite(point.lon) && Number.isFinite(point.lat))
      .map((point) => [point.lon!, point.lat!] as [number, number]);
    if (coordinates.length < 2) return [];
    return [
      {
        id: `osm-way-${element.id ?? coordinates[0]!.join("-")}`,
        geometry: { type: "LineString" as const, coordinates },
        layer: { id: "road_highway" as const }
      }
    ];
  });
  cache.set(key, { at: Date.now(), roads });
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
