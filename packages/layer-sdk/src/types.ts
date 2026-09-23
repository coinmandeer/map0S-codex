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
  | "community"
  /** Thematic statistics drawn as choropleths (§23): one switch per question, many sources. */
  | "statistics";

/** The bottom-nav sections. A layer declares which ones it belongs to, so adding a layer to a
 *  section is a property of the layer rather than a list the shell has to be taught about. */
/** The five persistent work contexts shown by the application shell. */
export type ModeId = "planning" | "discover" | "mine" | "game" | "weather";

/** Kept as an alias for plugin authors compiled against the original SDK name. */
export type LayerMode = ModeId;

export type ExperienceId = "default" | "aavegotchi" | (string & {});

export interface ExperienceManifest {
  id: ExperienceId;
  name: string;
  description: string;
  icon: string;
  accent: string;
  recommendedIntegrationIds: string[];
  gameIds: string[];
  avatarProviderId?: string;
}

export type SurfaceKind = "basemap" | "labels" | "terrain" | "weather" | "data";

export interface SurfaceManifest {
  id: string;
  name: string;
  kind: SurfaceKind;
  description: string;
  temporal?: boolean;
  exclusiveGroup?: string;
}

export interface TemporalState {
  cursor: string;
  mode: "live" | "preview";
  timezone: string;
  rangeStart: string;
  rangeEnd: string;
}

export interface GameManifest {
  id: string;
  name: string;
  experienceIds: ExperienceId[];
  maxEntities: number;
  refreshIntervalMs: number;
  temporal: boolean;
}

export type TripTravelProfile = "foot" | "bike" | "car" | "moto" | "camper" | "truck";
export type TripRouteVariant = "fast" | "short" | "nohwy";

export interface TripStop {
  id: string;
  name: string;
  lng: number;
  lat: number;
  dwellMinutes: number;
}

export interface TripVehicle {
  profile: TripTravelProfile;
  heightM?: number | null;
  widthM?: number | null;
  weightT?: number | null;
  fuel?: "petrol" | "diesel" | "cng" | "lng" | "phev" | "bev" | "h2" | null;
  euroClass?: string | null;
  evRangeKm?: number | null;
}

export interface TripPlanSummary {
  variant: TripRouteVariant;
  distanceM: number;
  durationS: number;
  tollEstimatedCzk: number | null;
  weatherStops: number;
  totalWeatherStops: number;
  restrictionCheck: "checked" | "unavailable" | "not-applicable";
  restrictionWarnings: number;
  generatedAt: string;
}

export interface TripPlan {
  id: string;
  name: string;
  departureAt: string;
  variant: TripRouteVariant;
  stops: TripStop[];
  vehicle: TripVehicle;
  visibility: "private" | "unlisted" | "public";
  lastResult?: TripPlanSummary;
  createdAt?: string;
  updatedAt?: string;
}

export interface TripLeg {
  index: number;
  fromStopId: string;
  toStopId: string;
  coordinates: [number, number][];
  distanceM: number;
  durationS: number;
  departureAt: string;
  arrivalAt: string;
}

export interface TripWeatherSample {
  stopId: string;
  at: string;
  temperature: number | null;
  precipitation: number | null;
  weatherCode: number | null;
}

export interface TripRestriction {
  kind: "maxheight" | "maxweight" | "maxwidth" | "maxlength" | "hgv";
  lng: number;
  lat: number;
  limit: number | null;
  raw: string;
  name: string | null;
  exceedsVehicle: boolean;
}

export interface TripTollItem {
  countryCode: string;
  label: string;
  estimatedCzk: number | null;
  officialUrl: string | null;
}

export interface TripPlanVariantResult {
  variant: TripRouteVariant;
  provider: "osm" | "mapy";
  profile: string;
  coordinates: [number, number][];
  distanceM: number;
  durationS: number;
  legs: TripLeg[];
  toll: { estimatedCzk: number | null; items: TripTollItem[]; disclaimer: string };
  restrictions: TripRestriction[];
  restrictionCheck: "checked" | "unavailable" | "not-applicable";
  warnings: string[];
}

