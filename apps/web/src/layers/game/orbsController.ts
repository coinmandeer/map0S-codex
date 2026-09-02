import type maplibregl from "maplibre-gl";
import { distanceMeters, type Bbox, type GeoFeature } from "@mapos/layer-sdk";
import { hashSeed, metersToLngLatOffset, mulberry32 } from "./zoneUtils";

/**
 * The collectible dots.
 *
 * The playable field is a stable kilometre square around the player. Candidate dots sit on a
 * roughly 100 m lattice, then snap to rendered streets and paths. This makes the map read as a
 * walkable board instead of a random particle cloud. A few blue dots can still form a directed
 * trail towards a nearby quest or landmark, at the same spacing as the field.
 *
 * Two properties matter and are easy to lose:
 *
 * - They are per-user. The seed includes the player id, so two people standing in the same
 *   square do not see the same dots, and collecting is not a race.
 * - They are daily and stable. The same user gets one immutable board per UTC day and kilometre
 *   cell. Walking or panning cannot reshuffle it; a new board appears only after crossing the
 *   cell boundary or on the next day.
 */

export interface GameOrb {
  id: string;
  lng: number;
  lat: number;
  /** Set on the dots that form a trail, naming what the trail leads to. */
  towards?: string;
}

export interface OrbLure {
  name: string;
  lng: number;
  lat: number;
}

export const ORB_SECTOR_SIZE_M = 1000;
export const ORB_SPACING_M = 100;
const SECTOR_HALF_M = ORB_SECTOR_SIZE_M / 2;
const GRID_JITTER_M = 12;
const ROAD_SNAP_M = 68;
const MIN_ORB_DISTANCE_M = 65;
export const MAX_ORBS = 96;
/** Close enough that walking there is a stroll, far enough that it is worth a trail. */
const LURE_MIN_M = 120;
const LURE_MAX_M = 1200;
const MAX_TRAILS = 3;
const METERS_PER_LAT_DEGREE = 111_320;
/** Roughly the snap radius. A segment is indexed into every cell its expanded bbox touches, so a
 * candidate only searches one small bucket instead of every road in the viewport. */
const ROAD_INDEX_CELL_M = 96;

function collectedKey(userId: string): string {
  return `mapos:orbs:collected:${userId}`;
}

function xpKey(userId: string): string {
  return `mapos:orbs:xp:${userId}`;
}

