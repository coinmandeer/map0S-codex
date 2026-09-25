import type {
  Bbox,
  FeatureCollection,
  GeoFeature,
  MapOSFeatureKind,
  SourceRights
} from "@mapos/layer-sdk";

export interface DataSourceV2Descriptor {
  providerId: string;
  attribution: string;
  license?: string | null;
  rights: SourceRights;
  confidence?: number;
  kind?: MapOSFeatureKind;
}

/**
 * A bbox-in, points-out data source.
 *
 * This is the narrow shape most external APIs fit: ask about a rectangle, get things with
 * coordinates back. Sources implement `load` and get caching, error reporting and registration
 * as a layer for free.
 */
export interface DataSourceResult {
  features: GeoFeature[];
  status: "complete" | "partial";
  notice?: string;
}

/** Legacy array sources remain compatible; multi-source adapters can report incomplete coverage. */
export function sourceResult(value: GeoFeature[] | DataSourceResult): DataSourceResult {
  return Array.isArray(value) ? { features: value, status: "complete" } : value;
}

export interface DataSource {
  id: string;
  /** Present only after this source has a reviewed v2 mapping and contract fixture. */
  v2?: DataSourceV2Descriptor;
  /** Rejects viewports the upstream cannot serve — Commons caps its radius at 10 km, and
   *  asking for a continent just wastes a request. Returning a string explains it to the user
   *  instead of showing an empty layer. */
  tooLarge?(bbox: Bbox): string | null;
  load(
    bbox: Bbox,
    query: Record<string, string | undefined>,
    signal?: AbortSignal
  ): Promise<GeoFeature[] | DataSourceResult>;
}

export function featureCollection(features: GeoFeature[]): FeatureCollection {
  return { type: "FeatureCollection", features };
}

/** Rough width of a bbox in kilometres at its own latitude — good enough to decide whether a
 *  request is worth making. */
export function bboxSpanKm(bbox: Bbox): number {
  const [west, south, east, north] = bbox;
  const midLat = ((south + north) / 2) * (Math.PI / 180);
  const kmPerDegLng = 111.32 * Math.cos(midLat);
  return Math.max((east - west) * kmPerDegLng, (north - south) * 110.57);
}

export function bboxCenter(bbox: Bbox): { lng: number; lat: number } {
  const [west, south, east, north] = bbox;
  return { lng: (west + east) / 2, lat: (south + north) / 2 };
}

export function withinBbox(bbox: Bbox, lng: number, lat: number): boolean {
  const [west, south, east, north] = bbox;
  return lng >= west && lng <= east && lat >= south && lat <= north;
}

export function point(
  id: string,
  name: string,
  lng: number,
  lat: number,
  layerId: string,
  extra: Record<string, unknown> = {}
): GeoFeature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [lng, lat] },
    properties: { id, name, layerId, ...extra }
  };
}