export interface TripPlanResult {
  plan: TripPlan;
  selectedVariant: TripRouteVariant;
  variants: TripPlanVariantResult[];
  weather: TripWeatherSample[];
  generatedAt: string;
}

export type SocialTargetType = "user" | "place" | "layer" | "region" | "route" | "quest" | "game";

export interface CanonicalPlace {
  placeId: string;
  name: string;
  lng: number;
  lat: number;
  category: string | null;
  sources: Array<{ source: string; sourceRef: string }>;
  social: { followers: number; reviews: number; rating: number | null; comments: number };
}

export type WizardContentType = "place" | "layer" | "route" | "task" | "quest" | "event" | "post";

export type ContentReviewStatus =
  "draft" | "in-review" | "changes-requested" | "approved" | "rejected";

/** Public, portable provenance attached to a contribution. Authentication-derived authorship
 * lives in `workflow.authorId`; the client is never trusted to choose it. */
export interface ContentDraftProvenance {
  kind: "user-contribution";
  source: "create" | "discover" | "feed";
  sourceLabel: string;
  regionId?: string;
  regionName?: string;
  capturedAt: string;
}

/** Minimal open review contract. It deliberately models moderation without coupling the SDK to
 * one moderation vendor or UI. */
export interface ContentDraftWorkflow {
  revision: number;
  status: ContentReviewStatus;
  authorId: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewerId: string | null;
  moderationNote: string | null;
}

export interface ContentDraft {
  id: string;
  type: WizardContentType;
  name: string;
  description: string;
  geometry:
    | { type: "Point"; coordinates: [number, number] }
    | { type: "LineString"; coordinates: [number, number][] };
  startsAt: string | null;
  endsAt: string | null;
  visibility: "private" | "unlisted" | "public";
  provenance?: ContentDraftProvenance;
  workflow?: ContentDraftWorkflow;
  updatedAt?: string;
}

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
  /** Experiences in which this integration is meaningful. Missing means universally available. */
  experienceIds?: ExperienceId[];
  /** Stable grouping in the integrations drawer. */
  uiGroup?: "places" | "community" | "travel" | "game" | "environment";
  /** Whether the layer consumes the shared map time cursor. */
  temporal?: boolean;
  /** Soft lifecycle budget used by the host and diagnostics. */
  performance?: { maxEntities?: number; refreshIntervalMs?: number };
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

/**
 * A point or a line. The renderer was point-only until routes arrived — a GPX track, a saved
 * plan — and a route genuinely is a line: anchoring it to its start point and calling it a place
 * would hide the shape that makes it worth importing. Lines carry `anchorLng`/`anchorLat` in
 * their properties so anything that still needs a single position has one to use.
 */
/** Non-empty by construction, so reading the first position never needs a fallback. */
export type LinePositions = [[number, number], ...Array<[number, number]>];

export type GeoGeometry =
  | { type: "Point"; coordinates: [number, number] }
  | { type: "LineString"; coordinates: LinePositions };

export interface GeoFeature {
  type: "Feature";
  geometry: GeoGeometry;
  properties: GeoFeatureProperties;
}

/** Narrows to the point case, which most consumers still only handle. */
export function isPointFeature(
  feature: GeoFeature
): feature is GeoFeature & { geometry: { type: "Point"; coordinates: [number, number] } } {
  return feature.geometry.type === "Point";
}

/**
 * The one position that stands for a feature — where to centre the map, drop a marker or show
 * coordinates. For a point that is the point; for a route it is the anchor the producer chose
 * (a track's start), which keeps a line usable everywhere a place is listed.
 */
