import type { JsonValue, VersionEnvelope } from "./common.js";

export type LayerCategoryV2 =
  | "travel"
  | "city"
  | "sport"
  | "weather"
  | "events"
  | "user"
  | "game"
  | "routing"
  | "outdoor"
  | "transport"
  | "environment"
  | "community"
  | "infrastructure"
  | "moving";

export type LayerModeV2 = "personal" | "discover" | "planning" | "game";
export type GeometryKindV2 =
  | "Point"
  | "MultiPoint"
  | "LineString"
  | "MultiLineString"
  | "Polygon"
  | "MultiPolygon"
  | "Raster"
  | "VectorTile"
  | "CustomGL";

export interface RendererDescriptorV2 {
  type:
    | "symbols"
    | "circles"
    | "line"
    | "fill"
    | "heatmap"
    | "raster"
    | "vector-style"
    | "custom-gl"
    | "three";
  cluster?: boolean;
  clusterMaxZoom?: number;
  clusterRadiusPx?: number;
  style?: Record<string, JsonValue>;
  zIndex?: number;
}

export interface LayerSourceV2 {
  type:
    | "static"
    | "declarative-http"
    | "server-adapter"
    | "raster-tiles"
    | "vector-tiles"
    | "realtime"
    | "user-data"
    | "computed"
    | "custom-runtime";
  adapterId?: string;
  endpoint?: string;
  method?: "GET" | "POST";
  tileTemplate?: string;
  responseAdapter?: string;
  requiresServerProxy?: boolean;
  /** Opaque server-side credential reference. Secrets never belong in a manifest. */
  authRef?: string;
  /** Fixed query keys mapped to bounded MapOS query values; no string templates are executed. */
  query?: Record<string, DeclarativeHttpQueryValueV2>;
  /** Declarative response projection. Dot paths are data lookups, never executable code. */
  mapping?: DeclarativeHttpMappingV2;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

export type DeclarativeHttpQueryValueV2 =
  "bbox" | "west" | "south" | "east" | "north" | "limit" | "cursor" | "zoom" | `filter:${string}`;

export interface DeclarativeHttpMappingV2 {
  itemsPath?: string;
  idPath: string;
  titlePath: string;
  categoryPath?: string;
  longitudePath: string;
  latitudePath: string;
  summaryPath?: string;
  descriptionPath?: string;
  sourceIdPath?: string;
  nextCursorPath?: string;
}

export interface LayerQueryPolicyV2 {
  strategy: "viewport" | "tile" | "realtime" | "global" | "manual";
  maxResultsPerViewport?: number;
  debounceMs?: number;
  minZoom?: number;
  maxZoom?: number;
  searchHere?: "never" | "after-pan" | "manual-only" | "when-empty";
  ranking?: "distance" | "relevance" | "popularity" | "time" | "provider" | "hybrid";
  cacheTtlSeconds?: number;
  staleWhileRevalidateSeconds?: number;
  cursorPagination?: boolean;
}

export interface FilterFacetV2 {
  id: string;
  label: string;
  kind: "multi-select" | "single-select" | "toggle" | "range" | "text" | "date-range" | "distance";
  options?: Array<{ id: string; label: string; icon?: string }>;
  min?: number;
  max?: number;
  step?: number;
  default?: unknown;
  providerField?: string;
}

export interface DetailManifestV2 {
  tabs?: Array<{
    id: string;
    label: string;
    source: "canonical" | "provider" | "mapos-social" | "ai" | "media" | "custom";
    providerId?: string;
  }>;
  fieldOrder?: string[];
  aiEnrichment?: "disabled" | "on-open" | "on-demand" | "background";
}

export interface ActionManifestV2 {
  id: string;
  label: string;
  kind:
    | "open-url"
    | "save"
    | "share"
    | "route-to"
    | "comment"
    | "review"
    | "provider-action"
    | "purchase"
    | "tip"
    | "custom";
  urlTemplate?: string;
  requiresPermission?: string;
  providerId?: string;
}

export interface LayerAttributionV2 {
  label: string;
  url?: string;
  license?: string;
  requiredOnMap?: boolean;
  requiredOnExport?: boolean;
}

export type LayerCapabilityV2 =
  | "query"
  | "filter"
  | "detail"
  | "comments"
  | "reviews"
  | "media"
  | "export"
  | "import"
  | "realtime"
  | "temporal"
  | "routing"
  | "ai-search"
  | "ai-enrich"
  | "commerce"
  | "collaboration"
  | "game";

export interface TemporalManifestV2 {
  enabled: boolean;
  cursorKinds?: Array<"instant" | "range" | "forecast" | "replay">;
  defaultRangeHours?: number;
  timelinePriority?: number;
}

export interface LegendManifestV2 {
  type?: "categorical" | "continuous" | "numeric" | "icon" | "custom";
  title?: string;
  unit?: string;
  items?: Array<{
    label: string;
    value?: unknown;
    color?: string;
    icon?: string;
    description?: string;
  }>;
  min?: number;
  max?: number;
  stops?: Array<{ value: number; label: string; color?: string }>;
}

export interface PermissionManifestV2 {
  defaultVisibility?: "public" | "unlisted" | "private" | "entitled";
  canCreate?: boolean;
  canEdit?: boolean;
  canComment?: boolean;
  canExport?: boolean;
  requiresAuth?: boolean;
}

export interface AiExposureManifestV2 {
  discoverable?: boolean;
  searchableFields?: string[];
  tools?: string[];
  permissionProjection?:
    "metadata-only" | "public-features" | "entitled-features" | "owner-private" | "disabled";
}

export interface CommerceManifestV2 {
  access?: "free" | "entitlement" | "subscription" | "one-time" | "external";
  productId?: string;
  previewPolicy?: "none" | "metadata" | "sample" | "blurred";
  tipsEnabled?: boolean;
  referralUrlTemplate?: string;
}

export interface ImportExportManifestV2 {
  importFormats?: Array<"geojson" | "gpx" | "kml" | "csv" | "json" | "mapos-package">;
  exportFormats?: Array<"geojson" | "gpx" | "kml" | "csv" | "json" | "mapos-package">;
  includeProviderFields?: boolean;
}

export interface LayerHealthV2 {
  checkEndpoint?: string;
  expectedLatencyMs?: number;
  failureMode?: "hide" | "disabled-with-reason" | "stale-cache" | "empty-with-notice";
}

export interface LayerCompatibilityV2 {
  legacyLayerId?: string;
  legacyAdapter?: string;
  deprecatedAfter?: string;
  migrationNotes?: string;
}

export interface LayerManifestV2 extends VersionEnvelope {
  schema: "mapos.layer-manifest";
  schemaVersion: string;
  sdkRange: string;
  /** Oldest MapOS host release known to implement every capability used by this layer. */
  minimumRuntime?: string;
  id: string;
  name: string;
  description: string;
  icon?: string;
  color?: string;
  category: LayerCategoryV2;
  presetIds?: Array<"trip" | "city" | "travel" | "sport">;
  modes?: LayerModeV2[];
  worldIds?: string[];
  geometryKinds: GeometryKindV2[];
  renderer: RendererDescriptorV2;
  source: LayerSourceV2;
  queryPolicy: LayerQueryPolicyV2;
  filters?: FilterFacetV2[];
  detail?: DetailManifestV2;
  actions?: ActionManifestV2[];
  /** Optional advisory provenance metadata in the operator-approved prototype. */
  attribution?: LayerAttributionV2[];
  capabilities: LayerCapabilityV2[];
  requiresServerCapabilities?: string[];
  temporal?: TemporalManifestV2;
  legend?: LegendManifestV2;
  permissions?: PermissionManifestV2;
  ai?: AiExposureManifestV2;
  commerce?: CommerceManifestV2;
  importExport?: ImportExportManifestV2;
  health?: LayerHealthV2;
  compatibility?: LayerCompatibilityV2;
}
