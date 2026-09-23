import { config } from "../config.js";
import { fetchBytes } from "../utils/upstream.js";

/**
 * Mapillary street objects, proxied so the access token never reaches the browser.
 *
 * Mapillary publishes map features — poles, benches, bike racks, traffic signs, road markings — as
 * vector tiles on `tiles.mapillary.com`. The token is a secret, so the tiles come through our own
 * origin (`/street-objects/:source/:z/:x/:y`) rather than being fetched by the browser with a key
 * in the URL. That also means the key never appears in a log, a Referer or a browser history.
 *
 * Two tile sets, matching Mapillary's own split and the categories the catalogue agreed:
 *
 *  - `point` carries objects and road markings (source layer `point`);
 *  - `sign` carries traffic signs (source layer `traffic_sign`).
 *
 * The map layer reads the `object_value` each feature carries, so one tile source serves several
 * catalogue rows without a second download.
 */

/** Mapillary's tile sets, keyed by the short name our route exposes. */
const TILE_SETS = {
  point: {
    upstream: "mly_map_feature_point",
    /** The layer name inside the tile. */
    sourceLayer: "point"
  },
  sign: {
    upstream: "mly_map_feature_traffic_sign",
    sourceLayer: "traffic_sign"
  }
} as const;

export type StreetObjectSource = keyof typeof TILE_SETS;

export function isStreetObjectSource(value: string): value is StreetObjectSource {
  return value === "point" || value === "sign";
}

export function streetObjectSourceLayer(source: StreetObjectSource): string {
  return TILE_SETS[source].sourceLayer;
}

export class StreetObjectsUnavailableError extends Error {
  constructor() {
    super("Mapillary access token is not configured");
    this.name = "StreetObjectsUnavailableError";
  }
}

/** One vector tile of street objects, fetched with the server's token.
 *
 *  A tile, not a bbox query: Mapillary limits bbox searches to 0.01° square, while a tile is what
 *  MapLibre asks for anyway. Cached for a week, because a bench or a sign does not move. */
export async function fetchStreetObjectTile(
  source: StreetObjectSource,
  z: number,
  x: number,
  y: number,
  signal?: AbortSignal
): Promise<{ body: ArrayBuffer; contentType: string }> {
  const token = config.layerKeys.mapillary;
  if (!token) throw new StreetObjectsUnavailableError();

  const set = TILE_SETS[source];
  const url =
    `https://tiles.mapillary.com/maps/vtp/${set.upstream}/2/${z}/${x}/${y}` +
    `?access_token=${encodeURIComponent(token)}`;

  return fetchBytes(url, {
    providerId: "mapillary",
    signal,
    timeoutMs: 12_000,
    ttlMs: 7 * 24 * 3600_000,
    maxResponseBytes: 4 * 1024 * 1024,
    // Mapillary serves an unlabelled binary body for vector tiles.
    acceptedContentTypes: [
      "application/octet-stream",
      "application/x-protobuf",
      "application/vnd.mapbox-vector-tile",
      "binary/octet-stream"
    ]
  });
}

/** The catalogue's agreed split of Mapillary object classes, so the layer's facet and the map's
 *  legend name the same things the tiles contain. Each entry lists the `object_value` prefixes it
 *  owns; a value matches a category when it starts with one of them. */
export const STREET_OBJECT_CATEGORIES = [
  {
    id: "signs",
    label: "Dopravní značky",
    source: "sign" as const,
    prefixes: [""],
    color: "#dc2626"
  },
  {
    id: "crossings",
    label: "Přechody a řízení dopravy",
    source: "point" as const,
    prefixes: [
      "construction--flat--crosswalk",
      "marking--discrete--crosswalk",
      "object--traffic-light",
      "object--support--traffic-sign-frame",
      "marking--discrete--stop-line",
      "marking--discrete--give-way",
      "marking--discrete--arrow"
    ],
    color: "#f59e0b"
  },
  {
    id: "cycle",
    label: "Cyklistická infrastruktura",
    source: "point" as const,
    prefixes: ["object--bike-rack", "marking--discrete--symbol--bicycle"],
    color: "#7c3aed"
  },
  {
    id: "power",
    label: "Elektřina",
    source: "point" as const,
    prefixes: ["object--support--utility-pole", "object--support--pole", "object--catenary"],
    color: "#eab308"
  },
  {
    id: "network",
    label: "Sítě",
    source: "point" as const,
    prefixes: ["object--junction-box", "object--cctv-camera", "object--support--"],
    color: "#8b5cf6"
  },
  {
    id: "water",
    label: "Voda a kanalizace",
    source: "point" as const,
    prefixes: ["object--catch-basin", "object--manhole", "object--fire-hydrant"],
    color: "#0ea5e9"
  },
  {
    id: "furniture",
    label: "Vybavení veřejného prostoru",
    source: "point" as const,
    prefixes: [
      "object--bench",
      "object--mailbox",
      "object--phone-booth",
      "object--sign--information",
      "object--sign--advertisement",
      "object--sign--store",
      "object--street-light",
      "object--parking-meter",
      "object--traffic-cone",
      "object--banner",
      "object--"
    ],
    color: "#14b8a6"
  }
] as const;

export type StreetObjectCategoryId = (typeof STREET_OBJECT_CATEGORIES)[number]["id"];

export function streetObjectCategoryIds(): StreetObjectCategoryId[] {
  return STREET_OBJECT_CATEGORIES.map((category) => category.id);
}
