import {
  MAPOS_HOST_RUNTIME_VERSION,
  MAPOS_LAYER_SDK_RANGE,
  MAPOS_V2_SCHEMA_VERSION,
  type Bbox,
  type LayerManifestV2
} from "@mapos/layer-sdk";
import type { AdapterIo, SourceAdapter, SourceProbe } from "../contract.js";
import { SourceProbeError } from "../contract.js";

/**
 * PMTiles — a whole tile archive as one file, read with range requests.
 *
 * It matters here for the reason the format exists: a country-sized tileset can be published to
 * any static host and consumed with no tile server at all. That is what makes a community
 * layer affordable to share, so it is the format to accept from a user who has produced their
 * own tiles rather than found a service.
 *
 * The archive is identified from its own header rather than from the URL, because the extension
 * is a convention and a signed or proxied URL often has neither `.pmtiles` nor a path at all.
 * The header is 127 bytes and comes from one range request; the tile index is not read here —
 * MapLibre's PMTiles protocol does that as it draws, which is the point of the format.
 */
const HEADER_BYTES = 127;
const MAGIC = "PMTiles";

/** Tile types, from the v3 spec. `mvt` is a vector tileset and needs `sourceLayer` names to
 *  style; the raster ones can be drawn as they are. */
const TILE_TYPES = { 0: "unknown", 1: "mvt", 2: "png", 3: "jpeg", 4: "webp", 5: "avif" } as const;

interface PmTilesHeader {
  specVersion: number;
  tileType: (typeof TILE_TYPES)[keyof typeof TILE_TYPES];
  minZoom: number;
  maxZoom: number;
  bounds?: Bbox;
  metadataOffset: number;
  metadataLength: number;
  /** 1 none, 2 gzip, 3 brotli, 4 zstd — of the directories and metadata, not the tiles. */
  internalCompression: number;
}

