import type {
  Bbox,
  FeatureCollection,
  LayerAttributionV2,
  LayerCategoryV2,
  LayerManifestV2
} from "@mapos/layer-sdk";

/**
 * What kind of thing a URL turned out to be.
 *
 * Deliberately the service protocol rather than the vendor: `arcgis-mapserver` is one entry
 * because every ArcGIS map service answers the same requests, while `wms` and `wmts` are two
 * because they do not, whoever is serving them.
 */
export type SourceKind =
  | "wms"
  | "wmts"
  | "xyz"
  | "tilejson"
  | "pmtiles"
  | "arcgis-mapserver"
  | "arcgis-featureserver"
  | "geojson"
  | "stat-series";

/** How a source's data reaches the map, which decides what the caller has to ask the adapter
 *  for next: a tile URL the map fetches itself, or features fetched per viewport. */
export type SourceDelivery = "tiles" | "features";

/**
 * The network an adapter is allowed to use.
 *
 * Injected rather than imported so an adapter carries no fetch stack of its own. On the server
 * this is backed by `apps/api/src/utils/upstream.ts` — DNS pinning, timeouts, size caps, the
 * circuit breaker and the offline guard — none of which an adapter should be able to opt out of,
 * and all of which matter more than usual because the URL came from a user.
 */
export interface AdapterIo {
  text(url: string, options?: AdapterIoOptions): Promise<string>;
  json(url: string, options?: AdapterIoOptions): Promise<unknown>;
  /**
   * A byte range, as a `Range` request.
   *
   * PMTiles is the reason this exists: an archive is one file of up to hundreds of gigabytes,
   * and it is read by asking for its 127-byte header and then for the blocks the header points
   * at. A transport that cannot do this can still serve every other adapter, which is why it is
   * optional rather than part of `text` and `json`.
   */
  head?(url: string, byteLength: number, offset?: number): Promise<Uint8Array>;
}

export interface AdapterIoOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** One selectable thing inside a source: a WMS layer, a WMTS tile matrix set, an ArcGIS sublayer.
 *  Sources routinely publish hundreds, so this is what the wizard lists. */
export interface SourceSublayer {
  /** The identifier the service expects back, verbatim. Not a slug — WMS layer names contain
   *  colons and dots, and rewriting one makes the request fail. */
  id: string;
  title: string;
  description?: string;
  /** Absent for a group entry that exists only to nest others and cannot itself be drawn. */
  selectable: boolean;
  /** WGS84 extent the service claims to cover, when it declares one. */
  bbox?: Bbox;
  minZoom?: number;
  maxZoom?: number;
  legendUrl?: string;
  /** WMS time domain as advertised. Intervals remain compact, never eagerly expanded. */
  time?: {
    units: string;
    values: string;
    default?: string;
    nearestValue?: boolean;
    multipleValues?: boolean;
    current?: boolean;
  };
}

/**
 * What one probe of a URL found: the service, and everything needed to describe it as a layer
 * without going back to the network.
 *
 * Serialisable on purpose. The wizard probes once on the server and the result is what the
 * client picks sublayers from, so it has to survive JSON.
 */
export interface SourceProbe {
  adapterId: string;
  kind: SourceKind;
  delivery: SourceDelivery;
  /** The URL to make requests against, normalised — query parameters that belonged to the probe
   *  itself (`request=GetCapabilities`, `f=json`) are removed. */
  endpoint: string;
  title: string;
  description?: string;
  /** Service version, where the protocol has more than one in the wild. WMS 1.1.1 and 1.3.0
   *  disagree about axis order, so this is not cosmetic. */
  version?: string;
  sublayers: SourceSublayer[];
  attribution?: LayerAttributionV2[];
  /** Image or tile formats the service offers, most preferred first. */
  formats?: string[];
  /** Coordinate reference systems the service offers. */
  crs?: string[];
  /** Anything the adapter wants to carry into `describe` that is specific to this protocol. */
  extra?: Record<string, string | number | boolean>;
}

/** What the caller wants built, once a human has chosen from the probe. */
export interface DescribeRequest {
  probe: SourceProbe;
  /** Chosen from `probe.sublayers`. Empty means the adapter picks a sensible default. */
  sublayerIds: string[];
  /** The layer id to mint. The caller owns it because it has to be unique across the registry,
   *  which an adapter cannot see. */
  layerId: string;
  /** Overrides the service's own title. */
  name?: string;
  /**
   * Which section of Layers the result belongs in.
   *
   * The adapter cannot know: a WMS endpoint serves flood maps and cadastre alike, and the
   * protocol says nothing about which. It defaults to `user`, which is the honest answer for a
   * layer that exists because somebody pasted a URL.
   */
  category?: LayerCategoryV2;
}

/**
 * Turns a URL into a MapOS layer.
 *
 * Split into `detect` (free, no network), `probe` (one request) and `describe` (pure) because
 * the wizard needs exactly that: rank candidates from the URL alone, ask only the winner, and
 * then let the user re-pick sublayers without paying for another round trip.
 */
export interface SourceAdapter {
  id: string;
  /** Shown in the wizard when more than one adapter could handle a URL. */
  label: string;
  kinds: readonly SourceKind[];

  /**
   * How likely this URL is this adapter's, from the URL alone: 0 for "not mine", 1 for an
   * unmistakable match. Never throws and never touches the network, so the wizard can rank every
   * adapter on every keystroke.
   */
  detect(url: URL): number;

  probe(url: URL, io: AdapterIo, options?: AdapterIoOptions): Promise<SourceProbe>;

  /** Pure: same probe and selection always give the same manifest. */
  describe(request: DescribeRequest): LayerManifestV2;

  /** For a `tiles` source. The template keeps MapLibre's placeholders (`{z}`, `{bbox-epsg-3857}`)
   *  unencoded, which is why this returns a template rather than a resolved URL. */
  tileTemplate?(request: DescribeRequest): string;

  /** For a `features` source, queried per viewport. */
  features?(
    request: DescribeRequest,
    bbox: Bbox,
    io: AdapterIo,
    options?: AdapterIoOptions
  ): Promise<FeatureCollection>;
}

/** Raised when a URL reached the right adapter but the service did not answer usefully. Separate
 *  from a network failure: the caller shows this to the user, who can fix the URL. */
export class SourceProbeError extends Error {
  constructor(
    message: string,
    readonly url: string
  ) {
    super(message);
    this.name = "SourceProbeError";
  }
}
