import type {
  FeatureCollection,
  Bbox,
  OsmPoiCategoryId,
  PlanDocumentV2,
  TripPlan
} from "@mapos/layer-sdk";
import type {
  StoredSavedPlace,
  StoredSavedPlaceCollection
} from "../services/savedPlaceService.js";
import type { PlanDiscussionThread } from "../services/planDiscussionRepository.js";
import type { PlanSharePermission } from "../services/planShareRepository.js";

export interface MemoryUser {
  id: string;
  email: string;
  password: string;
  displayName: string;
  isGuest: boolean;
  xpTotal: number;
}

export interface MemoryUserLayer {
  id: string;
  userId: string;
  name: string;
  color: string;
  slug: string;
  isPublic: number;
}

export interface MemoryPin {
  id: string;
  layerId: string;
  name: string;
  description?: string;
  lng: number;
  lat: number;
  tags?: string[];
  kind?: string;
  properties?: Record<string, unknown>;
}

export interface MemoryZone {
  id: string;
  name: string;
  lng: number;
  lat: number;
  radiusM: number;
  description?: string;
  category?: string;
  lootTier?: string;
  zoneKind?: "standard" | "event" | "staker_gate";
  minStakeUsd?: number;
  activeFrom?: Date;
  activeUntil?: Date;
}

export interface MemoryQuest {
  id: string;
  zoneId: string | null;
  title: string;
  description: string;
  rewardPoints: number;
  lng: number;
  lat: number;
}

export const memoryDb = {
  users: [] as MemoryUser[],
  sessions: new Map<string, { userId: string; expiresAt: Date }>(),
  userLayers: [] as MemoryUserLayer[],
  pins: [] as MemoryPin[],
  zones: [] as MemoryZone[],
  quests: [] as MemoryQuest[],
  // Ghosts and encounters are derived, never stored — only the mutations are (see game/spawn.ts).
  caughtGhosts: new Set<string>(),
  resolvedEncounters: new Set<string>(),
  questCompletions: new Map<string, Set<string>>(),
  collectedOrbs: new Map<string, Set<string>>(),
  gameProfiles: new Map<string, Record<string, unknown>>(),
  tripPlans: [] as Array<{ userId: string; plan: TripPlan }>,
  planDocuments: [] as Array<{ userId: string; plan: PlanDocumentV2 }>,
  planShareLinks: [] as Array<{
    id: string;
    ownerId: string;
    planId: string;
    tokenHash: string;
    permission: PlanSharePermission;
    createdAt: string;
    revokedAt: string | null;
  }>,
  planDiscussionThreads: [] as Array<{ ownerId: string; thread: PlanDiscussionThread }>,
  follows: [] as Array<{ userId: string; targetType: string; targetId: string }>,
  reviews: [] as Array<{
    id: string;
    userId: string;
    targetType: string;
    targetId: string;
    rating: number;
    body: string | null;
  }>,
  comments: [] as Array<{
    id: string;
    userId: string;
    targetType: string;
    targetId: string;
    body: string;
    createdAt: string;
  }>,
  drafts: [] as Array<{ userId: string; payload: Record<string, unknown> & { id: string } }>,
  savedPlaces: [] as StoredSavedPlace[],
  savedPlaceCollections: [] as StoredSavedPlaceCollection[],
  canonicalPlaceIds: new Set<string>(["00000000-0000-4000-8000-000000000001"]),
  overpassCache: new Map<string, FeatureCollection>()
};

export function seedMemory() {
  if (memoryDb.users.length) return;
  memoryDb.users.push({
    id: "demo-user",
    email: "demo@mapos.test",
    password: "demo1234",
    displayName: "MapOS Demo",
    isGuest: false,
    xpTotal: 0
  });
  memoryDb.userLayers.push({
    id: "layer-1",
    userId: "demo-user",
    name: "Plzeň tipy",
    color: "#10b981",
    slug: "plzen-tipy",
    isPublic: 1
  });
  memoryDb.pins.push(
    {
      id: "p1",
      layerId: "layer-1",
      name: "Pivovarské muzeum",
      lng: 13.3775,
      lat: 49.7475,
      description: "Plzeňský Prazdroj"
    },
    {
      id: "p2",
      layerId: "layer-1",
      name: "Svatý Bartoloměj",
      lng: 13.3773,
      lat: 49.7472,
      description: "Katedrála"
    }
  );
  memoryDb.zones.push(
    {
      id: "z1",
      name: "Plzeň centrum",
      lng: 13.3775,
      lat: 49.7475,
      radiusM: 300,
      description: "Historické centrum"
    },
    {
      id: "z2",
      name: "Karlštejn okolí",
      lng: 14.188,
      lat: 49.939,
      radiusM: 400,
      description: "Hradní zóna"
    }
  );
  memoryDb.quests.push(
    {
      id: "q1",
      zoneId: "z1",
      title: "Objev Pivovarské muzeum",
      description: "Dojdi k muzeu a zaznamenej návštěvu.",
      rewardPoints: 20,
      lng: 13.3775,
      lat: 49.7475
    },
    {
      id: "q2",
      zoneId: "z2",
      title: "Vylez ke Karlštejnu",
      description: "Vystoupej k hradu a poraz strážce.",
      rewardPoints: 35,
      lng: 14.188,
      lat: 49.939
    }
  );
}

export function memoryUserFeatures(bbox: Bbox): FeatureCollection {
  const [w, s, e, n] = bbox;
  const publicLayers = memoryDb.userLayers.filter((l) => l.isPublic);
  const layerIds = new Set(publicLayers.map((l) => l.id));
  const features = memoryDb.pins
    .filter((p) => layerIds.has(p.layerId))
    .filter((p) => p.lng >= w && p.lng <= e && p.lat >= s && p.lat <= n)
    .map((p) => {
      const layer = publicLayers.find((l) => l.id === p.layerId);
      return {
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] as [number, number] },
        properties: {
          id: p.id,
          name: p.name,
          description: p.description ?? "",
          category: "user-pin",
          layerId: "user-layers",
          userLayerName: layer?.name ?? ""
        }
      };
    });
  return { type: "FeatureCollection", features };
}

// Partial on purpose: a category with no fixture is simply empty, so adding one to the SDK
// doesn't require an entry here.
const demo: Partial<Record<OsmPoiCategoryId, [number, number, string][]>> = {
  castle: [[13.3775, 49.7475, "Plzeň — historické centrum"]],
  viewpoint: [[13.382, 49.7505, "Riegrovy sady"]],
  parking: [[13.376, 49.748, "Parkoviště Centrum"]],
  bar: [[13.378, 49.747, "Irish Pub"]],
  brewery: [[13.379, 49.748, "Pivovar"]],
  skatepark: [[13.3805, 49.7462, "Skatepark Plzeň"]]
};

/** The same fixtures seen as quest anchors, so the offline server exercises the anchored quest
 *  path instead of only the deterministic spawner. */
export function memoryPoiFixtures() {
  return Object.entries(demo).flatMap(([category, entries]) =>
    (entries ?? []).map(([lng, lat, name], i) => ({
      osmId: `node/demo-${category}-${i}`,
      category,
      name,
      lng,
      lat
    }))
  );
}

export function memoryOsmFeatures(_bbox: Bbox, categories: OsmPoiCategoryId[]): FeatureCollection {
  const features = categories.flatMap((cat) =>
    (demo[cat] ?? []).map(([lng, lat, name], i) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [lng, lat] as [number, number] },
      properties: { id: `demo-${cat}-${i}`, name, category: cat, layerId: "osm-poi" }
    }))
  );
  return { type: "FeatureCollection", features };
}