export function featureAnchor(feature: GeoFeature): [number, number] {
  if (feature.geometry.type === "Point") return feature.geometry.coordinates;
  const { anchorLng, anchorLat } = feature.properties;
  return typeof anchorLng === "number" && typeof anchorLat === "number"
    ? [anchorLng, anchorLat]
    : feature.geometry.coordinates[0];
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
  /** Query coverage is provider evidence, never inferred from the distribution of points. */
  query?: {
    status: "complete" | "partial" | "unavailable";
    reason?: "zoom-required" | "outside-coverage" | "budget-exhausted" | "source-error";
    bbox?: Bbox;
    truncated?: boolean;
    nextCursor?: string | null;
    revision?: string;
    retryAfterMs?: number;
    fetchedAt?: string;
    cacheTtlMs?: number;
    /** Counts for locally rendered fields that are not POI collections. */
    rendered?: { count: number; unit: "samples" | "tiles" };
  };
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
 * One attached layer instance. Data handles return data without writing it to the map: the
 * engine validates the request and invokes setData exactly once. Tile/custom renderers return
 * null and must guard any asynchronous mutation with the supplied AbortSignal.
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
  /** Optional presentation context for source-provided contrast variants. */
  theme?: "light" | "dark";
  basemapId?: string;
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
 * Which optional providers this deployment can currently serve, as returned by `GET /config`.
 *
 * The browser only ever learns the booleans — keys and readiness details stay on the API. Most
 * flags are configuration gates; providers with a readiness probe (currently Mapy.com) also go
 * false when their upstream or required local schema is unavailable. The index signature lets a
 * new keyed layer ship without editing this type, the store and the API in lockstep: a layer names
 * its capability in `requiresCapability` and the API adds the flag.
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
  observation_tower: {
    label: "Rozhledny",
    group: "nature",
    overpass: 'node["man_made"="tower"]["tower:type"="observation"]'
  },
  nature_park: {
    label: "Přírodní parky",
    group: "nature",
    overpass: 'node["boundary"="protected_area"]'
  },
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
  shop: { label: "Obchody", group: "services", overpass: 'node["shop"]' },
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
  caravan_site: {
    label: "Stání pro karavany",
    group: "stay",
    overpass: 'node["tourism"="caravan_site"]'
  },
  dump_station: {
    label: "Výlevky",
    group: "services",
    overpass: 'node["amenity"="sanitary_dump_station"]'
  },
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
  fitness_centre: {
    label: "Posilovny",
    group: "sport",
    overpass: 'node["leisure"="fitness_centre"]'
  },
  disc_golf: {
    label: "Disc golf",
    group: "sport",
    overpass: 'node["leisure"="disc_golf_course"]'
  },
  golf: {
    label: "Golf",
    group: "sport",
    overpass: 'node["leisure"="golf_course"]'
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
  },
  airport: {
    label: "Letiště",
    group: "services",
    overpass: 'node["aeroway"="aerodrome"]'
  },
  helipad: {
    label: "Heliporty",
    group: "services",
    overpass: 'node["aeroway"="helipad"]'
  },
  // Cash access points, kept apart from the Bitcoin rows so "where can I actually get or
  // deposit money" reads as one family. `bitcoin_atm` intentionally re-queries amenity=atm
  // with the currency filter, so an ATM with XBT support appears in both rows on purpose.
  atm: { label: "Bankomaty", group: "services", overpass: 'node["amenity"="atm"]' },
  bank: { label: "Banky", group: "services", overpass: 'node["amenity"="bank"]' },
  lighthouse: {
    label: "Majáky",
    group: "nature",
    overpass: 'node["man_made"="lighthouse"]'
  },
  // Bitcoin places, using the exact OpenStreetMap tagging BTC Map is built on
  // (currency:XBT marks places that take bitcoin, including ATMs; payment:bitcoin does the
  // same for merchants). No key, no vendor: BTC Map itself re-reads these tags every 10 min.
  bitcoin_atm: {
    label: "Bitcoinmaty",
    group: "services",
    overpass: 'node["amenity"="atm"]["currency:XBT"="yes"]'
  },
  bitcoin: {
    label: "Platby Bitcoinem",
    group: "services",
    overpass: 'node["payment:bitcoin"="yes"]'
  }
} as const;

export type OsmPoiCategoryId = keyof typeof OSM_POI_CATEGORIES;

/** What someone sleeping in a van looks for — the openly licensed answer to Park4Night. */
export const VANLIFE_CATEGORIES = [
  "caravan_site",
  "camp_site",
  "dump_station",
  "drinking_water",
  "toilets",
  "shower",
  "parking"
] as const satisfies readonly OsmPoiCategoryId[];

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
