import type { JsonValue, VersionEnvelope } from "./common.js";
import type { FeatureAccessV2, SourceRecordV2 } from "./source.js";

export type Position = [number, number];
export type GeoJsonBbox = [number, number, number, number];

export type GeoJsonGeometry =
  | { type: "Point"; coordinates: Position }
  | { type: "MultiPoint"; coordinates: Position[] }
  | { type: "LineString"; coordinates: Position[] }
  | { type: "MultiLineString"; coordinates: Position[][] }
  | { type: "Polygon"; coordinates: Position[][] }
  | { type: "MultiPolygon"; coordinates: Position[][][] };

export type MapOSFeatureKind =
  | "place"
  | "event"
  | "route-stop"
  | "route-segment"
  | "user-place"
  | "suggestion"
  | "game-object"
  | "region"
  | "moving-object";

export interface FeatureUrlV2 {
  label: string;
  url: string;
  kind?: "official" | "booking" | "source" | "social" | "map" | "other";
}

export interface FeatureMediaV2 {
  id: string;
  type: "image" | "video" | "audio";
  url: string;
  thumbnailUrl?: string;
  caption?: string;
  credit?: string;
  license?: string;
  sourceId?: string;
}

export interface MapOSFeaturePropertiesV2 {
  title: string;
  kind: MapOSFeatureKind;
  category: string;
  subcategory?: string | null;
  layerIds: string[];
  summary?: string | null;
  description?: string | null;
  address?: string | null;
  tags?: string[];
  urls?: FeatureUrlV2[];
  media?: FeatureMediaV2[];
  rating?: { value: number; count: number; sourceId?: string };
  openingHours?: string | null;
  contact?: { phone?: string; email?: string; website?: string };
  temporal?: {
    startsAt?: string | null;
    endsAt?: string | null;
    timezone?: string;
    live?: boolean;
  };
  providerFields?: Record<string, Record<string, JsonValue>>;
  extensions?: Record<string, JsonValue>;
}

export interface MapOSFeatureV2 extends VersionEnvelope {
  schema: "mapos.feature";
  schemaVersion: string;
  revision: number;
  geometry: GeoJsonGeometry;
  bbox?: GeoJsonBbox;
  properties: MapOSFeaturePropertiesV2;
  sources: SourceRecordV2[];
  access: FeatureAccessV2;
  createdAt: string;
  updatedAt: string;
}
