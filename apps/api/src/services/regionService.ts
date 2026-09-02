import { and, gte, lte, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { osmPois, userPins } from "../db/schema.js";
import { childrenOf, regionById, CZ_COUNTRY, type RegionDef } from "../data/czRegions.js";
import { fetchOverpass } from "../utils/overpass.js";
import { fetchJson } from "../utils/upstream.js";

interface DynamicRegion {
  id: string;
  name: string;
  level: string;
  adminLevel: number;
  parent: string | null;
  bbox: [number, number, number, number];
  relationId: number;
}

export type BoundaryGeometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

export interface BoundaryProvenance {
  sourceId: string;
  attribution?: string;
  license?: string;
  url: string;
  updatedAt: string;
}

export interface TrustedRegionBoundary {
  geometry: BoundaryGeometry;
  provenance: BoundaryProvenance;
}

type BoundaryRegion = (RegionDef | DynamicRegion) & { boundary?: TrustedRegionBoundary };

const dynamicRegions = new Map<string, DynamicRegion>();
const regionCache = new Map<string, { at: number; values: DynamicRegion[] }>();
const REGION_TTL_MS = 24 * 3600_000;

async function countsFor(region: { bbox: [number, number, number, number] }) {
  const [w, s, e, n] = region.bbox;
  const [poi] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(osmPois)
    .where(and(gte(osmPois.lng, w), lte(osmPois.lng, e), gte(osmPois.lat, s), lte(osmPois.lat, n)));
  const [pins] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(userPins)
    .where(
      and(gte(userPins.lng, w), lte(userPins.lng, e), gte(userPins.lat, s), lte(userPins.lat, n))
    );
  return { osmPois: poi?.count ?? 0, userPins: pins?.count ?? 0 };
}

function levelName(adminLevel: number) {
  if (adminLevel <= 4) return "region";
  if (adminLevel <= 6) return "okres";
  if (adminLevel <= 8) return "obec";
  return "čtvrť";
}

function isFinitePosition(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  );
}

function isClosedRing(value: unknown): value is number[][] {
  if (!Array.isArray(value) || value.length < 4 || !value.every(isFinitePosition)) return false;
  const first = value[0]!;
  const last = value[value.length - 1]!;
  return first[0] === last[0] && first[1] === last[1];
}

function isTrustedGeometry(geometry: BoundaryGeometry): boolean {
  if (geometry.type === "Polygon") {
    return geometry.coordinates.length > 0 && geometry.coordinates.every(isClosedRing);
  }
  return (
    geometry.coordinates.length > 0 &&
    geometry.coordinates.every((polygon) => polygon.length > 0 && polygon.every(isClosedRing))
  );
}

/**
 * Turns a region into a selectable overlay only when a real polygon and technical provenance were
 * ingested together. Rights fields remain advisory. A bbox is never a boundary.
 */
export function trustedBoundaryFeature(region: BoundaryRegion) {
  const boundary = region.boundary;
  if (!boundary || !isTrustedGeometry(boundary.geometry)) return null;
  const provenance = boundary.provenance;
  if (!provenance.sourceId.trim() || !provenance.url.trim() || !provenance.updatedAt.trim()) {
    return null;
  }
  return {
    type: "Feature" as const,
    properties: {
      id: region.id,
      name: region.name,
      level: region.level,
      parent: region.parent,
      boundarySourceId: provenance.sourceId,
      boundaryAttribution: provenance.attribution,
      boundaryLicense: provenance.license,
      boundaryUrl: provenance.url,
      boundaryUpdatedAt: provenance.updatedAt
    },
    geometry: boundary.geometry
  };
}

async function relationForCurated(region: RegionDef, country: string) {
  try {
    const params = new URLSearchParams({
      format: "json",
      limit: "1",
      countrycodes: country.toLowerCase(),
      q: region.name
    });
    const payload = await fetchJson<Array<{ osm_type?: string; osm_id?: number }>>(
      `https://nominatim.openstreetmap.org/search?${params}`,
      {
        providerId: "nominatim",
        ttlMs: REGION_TTL_MS,
        timeoutMs: 5_000,
        minIntervalMs: 1_100,
        maxResponseBytes: 256 * 1024
      }
    );
    const hit = payload.find(
      (item) => item.osm_type === "relation" && Number.isInteger(item.osm_id)
    );
    return hit?.osm_id ?? null;
  } catch {
    return null;
  }
}