export function loadCollectedOrbIds(userId: string): Set<string> {
  try {
    const raw = localStorage.getItem(collectedKey(userId));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function persistCollectedOrbIds(userId: string, ids: Set<string>) {
  localStorage.setItem(collectedKey(userId), JSON.stringify([...ids].slice(-4000)));
}

export function loadOrbXp(userId: string): number {
  const n = Number(localStorage.getItem(xpKey(userId)) ?? "0");
  return Number.isFinite(n) ? n : 0;
}

export function persistOrbXp(userId: string, xpTotal: number): number {
  const next = Number.isFinite(xpTotal) ? Math.max(0, Math.round(xpTotal)) : 0;
  localStorage.setItem(xpKey(userId), String(next));
  return next;
}

export function addOrbXp(userId: string, delta: number, serverBaseline = 0): number {
  return persistOrbXp(userId, Math.max(loadOrbXp(userId), serverBaseline) + delta);
}

export function orbDayKey(now: Date | number = Date.now()): string {
  const date = new Date(now);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

interface OrbSector {
  lng: number;
  lat: number;
  key: string;
}

/** A world-aligned kilometre grid. `floor`, rather than rounding a moving origin, makes every
 * position inside one cell resolve to exactly the same centre and seed. */
export function orbSectorCentre(origin: { lng: number; lat: number }): OrbSector {
  const latStep = ORB_SECTOR_SIZE_M / METERS_PER_LAT_DEGREE;
  const row = Math.floor(origin.lat / latStep);
  const lat = (row + 0.5) * latStep;
  const lngStep =
    ORB_SECTOR_SIZE_M /
    Math.max(METERS_PER_LAT_DEGREE * Math.cos((lat * Math.PI) / 180), ORB_SECTOR_SIZE_M);
  const column = Math.floor(origin.lng / lngStep);
  return {
    lng: (column + 0.5) * lngStep,
    lat,
    key: `${row}x${column}`
  };
}

export function orbFieldKey(
  userId: string,
  origin: { lng: number; lat: number },
  dayKey = orbDayKey()
): string {
  return `${userId}:${dayKey}:${orbSectorCentre(origin).key}`;
}

export function orbSectorBbox(origin: { lng: number; lat: number }, paddingM = 80): Bbox {
  const centre = orbSectorCentre(origin);
  const half = SECTOR_HALF_M + Math.max(0, paddingM);
  const { dLng } = metersToLngLatOffset(half, 0, centre.lat);
  const { dLat } = metersToLngLatOffset(0, half, centre.lat);
  return [centre.lng - dLng, centre.lat - dLat, centre.lng + dLng, centre.lat + dLat];
}

function orbId(
  userId: string,
  dayKey: string,
  sectorKey: string,
  lng: number,
  lat: number
): string {
  return `orb:${userId}:${dayKey}:${sectorKey}:${lng.toFixed(5)},${lat.toFixed(5)}`;
}

/**
 * Somewhere worth walking to, taken from what the map has already loaded — POI pins, quest
 * anchors, event markers. No extra request: if a place is interesting enough to be drawn, it is
 * interesting enough to walk to.
 */
export function pickLures(
  visibleFeatures: Record<string, GeoFeature[]>,
  origin: { lng: number; lat: number },
  seed: string,
  fallbackCentre: { lng: number; lat: number }
): OrbLure[] {
  const reachable: Array<OrbLure & { distance: number }> = [];
  const distant: Array<OrbLure & { distance: number }> = [];
  for (const features of Object.values(visibleFeatures)) {
    for (const feature of features) {
      if (feature.geometry?.type !== "Point") continue;
      const [lng, lat] = feature.geometry.coordinates as [number, number];
      const distance = distanceMeters(origin, { lng, lat });
      if (distance < LURE_MIN_M) continue;
      const name = String(feature.properties?.name ?? "").trim();
      if (!name) continue;
      (distance <= LURE_MAX_M ? reachable : distant).push({ name, lng, lat, distance });
    }
  }

  // Walking past everything nearby shouldn't leave the player with a bare field: if nothing is
  // within a comfortable walk, the closest thing beyond it still points somewhere.
  distant.sort((a, b) => a.distance - b.distance);
  const candidates = reachable.length ? reachable : distant.slice(0, 1);

  if (!candidates.length) {
    // Nothing loaded yet — the centre of the view is still a direction, and heading for it is
    // what "walk to the middle of town" looks like when you have just opened the map.
    const distance = distanceMeters(origin, fallbackCentre);
    if (distance < LURE_MIN_M) return [];
    return [{ name: "Střed mapy", lng: fallbackCentre.lng, lat: fallbackCentre.lat }];
  }

  // Nearer places first, then a seeded pick among them, so the choice is stable per user and
  // per cell without always being the single closest pin.
  candidates.sort((a, b) => a.distance - b.distance);
  const pool = candidates.slice(0, 12);
  const rand = mulberry32(hashSeed(`lures:${seed}`));
  const chosen: OrbLure[] = [];
  // Shuffle once and visit every candidate at most once. The former random-pick loop could
  // exhaust `used` while rejecting clustered places, then spin forever because every later
  // random index was already used. Dense city centres therefore froze the whole page before the
  // first avatar frame. A seeded Fisher-Yates shuffle keeps the same deterministic choice without
  // any unbounded work.
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  for (const pick of shuffled) {
    // Two trails towards nearly the same spot read as one wide trail, so keep them apart.
    if (chosen.some((c) => distanceMeters(c, pick) < 150)) continue;
    chosen.push({ name: pick.name, lng: pick.lng, lat: pick.lat });
    if (chosen.length >= Math.min(MAX_TRAILS, pool.length)) break;
  }
  return chosen;
}

interface RoadSegment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

export interface OrbRoadFeature {
  id?: string | number;
  geometry: {
    type: "LineString" | "MultiLineString";
    coordinates: Array<[number, number]> | Array<Array<[number, number]>>;
  };
  layer?: { id?: string };
  sourceLayer?: string;
}

interface RoadIndex {
  cells: Map<string, RoadSegment[]>;
  metersPerLngDegree: number;
  segmentCount: number;
}

function isWalkableSignature(signature: string): boolean {
  const value = signature.toLowerCase();
  const walkable = /(road|street|path|foot|pedestrian|highway|transport|trail|track|cycle)/.test(
    value
  );
  const excluded = /(rail|water|river|contour|boundary|admin|ferry|aeroway)/.test(value);
  return walkable && !excluded;
}

/** Restrict MapLibre's query before it materialises feature geometry. A vector style often draws
 * the same road as casing, fill and label; asking for the whole viewport used to return all of
 * those plus buildings, boundaries and contours, only for us to discard them afterwards. */
function walkableLayerIds(map: maplibregl.Map): string[] | null {
  try {
    const layers = map.getStyle()?.layers;
    if (!layers) return null;
    return layers
      .filter((layer) => {
        if (layer.type !== "line") return false;
        const sourceLayer = "source-layer" in layer ? String(layer["source-layer"] ?? "") : "";
        return isWalkableSignature(`${layer.id} ${sourceLayer}`);
      })
      .map((layer) => layer.id);
  } catch {
    // Small test doubles and third-party map wrappers may expose only queryRenderedFeatures.
    return null;
  }
}

/** Whether the current style already exposes queryable street/path line layers. */
export function hasWalkableRoadLayers(map: maplibregl.Map): boolean {
  const layers = walkableLayerIds(map);
  // A minimal map double with no style API may still provide useful road features through its
  // unfiltered query. Real MapLibre raster styles return an explicit empty array here.
  return layers === null || layers.length > 0;
}

function roadCellKey(x: number, y: number): string {
  return `${Math.floor(x / ROAD_INDEX_CELL_M)},${Math.floor(y / ROAD_INDEX_CELL_M)}`;
}

/** Builds a small spatial index of road segments currently drawn. Duplicate vector-tile/style
 * copies are collapsed, and each candidate later visits only the bucket around itself. */
function buildRoadIndex(
  map: maplibregl.Map,
  referenceLat: number,
  suppliedFeatures: OrbRoadFeature[] = []
): RoadIndex {
  let renderedFeatures: maplibregl.MapGeoJSONFeature[];
  try {
    const layerIds = walkableLayerIds(map);
    // `layers: []` has differed between MapLibre versions/wrappers. More importantly, a raster
    // style cannot yield street geometry at all, so do not ask it to materialise the viewport.
    renderedFeatures =
      layerIds === null
        ? map.queryRenderedFeatures()
        : layerIds.length > 0
          ? map.queryRenderedFeatures({ layers: layerIds })
          : [];
  } catch {
    renderedFeatures = [];
  }
  const features: Array<OrbRoadFeature | maplibregl.MapGeoJSONFeature> = [
    ...renderedFeatures,
    ...suppliedFeatures
  ];
  const metersPerLngDegree = Math.max(
    METERS_PER_LAT_DEGREE * Math.cos((referenceLat * Math.PI) / 180),
    1
  );
  const cells = new Map<string, RoadSegment[]>();
  const seen = new Set<string>();
  let segmentCount = 0;

  const addLine = (line: Array<[number, number]>) => {
    for (let i = 1; i < line.length; i++) {
      const [aLng, aLat] = line[i - 1]!;
      const [bLng, bLat] = line[i]!;
      if (![aLng, aLat, bLng, bLat].every(Number.isFinite)) continue;
      // Vector styles commonly draw identical geometry in several layers. Quantising below a
      // centimetre is enough to collapse those copies without merging neighbouring streets.
      const aKey = `${aLng.toFixed(7)},${aLat.toFixed(7)}`;
      const bKey = `${bLng.toFixed(7)},${bLat.toFixed(7)}`;
      const key = aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const segment = {
        ax: aLng * metersPerLngDegree,
        ay: aLat * METERS_PER_LAT_DEGREE,
        bx: bLng * metersPerLngDegree,
        by: bLat * METERS_PER_LAT_DEGREE
      };
      // Bad or wrapped geometry should never create a cell loop across half the world.
      if (Math.abs(segment.bx - segment.ax) > 10_000 || Math.abs(segment.by - segment.ay) > 10_000)
        continue;
      segmentCount += 1;
      const minCellX = Math.floor(
        (Math.min(segment.ax, segment.bx) - ROAD_SNAP_M) / ROAD_INDEX_CELL_M
      );
      const maxCellX = Math.floor(
        (Math.max(segment.ax, segment.bx) + ROAD_SNAP_M) / ROAD_INDEX_CELL_M
      );
      const minCellY = Math.floor(
        (Math.min(segment.ay, segment.by) - ROAD_SNAP_M) / ROAD_INDEX_CELL_M
      );
      const maxCellY = Math.floor(
        (Math.max(segment.ay, segment.by) + ROAD_SNAP_M) / ROAD_INDEX_CELL_M
      );
      for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
        for (let cellY = minCellY; cellY <= maxCellY; cellY++) {
          const cellKey = `${cellX},${cellY}`;
          const bucket = cells.get(cellKey);
          if (bucket) bucket.push(segment);
          else cells.set(cellKey, [segment]);
        }
      }
    }
  };

  for (const feature of features) {
    const geom = feature.geometry;
    if (geom?.type !== "LineString" && geom?.type !== "MultiLineString") continue;
    const meta = feature as unknown as { layer?: { id?: string }; sourceLayer?: string };
    const signature = `${meta.layer?.id ?? ""} ${meta.sourceLayer ?? ""}`.toLowerCase();
    // Test doubles and user-provided GeoJSON often have no style metadata. If metadata exists,
    // restrict snapping to things somebody can plausibly walk along — not contours, borders,
    // railways or waterways that also happen to be rendered as lines.
    if (signature.trim() && !isWalkableSignature(signature)) continue;
    if (geom?.type === "LineString") addLine(geom.coordinates as Array<[number, number]>);
    if (geom?.type === "MultiLineString")
      for (const line of geom.coordinates as Array<Array<[number, number]>>) addLine(line);
  }
  return { cells, metersPerLngDegree, segmentCount };
}

/**
 * The closest point on any drawn line, if one is near enough to be the same street.
 *
 * Onto the segment, not onto its endpoints: a straight road is stored as two vertices hundreds of
 * metres apart, so snapping to vertices pulled every dot of a trail onto the same corner and the
 * whole line collapsed into one or two dots.
 */
function snapToRoad(
  point: { lng: number; lat: number },
  index: RoadIndex,
  maxSnapM: number
): { lng: number; lat: number } | null {
  const px = point.lng * index.metersPerLngDegree;
  const py = point.lat * METERS_PER_LAT_DEGREE;
  const segments = index.cells.get(roadCellKey(px, py));
  if (!segments) return null;
  let bestX = 0;
  let bestY = 0;
  let bestDistanceSq = maxSnapM * maxSnapM;

  for (const segment of segments) {
    const dx = segment.bx - segment.ax;
    const dy = segment.by - segment.ay;
    const lengthSq = dx * dx + dy * dy;
    const t =
      lengthSq === 0
        ? 0
        : Math.max(0, Math.min(1, ((px - segment.ax) * dx + (py - segment.ay) * dy) / lengthSq));
    const x = segment.ax + dx * t;
    const y = segment.ay + dy * t;
    const distanceSq = (px - x) ** 2 + (py - y) ** 2;
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      bestX = x;
      bestY = y;
    }
  }
  return bestDistanceSq < maxSnapM * maxSnapM
    ? { lng: bestX / index.metersPerLngDegree, lat: bestY / METERS_PER_LAT_DEGREE }
    : null;
}

export interface OrbFieldOptions {
  userId: string;
  origin: { lng: number; lat: number };
  lures: OrbLure[];
  collected: Set<string>;
  map: maplibregl.Map;
  roadFeatures?: OrbRoadFeature[];
  dayKey?: string;
}

/** A stable 1 × 1 km board around the player, with optional directed trails to useful places. */
export function generateOrbField({
  userId,
  origin,
  lures,
  collected,
  map,
  roadFeatures = [],
  dayKey = orbDayKey()
}: OrbFieldOptions): GameOrb[] {
  const centre = orbSectorCentre(origin);
  const roads = buildRoadIndex(map, centre.lat, roadFeatures);
  // A street-only board cannot be honestly generated from a raster-only style. Returning an
  // empty field lets the layer retry after vector roads finish loading and prevents dots in
  // courtyards, rivers and fields.
  if (!roads.segmentCount) return [];
  const seed = `${userId}:${dayKey}:${centre.key}`;
  const rand = mulberry32(hashSeed(seed));
  const orbs: GameOrb[] = [];
  const seen = new Set<string>();

  const insideSector = (lng: number, lat: number) => {
    const offset = distanceMeters(centre, { lng, lat });
    if (offset > Math.SQRT2 * SECTOR_HALF_M + ROAD_SNAP_M) return false;
    const { dLng: eastEdge } = metersToLngLatOffset(SECTOR_HALF_M + ROAD_SNAP_M, 0, centre.lat);
    const { dLat: northEdge } = metersToLngLatOffset(0, SECTOR_HALF_M + ROAD_SNAP_M, centre.lat);
    return Math.abs(lng - centre.lng) <= eastEdge && Math.abs(lat - centre.lat) <= northEdge;
  };

  const push = (lng: number, lat: number, towards?: string) => {
    if (!insideSector(lng, lat) || distanceMeters(centre, { lng, lat }) < MIN_ORB_DISTANCE_M)
      return;
    const id = orbId(userId, dayKey, centre.key, lng, lat);
    if (collected.has(id) || seen.has(id)) return;
    seen.add(id);
    orbs.push({ id, lng, lat, towards });
  };

  for (const lure of lures) {
    const distance = distanceMeters(centre, lure);
    const steps = Math.min(Math.floor(distance / ORB_SPACING_M), 12);
    for (let step = 1; step <= steps; step++) {
      const t = Math.min(1, (step * ORB_SPACING_M) / distance);
      const raw = {
        lng: centre.lng + (lure.lng - centre.lng) * t,
        lat: centre.lat + (lure.lat - centre.lat) * t
      };
      const snapped = snapToRoad(raw, roads, ROAD_SNAP_M);
      if (snapped) push(snapped.lng, snapped.lat, lure.name);
      if (orbs.length >= MAX_ORBS) return orbs;
    }
  }

  // One candidate per 100 m cell. The tiny stable jitter avoids a sterile graph-paper look while
  // keeping the spacing legible. Candidates that cannot reach a street are omitted whenever the
  // basemap exposes road geometry; they never fall back into courtyards or rivers.
  for (
    let north = -SECTOR_HALF_M + ORB_SPACING_M / 2;
    north < SECTOR_HALF_M;
    north += ORB_SPACING_M
  ) {
    for (
      let east = -SECTOR_HALF_M + ORB_SPACING_M / 2;
      east < SECTOR_HALF_M;
      east += ORB_SPACING_M
    ) {
      const jitterEast = (rand() * 2 - 1) * GRID_JITTER_M;
      const jitterNorth = (rand() * 2 - 1) * GRID_JITTER_M;
      const { dLng, dLat } = metersToLngLatOffset(
        east + jitterEast,
        north + jitterNorth,
        centre.lat
      );
      const raw = { lng: centre.lng + dLng, lat: centre.lat + dLat };
      const snapped = snapToRoad(raw, roads, ROAD_SNAP_M);
      if (snapped) push(snapped.lng, snapped.lat);
      if (orbs.length >= MAX_ORBS) return orbs;
    }
  }

  return orbs;
}
