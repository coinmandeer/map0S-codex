/** Bounding box: west, south, east, north */
export type Bbox = [number, number, number, number];

export type LayerKind = "pins" | "raster" | "custom-gl" | "vector";

export type LayerCategory =
  | "travel"
  | "weather"
  | "user"
  | "game"
  | "routing"
  | "outdoor"
  | "transport"
  | "environment"
  | "community";

/** The bottom-nav sections. A layer declares which ones it belongs to, so adding a layer to a
 *  section is a property of the layer rather than a list the shell has to be taught about. */
export type LayerMode = "poi" | "weather" | "game" | "mine" | "discover";

export interface LayerManifest {
  id: string;
  name: string;
  icon: string;
  color: string;
  description: string;
  category: LayerCategory;
  experimental?: boolean;
  /** Modes whose layer menu lists this layer. Absent means "extras" — reachable from the
   *  mega-menu but not tied to a section. */
  modes?: LayerMode[];
  /** The one layer a mode turns on when you switch to it. At most one layer per mode. */
  primaryForModes?: LayerMode[];
  /** Server capability that must be present for this layer to be offered, e.g. a provider key
   *  the backend holds. Layers without one are always available. */
  requiresCapability?: string;
}

/** Who the data belongs to. Aggregated into the map's attribution control and the About sheet;
 *  several of the sources MapOS uses (OSM/ODbL, Wikimedia) require the credit to be visible. */
export interface LayerAttribution {
  label: string;
  url?: string;
  license?: string;
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
  /**
   * Why this collection is empty, when it is empty on purpose — "zoom in further", "this source
   * is down". Without it an upstream refusing a request and an area genuinely having nothing in
   * it look identical to the user.
   */
  notice?: string;
}

/** `TMap` is the renderer handle — MapLibre's `Map` in this app. It stays a type parameter so
 *  the SDK (which the API imports too) never depends on maplibre-gl. */
export interface LayerContext<TMap = unknown> {
  map: TMap;
  apiBaseUrl: string;
  layerId: string;
  /** The manifest colour, so plugins don't have to look their own manifest up again. */
  color: string;
}

/**
 * One attached layer instance. `update` returns the features it fetched so the engine can cache
 * them and feed the results list; layers that render straight from tiles return `null`.
 */
export interface LayerHandle {
  update(
    bbox: Bbox,
    filters: FilterValues,
    signal?: AbortSignal
  ): Promise<FeatureCollection | null>;
  /** Render an already-fetched collection (a cache hit) without going to the network. */
  setData?(data: FeatureCollection): void;
  setVisible(visible: boolean): void;
  setOpacity(opacity: number): void;
  detach(): void;
}

/**
 * What refetching costs when the viewport moves.
 *
 * `expensive` layers (an Overpass query over a whole country, say) are not refetched on every
 * pan — the engine surfaces the "Search here" button and waits to be asked. `cheap` layers,
 * mostly tiles and small bbox queries, just follow the map.
 */
export type ViewportCost = "cheap" | "expensive";

/**
 * App state a layer may need to fold into its request but cannot reach on its own. Deliberately
 * small: every field here is one the engine used to special-case by layer id.
 */
export interface LayerRuntimeContext {
  activeTag: string | null;
  countryCode: string | null;
  enabledPoiSources: string[];
}

/**
 * The whole contract for adding a layer.
 *
 * The engine only knows this shape, so a new layer is a new object in the registry rather than
 * another branch in the engine. Note there is nothing about UI here on purpose: the SDK is
 * shared with the API, so panels and other React-facing extras hang off the web-side
 * `MapLayerPlugin` that extends this.
 */
export interface LayerPlugin<TMap = unknown> {
  kind: LayerKind;
  manifest: LayerManifest;
  filters?: FilterFacet[];
  defaultFilters?: FilterValues;
  /** Opacity a freshly enabled layer starts at. Overlays that sit on top of the basemap want
   *  less than 1 so the map underneath stays readable. */
  defaultOpacity?: number;
  /** Default `expensive` for `pins`, `cheap` otherwise; see `viewportCostOf`. */
  viewportCost?: ViewportCost;
  /**
   * Last chance to fold app state into the filters before they become the request and the cache
   * key. Must be pure — the engine calls it on every refresh and hashes the result.
   */
  deriveFilters?(filters: FilterValues, ctx: LayerRuntimeContext): FilterValues;
  create(ctx: LayerContext<TMap>): LayerHandle;
  /** True when the layer fuses several upstream POI sources and its response carries per-source
   *  `meta`, which drives the per-source loading indicators. */
  reportsSourceStatus?: boolean;
  attribution?: LayerAttribution[];
}

export function viewportCostOf(plugin: {
  kind: LayerKind;
  viewportCost?: ViewportCost;
}): ViewportCost {
  return plugin.viewportCost ?? (plugin.kind === "pins" ? "expensive" : "cheap");
}

export interface LayerCatalogEntry {
  manifest: LayerManifest;
  filters?: FilterFacet[];
  kind: LayerKind;
}

/**
 * Which optional providers this deployment holds keys for, as served by `GET /config`.
 *
 * The browser only ever learns the booleans — keys stay on the API. The index signature is what
 * lets a new keyed layer ship without editing this type, the store and the API in lockstep:
 * a layer names its capability in `requiresCapability` and the API adds the flag.
 */
export interface ServerCapabilities {
  mapy: boolean;
  cml: boolean;
  cmlProvider: string;
  owm: boolean;
  windy: boolean;
  fsq: boolean;
  [capability: string]: boolean | string;
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
  shelter: { label: "Přístřešky", group: "stay", overpass: 'node["amenity"="shelter"]' },
  via_ferrata: {
    label: "Ferraty",
    group: "sport",
    overpass: 'node["highway"="via_ferrata"]'
  },
  climbing: {
    label: "Lezecké skály",
    group: "sport",
    overpass: 'node["sport"="climbing"]'
  },
  fitness_trail: {
    label: "Fitness stezky",
    group: "sport",
    overpass: 'node["leisure"="fitness_station"]'
  },
  disc_golf: {
    label: "Disc golf",
    group: "sport",
    overpass: 'node["leisure"="disc_golf_course"]'
  },
  skatepark: {
    label: "Skateparky",
    group: "sport",
    overpass: 'node["leisure"="skatepark"]'
  },
  swimming: {
    label: "Koupaliště",
    group: "sport",
    overpass: 'node["leisure"="swimming_area"]'
  },
  sports_centre: {
    label: "Sportoviště",
    group: "sport",
    overpass: 'node["leisure"="sports_centre"]'
  }
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
