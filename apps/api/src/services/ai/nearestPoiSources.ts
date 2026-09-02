import { createHash } from "node:crypto";
import type { Bbox, Place, PlacesResponse } from "@mapos/layer-sdk";
import type { AiNearestPoiRecord, AiNearestPoiSource } from "./toolCatalog.js";

const OSM_LAYER_ID = "osm-poi";
const BAR_CATEGORY = "food.bar";
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export type FusedPlacesReader = (query: {
  bbox: Bbox;
  categories: ["bar"];
  sources: ["osm"];
}) => Promise<PlacesResponse>;

function opaqueId(prefix: string, value: string): string {
  return `${prefix}:${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

function bboxAround(longitude: number, latitude: number, radiusMeters: number): Bbox {
  const latitudeDelta = radiusMeters / 111_320;
  const longitudeDelta =
    radiusMeters / (111_320 * Math.max(0.01, Math.cos((latitude * Math.PI) / 180)));
  return [
    Math.max(-180, longitude - longitudeDelta),
    Math.max(-85, latitude - latitudeDelta),
    Math.min(180, longitude + longitudeDelta),
    Math.min(85, latitude + latitudeDelta)
  ];
}

function publicOsmUrl(sourceRef: string): string | undefined {
  return /^(?:node|way|relation)\/[1-9][0-9]*$/u.test(sourceRef)
    ? `https://www.openstreetmap.org/${sourceRef}`
    : undefined;
}

function fusedRecord(place: Place): AiNearestPoiRecord | null {
  const provenance = place.sources.find((claim) => claim.source === "osm");
  if (!provenance) return null;
  const url = publicOsmUrl(provenance.sourceRef);
  const tags = place.tags?.filter((tag) => IDENTIFIER.test(tag)).slice(0, 50);
  const rating =
    typeof place.rating === "number" && place.rating >= 0 && place.rating <= 5
      ? place.rating
      : undefined;
  return {
    id: opaqueId("poi", place.id),
    layerId: OSM_LAYER_ID,
    title: place.name.trim().slice(0, 500),
    category: BAR_CATEGORY,
    longitude: place.lng,
    latitude: place.lat,
    ...(rating === undefined ? {} : { rating }),
    ...(tags?.length ? { tags } : {}),
    source: {
      sourceId: opaqueId("osm", provenance.sourceRef),
      label: "© OpenStreetMap contributors (ODbL)",
      providerId: "osm",
      retrievedAt: provenance.refreshedAt,
      ...(url ? { url } : {})
    }
  };
}

/** Production adapter: the route remains provider-neutral while the composition supplies OSM. */
export function createFusedPlacesNearestPoiSource(
  readPlaces: FusedPlacesReader
): AiNearestPoiSource {
  return {
    async query(input, context) {
      context.signal.throwIfAborted();
      if (!input.layerIds.includes(OSM_LAYER_ID) || input.category !== BAR_CATEGORY) return [];
      const response = await readPlaces({
        bbox: bboxAround(input.longitude, input.latitude, input.radiusMeters),
        categories: ["bar"],
        sources: ["osm"]
      });
      context.signal.throwIfAborted();
      return response.places
        .map(fusedRecord)
        .filter((record): record is AiNearestPoiRecord => record !== null);
    }
  };
}

export interface MemoryPoiFixture {
  osmId: string;
  category: string;
  name: string;
  lng: number;
  lat: number;
}

/** Offline adapter: records are visibly labelled fixtures and never trigger public I/O. */
export function createMemoryNearestPoiSource(
  readFixtures: () => readonly MemoryPoiFixture[]
): AiNearestPoiSource {
  return {
    async query(input, context) {
      context.signal.throwIfAborted();
      if (!input.layerIds.includes(OSM_LAYER_ID) || input.category !== BAR_CATEGORY) return [];
      return readFixtures()
        .filter((fixture) => fixture.category === "bar")
        .map((fixture) => ({
          id: opaqueId("fixture-poi", fixture.osmId),
          layerId: OSM_LAYER_ID,
          title: fixture.name,
          category: BAR_CATEGORY,
          longitude: fixture.lng,
          latitude: fixture.lat,
          source: {
            sourceId: opaqueId("osm-fixture", fixture.osmId),
            label: "OpenStreetMap deterministic fixture (ODbL)",
            providerId: "osm-fixture",
            retrievedAt: "2026-09-01T00:00:00.000Z"
          }
        }));
    }
  };
}
