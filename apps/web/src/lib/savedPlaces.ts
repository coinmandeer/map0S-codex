import type {
  FeatureCollection,
  GeoFeature,
  SavedPlaceCollectionV2,
  SavedPlaceListV2,
  SavedPlaceSourceRefV2,
  SavedPlaceTargetV2,
  SavedPlaceV2
} from "@mapos/layer-sdk";
import { parseSourceRefs } from "@mapos/layer-sdk";
import { apiGet, apiPost, ApiError } from "./api";

export const SAVED_PLACES_LAYER_ID = "my-saved-places";
const PAGE_LIMIT = 100;
const MAX_PAGES = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  return clean ? clean.slice(0, max) : null;
}

function sourceRefs(feature: GeoFeature): SavedPlaceSourceRefV2[] {
  const refs = parseSourceRefs(feature.properties.sourceRefs)
    .map(({ source, ref }) => ({ source: source.slice(0, 40), sourceRef: ref.slice(0, 220) }))
    .filter(({ source, sourceRef }) => Boolean(source && sourceRef));
  const osmId = text(feature.properties.osmId, 220);
  if (osmId && !refs.some(({ source, sourceRef }) => source === "osm" && sourceRef === osmId)) {
    refs.push({ source: "osm", sourceRef: osmId });
  }
  return refs.slice(0, 12);
}

function targetFor(feature: GeoFeature, layerId: string): SavedPlaceTargetV2 {
  const canonicalPlaceId = text(feature.properties.canonicalPlaceId, 128);
  if (canonicalPlaceId && UUID.test(canonicalPlaceId)) {
    return { type: "canonical-place", canonicalPlaceId };
  }
  const id = text(feature.properties.id, 128);
  if (layerId === "user-layers" && id && UUID.test(id)) {
    return { type: "user-pin", userPinId: id };
  }
  const externalFeatureRef = `${layerId}:${id ?? feature.geometry.coordinates.join(",")}`.slice(
    0,
    320
  );
  return { type: "external-feature", externalFeatureRef };
}

export function savedPlaceToFeature(savedPlace: SavedPlaceV2): GeoFeature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [...savedPlace.snapshot.position] },
    properties: {
      id: savedPlace.id,
      savedPlaceId: savedPlace.id,
      name: savedPlace.snapshot.title,
      category: savedPlace.category,
      layerId: SAVED_PLACES_LAYER_ID,
      description: savedPlace.note ?? savedPlace.snapshot.description ?? undefined,
      tags: savedPlace.tags,
      sourceRefs: savedPlace.snapshot.sourceRefs
        .map(({ source, sourceRef }) => `${source}:${sourceRef}`)
        .join("|"),
      attribution: savedPlace.snapshot.attribution ?? undefined,
      collectionId: savedPlace.collectionId ?? undefined,
      ownerUserId: savedPlace.ownerUserId,
      ownership: "owner-private"
    }
  };
}

export function savedPlacesToFeatureCollection(savedPlaces: SavedPlaceV2[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: savedPlaces.map(savedPlaceToFeature)
  };
}

/** Loads the complete personal collection independently of the current map viewport.
 *
 * The server caps pages at 100 and this client caps pagination too. That bounds both transfer and
 * memory if a damaged cursor ever loops, while still covering a generous 1,000-place account.
 */
export async function loadAllSavedPlaces(signal?: AbortSignal): Promise<SavedPlaceV2[]> {
  const savedPlaces: SavedPlaceV2[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result: SavedPlaceListV2 = await apiGet<SavedPlaceListV2>("/v2/me/saved-places", {
      auth: true,
      signal,
      query: { limit: PAGE_LIMIT, cursor }
    });
    savedPlaces.push(...result.savedPlaces);
    if (!result.nextCursor || seenCursors.has(result.nextCursor)) break;
    seenCursors.add(result.nextCursor);
    cursor = result.nextCursor;
  }
  return savedPlaces;
}

export async function loadSavedPlaceCollections(
  signal?: AbortSignal
): Promise<SavedPlaceCollectionV2[]> {
  const result = await apiGet<{ collections: SavedPlaceCollectionV2[] }>(
    "/v2/me/saved-place-collections",
    { auth: true, signal }
  );
  return result.collections;
}

export type SavePlaceResult = "ok" | "exists" | "auth" | "error";

export async function createSavedPlaceFromFeature(
  feature: GeoFeature,
  layerId: string
): Promise<SavePlaceResult> {
  const [lng, lat] = feature.geometry.coordinates;
  const title = text(feature.properties.name, 180) ?? "Místo";
  const category = text(feature.properties.category, 80) ?? "place";
  const description = text(feature.properties.description, 2_000);
  const attribution = text(feature.properties.attribution, 500);
  try {
    await apiPost<{ savedPlace: SavedPlaceV2 }>("/v2/me/saved-places", {
      target: targetFor(feature, layerId),
      snapshot: {
        title,
        position: [lng, lat],
        category,
        description,
        sourceRefs: sourceRefs(feature),
        attribution,
        capturedAt: new Date().toISOString()
      },
      category
    });
    return "ok";
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return "auth";
    if (error instanceof ApiError && error.status === 409) return "exists";
    return "error";
  }
}