export const pmtilesAdapter: SourceAdapter = {
  id: "pmtiles",
  label: "PMTiles",
  kinds: ["pmtiles"],

  detect(url) {
    if (url.protocol === "pmtiles:") return 1;
    if (/\.pmtiles$/i.test(url.pathname)) return 1;
    // A signed URL keeps the extension in the path but hides it behind query parameters, and a
    // proxied one may not have it at all — the header settles it either way.
    if (/\.pmtiles/i.test(url.search)) return 0.7;
    return 0;
  },

  async probe(url, io, _options) {
    if (!io.head) {
      throw new SourceProbeError(
        "Čtení PMTiles vyžaduje rozsahové dotazy, které tenhle přenos neumí.",
        url.href
      );
    }
    // `pmtiles://` is MapLibre's scheme, not a transport; the archive is fetched over HTTP.
    const endpoint = url.href.replace(/^pmtiles:\/\//, "");
    const header = parseHeader(await io.head(endpoint, HEADER_BYTES), endpoint);
    const metadata = await readMetadata(header, endpoint, io);

    const vector = header.tileType === "mvt";
    const layers = vectorLayers(metadata);
    return {
      adapterId: pmtilesAdapter.id,
      kind: "pmtiles",
      delivery: "tiles",
      endpoint,
      title: text(metadata["name"]) || lastPathSegment(endpoint),
      ...(text(metadata["description"]) ? { description: text(metadata["description"])! } : {}),
      version: String(header.specVersion),
      // A raster archive has one thing in it, so there is nothing to choose; a vector archive's
      // layers are what a style has to name.
      sublayers: vector
        ? layers.map((layer) => ({
            id: layer.id,
            title: layer.title,
            ...(layer.description ? { description: layer.description } : {}),
            selectable: true,
            minZoom: header.minZoom,
            maxZoom: header.maxZoom,
            ...(header.bounds ? { bbox: header.bounds } : {})
          }))
        : [
            {
              id: "0",
              title: text(metadata["name"]) || "Dlaždice",
              selectable: true,
              minZoom: header.minZoom,
              maxZoom: header.maxZoom,
              ...(header.bounds ? { bbox: header.bounds } : {})
            }
          ],
      formats: [
        `image/${header.tileType}`.replace("image/mvt", "application/vnd.mapbox-vector-tile")
      ],
      // PMTiles v3 is Web Mercator by definition, which is why there is nothing to negotiate.
      crs: ["EPSG:3857"],
      ...(text(metadata["attribution"])
        ? { attribution: [{ label: stripTags(text(metadata["attribution"])!) }] }
        : {}),
      extra: { vector, minZoom: header.minZoom, maxZoom: header.maxZoom }
    } satisfies SourceProbe;
  },

  tileTemplate(request) {
    // The `pmtiles://` prefix is what tells MapLibre to route this through the protocol handler
    // registered in the web app, which turns each `{z}/{x}/{y}` into a range request.
    return `pmtiles://${request.probe.endpoint}/{z}/{x}/{y}`;
  },

  describe(request) {
    const { probe, layerId } = request;
    const vector = probe.extra?.vector === true;
    const chosen = request.sublayerIds.length
      ? request.sublayerIds
      : probe.sublayers.filter((sublayer) => sublayer.selectable).map(({ id }) => id);
    const minZoom = Number(probe.extra?.minZoom);
    const maxZoom = Number(probe.extra?.maxZoom);

    return {
      schema: "mapos.layer-manifest",
      schemaVersion: MAPOS_V2_SCHEMA_VERSION,
      sdkRange: MAPOS_LAYER_SDK_RANGE,
      minimumRuntime: MAPOS_HOST_RUNTIME_VERSION,
      id: layerId,
      name: request.name || probe.title,
      description: probe.description ?? probe.title,
      category: request.category ?? "user",
      geometryKinds: vector ? ["VectorTile"] : ["Raster"],
      renderer: vector
        ? // A vector archive carries geometry without cartography, and guessing a fill colour per
          // layer is the runtime's job, not the adapter's.
          { type: "vector-style", style: { sourceLayers: chosen } }
        : { type: "raster" },
      source: {
        type: vector ? "vector-tiles" : "raster-tiles",
        tileTemplate: pmtilesAdapter.tileTemplate!(request),
        adapterId: pmtilesAdapter.id
      },
      queryPolicy: {
        strategy: "tile",
        ...(Number.isFinite(minZoom) ? { minZoom } : {}),
        ...(Number.isFinite(maxZoom) ? { maxZoom } : {})
      },
      capabilities: [],
      ...(probe.attribution?.length ? { attribution: probe.attribution } : {})
    } satisfies LayerManifestV2;
  }
};

/** The v3 header, little-endian throughout. Field offsets are from the specification. */
export function parseHeader(bytes: Uint8Array, url: string): PmTilesHeader {
  if (bytes.length < HEADER_BYTES) {
    throw new SourceProbeError("Soubor je kratší než hlavička PMTiles.", url);
  }
  const magic = String.fromCharCode(...bytes.subarray(0, MAGIC.length));
  if (magic !== MAGIC) {
    throw new SourceProbeError("Tohle není archiv PMTiles.", url);
  }
  const specVersion = bytes[7]!;
  if (specVersion !== 3) {
    // v2 archives have a different index and MapLibre's protocol will not read them.
    throw new SourceProbeError(
      `PMTiles verze ${specVersion} se už nečte; převeď archiv na verzi 3.`,
      url
    );
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bounds = degrees(view, 102);
  return {
    specVersion,
    // Byte offsets are fixed by the v3 specification: clustered 96, internal compression 97,
    // tile compression 98, tile type 99, then the zoom range and the bounds.
    tileType: TILE_TYPES[bytes[99] as keyof typeof TILE_TYPES] ?? "unknown",
    minZoom: bytes[100]!,
    maxZoom: bytes[101]!,
    ...(bounds ? { bounds } : {}),
    metadataOffset: Number(view.getBigUint64(24, true)),
    metadataLength: Number(view.getBigUint64(32, true)),
    internalCompression: bytes[97]!
  };
}

/** Coordinates are stored as signed 32-bit integers scaled by 10^7. */
function degrees(view: DataView, offset: number): Bbox | undefined {
  const values = [0, 4, 8, 12].map((step) => view.getInt32(offset + step, true) / 1e7);
  const [west, south, east, north] = values as [number, number, number, number];
  if (west >= east || south >= north) return undefined;
  if (
    Math.abs(west) > 180 ||
    Math.abs(east) > 180 ||
    Math.abs(south) > 90 ||
    Math.abs(north) > 90
  ) {
    return undefined;
  }
  return [west, south, east, north];
}

/**
 * The archive's TileJSON-ish metadata block, which is where a vector archive names its layers.
 *
 * Usually gzipped, and decompressed with `DecompressionStream` — available in both Node and the
 * browser, so this stays free of a platform-specific import. An archive using brotli or zstd
 * internally is read as having no metadata rather than failing the probe: a raster layer needs
 * none of this, and a vector one degrades to "no named layers" instead of to no layer.
 */
async function readMetadata(
  header: PmTilesHeader,
  endpoint: string,
  io: AdapterIo
): Promise<Record<string, unknown>> {
  if (!header.metadataLength || header.metadataLength > 4_000_000) return {};
  try {
    const bytes = await io.head!(endpoint, header.metadataLength, header.metadataOffset);
    const json =
      header.internalCompression === 2 ? await gunzip(bytes) : new TextDecoder().decode(bytes);
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function gunzip(bytes: Uint8Array): Promise<string> {
  // `DecompressionStream` rather than `node:zlib`: this package is bundled into the browser too,
  // and a Node builtin here would break that build. Written as a writer and a reader rather than
  // as `pipeThrough` because the DOM and Node type definitions disagree about the stream's
  // element type, and the two halves of the monorepo compile against different ones.
  const decompressor = new DecompressionStream("gzip");
  const writer = decompressor.writable.getWriter();
  // Copied into a buffer the stream will accept: a `Uint8Array` may be backed by a shared buffer,
  // which `write` does not take.
  const owned = new Uint8Array(bytes.byteLength);
  owned.set(bytes);
  void writer.write(owned).then(() => writer.close());
  const reader = decompressor.readable.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

interface VectorLayer {
  id: string;
  title: string;
  description?: string;
}

function vectorLayers(metadata: Record<string, unknown>): VectorLayer[] {
  const raw = metadata["vector_layers"];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const id = text(record["id"]);
    if (!id) return [];
    const description = text(record["description"]);
    return [{ id, title: id, ...(description ? { description } : {}) }];
  });
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Attribution in TileJSON is HTML. The map's attribution bar renders its own markup, so the
 *  tags are dropped rather than passed through. */
function stripTags(value: string): string {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function lastPathSegment(endpoint: string): string {
  const segments = endpoint.split("?")[0]!.split("/").filter(Boolean);
  return (segments[segments.length - 1] ?? "PMTiles").replace(/\.pmtiles$/i, "");
}
