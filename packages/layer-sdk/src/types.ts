/** Bounding box: west, south, east, north */
export type Bbox = [number, number, number, number];

export type LayerKind = "pins" | "raster" | "custom-gl" | "vector";

export type LayerCategory = "travel" | "weather" | "user" | "game" | "routing";

export interface LayerManifest {
  id: string;
  name: string;
  icon: string;
  color: string;
  description: string;
  category: LayerCategory;
  experimental?: boolean;
}

export type FilterKind = "multi-select" | "toggle" | "range" | "text";

export interface FilterOption {
  id: string;
  label: string;
  icon?: string;
}

export interface FilterFacet {
  id: string;
  label: string;
  kind: FilterKind;
  options?: FilterOption[];
  min?: number;
  max?: number;
  default?: unknown;
}

export type FilterValues = Record<string, unknown>;

export interface GeoFeatureProperties {
  id: string;
  name: string;
  category?: string;
  layerId: string;
  [key: string]: unknown;
}

export interface GeoFeature {
  type: "Feature";
  geometry: {
    type: "Point";
    coordinates: [number, number];
  };
  properties: GeoFeatureProperties;
}

export interface FeatureCollection {
  type: "FeatureCollection";
  features: GeoFeature[];
}

export interface LayerContext {
  map: unknown;
  apiBaseUrl: string;
}

export interface LayerHandle {
  update(bbox: Bbox, filters: FilterValues): Promise<void>;
  setVisible(visible: boolean): void;
  setOpacity(opacity: number): void;
  detach(): void;
}

export interface LayerModule {
  id: string;
  kind: LayerKind;
  manifest: LayerManifest;
  filters?: FilterFacet[];
  defaultFilters?: FilterValues;
  attach(ctx: LayerContext): LayerHandle;
}

export interface LayerCatalogEntry {
  manifest: LayerManifest;
  filters?: FilterFacet[];
  kind: LayerKind;
}

export interface ActiveLayerState {
  layerId: string;
  visible: boolean;
  opacity: number;
  filters: FilterValues;
}

export interface MapViewState {
  lng: number;
  lat: number;
  zoom: number;
}

export function bboxFromCenter(lng: number, lat: number, radiusDeg = 0.05): Bbox {
  return [lng - radiusDeg, lat - radiusDeg, lng + radiusDeg, lat + radiusDeg];
}

export function parseBboxParam(value: string | null): Bbox | null {
  if (!value) return null;
  const parts = value.split(",").map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return null;
  return parts as Bbox;
}

export function formatBboxParam(bbox: Bbox): string {
  return bbox.map((n) => n.toFixed(5)).join(",");
}

export function distanceMeters(
  a: { lng: number; lat: number },
  b: { lng: number; lat: number }
): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const OSM_POI_CATEGORIES = {
  viewpoint: { label: "Vyhlídky", group: "nature", overpass: 'node["tourism"="viewpoint"]' },
  waterfall: { label: "Vodopády", group: "nature", overpass: 'node["waterway"="waterfall"]' },
  lake: { label: "Jezera / přehrady", group: "nature", overpass: 'node["natural"="water"]' },
  peak: { label: "Vrcholy", group: "nature", overpass: 'node["natural"="peak"]' },
  cave: { label: "Jeskyně", group: "nature", overpass: 'node["natural"="cave_entrance"]' },
  castle: { label: "Hrady", group: "culture", overpass: 'node["historic"="castle"]' },
  palace: { label: "Zámky", group: "culture", overpass: 'node["historic"="palace"]' },
  ruins: { label: "Zříceniny", group: "culture", overpass: 'node["historic"="ruins"]' },
  museum: { label: "Muzea", group: "culture", overpass: 'node["tourism"="museum"]' },
  monument: { label: "Pomníky", group: "culture", overpass: 'node["historic"="monument"]' },
  bar: { label: "Bary", group: "food", overpass: 'node["amenity"="bar"]' },
  cafe: { label: "Kavárny", group: "food", overpass: 'node["amenity"="cafe"]' },
  restaurant: { label: "Restaurace", group: "food", overpass: 'node["amenity"="restaurant"]' },
  brewery: { label: "Pivovary", group: "food", overpass: 'node["craft"="brewery"]' },
  parking: { label: "Parkoviště", group: "services", overpass: 'node["amenity"="parking"]' },
  fuel: { label: "Palivo", group: "services", overpass: 'node["amenity"="fuel"]' },
  charging: {
    label: "EV nabíječky",
    group: "services",
    overpass: 'node["amenity"="charging_station"]'
  },
  drinking_water: {
    label: "Pitná voda",
    group: "services",
    overpass: 'node["amenity"="drinking_water"]'
  },
  toilets: { label: "WC", group: "services", overpass: 'node["amenity"="toilets"]' },
  shower: { label: "Sprchy", group: "services", overpass: 'node["amenity"="shower"]' },
  camp_site: { label: "Kempy", group: "stay", overpass: 'node["tourism"="camp_site"]' },
  alpine_hut: { label: "Horské chaty", group: "stay", overpass: 'node["tourism"="alpine_hut"]' },
  shelter: { label: "Přístřešky", group: "stay", overpass: 'node["amenity"="shelter"]' }
} as const;

export type OsmPoiCategoryId = keyof typeof OSM_POI_CATEGORIES;

/**
 * Builds an Overpass QL query for the given categories.
 *
 * Two things that previously starved real-world density (Czech castles being a prime example):
 * 1. Only `node[...]` was queried — but a large share of `historic=castle`/`palace`/`ruins` and
 *    similar tags in OSM are mapped on `way` (building footprint) or `relation` (multipolygon)
 *    features, which were silently dropped entirely. Every category now queries node + way +
 *    relation, with `center` giving way/relation results a representative point coordinate.
 * 2. A single shared `out center 200;` capped the *combined* result across every category in
 *    the query — a common category (parking) could starve a rare one (castle) sharing the same
 *    request. Each category now gets its own `(...); out center 800;` block, still inside one
 *    HTTP request (cheap on data), so no category can crowd out another.
 */
export function buildOverpassQuery(bbox: Bbox, categories: OsmPoiCategoryId[]): string {
  const [w, s, e, n] = bbox;
  const bboxStr = `${s},${w},${n},${e}`;
  const blocks = categories.map((id) => {
    const tag = OSM_POI_CATEGORIES[id].overpass.replace(/^node/, "");
    return `(\n  node${tag}(${bboxStr});\n  way${tag}(${bboxStr});\n  relation${tag}(${bboxStr});\n);\nout center 800;`;
  });
  return `[out:json][timeout:40];\n${blocks.join("\n")}`;
}
