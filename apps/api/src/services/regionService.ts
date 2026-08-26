import { and, gte, lte, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { osmPois, userPins } from "../db/schema.js";
import {
  childrenOf,
  regionById,
  regionPolygon,
  CZ_COUNTRY,
  type RegionDef
} from "../data/czRegions.js";

async function countsFor(region: RegionDef) {
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

export async function listDiscoverRegions(country: string, parent?: string) {
  if (country !== "CZ") {
    return { regions: [], geojson: { type: "FeatureCollection" as const, features: [] } };
  }
  const parentId = parent?.trim() || "CZ";
  const list = childrenOf(parentId);
  const regions = [];
  for (const region of list) {
    const counts = await countsFor(region);
    regions.push({
      id: region.id,
      name: region.name,
      level: region.level,
      parent: region.parent,
      bbox: region.bbox,
      osmPois: counts.osmPois,
      userPins: counts.userPins
    });
  }
  return {
    regions,
    geojson: {
      type: "FeatureCollection" as const,
      features: list.map((r) => regionPolygon(r))
    }
  };
}

export function getRegion(id: string): RegionDef | undefined {
  if (id === "CZ") return CZ_COUNTRY;
  return regionById(id);
}