async function fetchOsmChildren(
  country: string,
  parentId: string,
  parentAdminLevel: number,
  relationId?: number
) {
  const cacheKey = `${country}:${parentId}:${parentAdminLevel}:${relationId ?? "country"}`;
  const cached = regionCache.get(cacheKey);
  if (cached && Date.now() - cached.at < REGION_TTL_MS) return cached.values;

  for (const adminLevel of [3, 4, 5, 6, 7, 8, 9, 10].filter((level) => level > parentAdminLevel)) {
    const parentQuery = relationId
      ? `rel(${relationId});map_to_area->.parent;`
      : `area["ISO3166-1"="${country}"]["boundary"="administrative"]->.parent;`;
    const query = `[out:json][timeout:20];${parentQuery}rel(area.parent)["boundary"="administrative"]["admin_level"="${adminLevel}"];out tags center bb 120;`;
    try {
      const payload = await fetchOverpass<{
        elements?: Array<{
          id?: number;
          tags?: Record<string, string>;
          bounds?: { minlon?: number; minlat?: number; maxlon?: number; maxlat?: number };
        }>;
      }>(query, { timeoutMs: 12_000 });
      const values = (payload.elements ?? []).flatMap((element): DynamicRegion[] => {
        const name = element.tags?.["name:cs"] ?? element.tags?.name;
        const bounds = element.bounds;
        if (!name || !element.id || !bounds) return [];
        const bbox = [bounds.minlon, bounds.minlat, bounds.maxlon, bounds.maxlat].map(
          Number
        ) as DynamicRegion["bbox"];
        if (!bbox.every(Number.isFinite)) return [];
        const region: DynamicRegion = {
          id: `osm-rel-${element.id}`,
          name,
          level: levelName(adminLevel),
          adminLevel,
          parent: parentId,
          bbox,
          relationId: element.id
        };
        dynamicRegions.set(region.id, region);
        return [region];
      });
      if (values.length) {
        values.sort((a, b) => a.name.localeCompare(b.name, "cs"));
        regionCache.set(cacheKey, { at: Date.now(), values });
        return values;
      }
    } catch {
      // A country can legitimately skip this level; try the next before giving up.
    }
  }
  regionCache.set(cacheKey, { at: Date.now(), values: [] });
  return [];
}

export async function listDiscoverRegions(country: string, parent?: string) {
  const parentId = parent?.trim() || country;
  let list: Array<RegionDef | DynamicRegion>;
  if (country === "CZ" && parentId === "CZ") {
    list = childrenOf(parentId);
  } else {
    const dynamicParent = dynamicRegions.get(parentId);
    const curatedParent = country === "CZ" ? regionById(parentId) : undefined;
    const relationId =
      dynamicParent?.relationId ??
      (curatedParent ? await relationForCurated(curatedParent, country) : undefined);
    const parentAdminLevel =
      dynamicParent?.adminLevel ??
      (curatedParent?.level === "kraj" ? 4 : curatedParent?.level === "okres" ? 6 : 2);
    list = await fetchOsmChildren(country, parentId, parentAdminLevel, relationId ?? undefined);
  }
  const regions = await Promise.all(
    list.map(async (region) => ({
      id: region.id,
      name: region.name,
      level: region.level,
      parent: region.parent,
      bbox: region.bbox,
      boundaryAvailable: Boolean(trustedBoundaryFeature(region)),
      countScope: "bbox-estimate" as const,
      ...(await countsFor(region))
    }))
  );
  const features = list.flatMap((region) => {
    const feature = trustedBoundaryFeature(region);
    return feature ? [feature] : [];
  });
  return {
    regions,
    boundaryGate: {
      status: features.length ? ("ready" as const) : ("dataset-required" as const),
      reason: features.length
        ? undefined
        : "No administrative boundary dataset and ingest pipeline is configured; bbox extents are not rendered as boundaries."
    },
    geojson: {
      type: "FeatureCollection" as const,
      features
    }
  };
}

export function getRegion(id: string): RegionDef | DynamicRegion | undefined {
  if (id === "CZ") return CZ_COUNTRY;
  return regionById(id) ?? dynamicRegions.get(id);
}
