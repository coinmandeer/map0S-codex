import {
  MAPOS_HOST_RUNTIME_VERSION,
  MAPOS_LAYER_SDK_RANGE,
  MAPOS_V2_SCHEMA_VERSION,
  type LayerManifestV2
} from "@mapos/layer-sdk";
import type { DescribeRequest, SourceAdapter, SourceProbe } from "../contract.js";
import { SourceProbeError } from "../contract.js";
import { queryParam, serviceEndpoint } from "../registry.js";
import { flattenWmsLayers, parseWmsCapabilities, type WmsVersion } from "./capabilities.js";
import { wmsTimeChoices } from "./time.js";

/**
 * WMS: the format almost every public authority in Europe already serves.
 *
 * MapLibre has no WMS client, but it does substitute a tile's extent into
 * `{bbox-epsg-3857}` in a raster URL, and a WMS GetMap for that extent at 256×256 is a tile. So
 * "supporting WMS" is really building the GetMap template — no proxy, no server-side rendering,
 * and the tiles are fetched by the browser like any others.
 *
 * The one hard requirement is that the service can answer in Web Mercator. A service publishing
 * only EPSG:5514 or 4326 cannot be tiled this way, and `describe` says so rather than producing
 * a layer that renders empty or skewed.
 */
const PROBE_PARAMS = [
  "service",
  "request",
  "version",
  "format",
  "layers",
  "styles",
  "time"
] as const;

/** MapLibre substitutes the tile extent into this. Appended raw, because percent-encoding the
 *  braces leaves the literal text in the request. */
const BBOX_PLACEHOLDER = "{bbox-epsg-3857}";

const WEB_MERCATOR = ["EPSG:3857", "EPSG:900913", "EPSG:102100"];

/** Transparent PNG first: an overlay that hides the basemap is not an overlay. */
const FORMAT_PREFERENCE = ["image/png", "image/png; mode=8bit", "image/webp", "image/gif"];

export const wmsAdapter: SourceAdapter = {
  id: "wms",
  label: "WMS",
  kinds: ["wms"],

  detect(url) {
    const service = queryParam(url, "service")?.toLowerCase();
    const request = queryParam(url, "request")?.toLowerCase();
    if (service === "wms") return request === "getcapabilities" ? 1 : 0.9;
    if (service === "wmts" || service === "wfs") return 0;
    const path = url.pathname.toLowerCase();
    // `.../WMSServer` (ArcGIS) and `.../wms` (GeoServer, MapServer, QGIS Server) are the two
    // conventional endpoint spellings, and both are strong enough on their own to be worth one
    // GetCapabilities request.
    if (/\/wmsserver\/?$/.test(path) || /\/wms\/?$/.test(path)) return 0.8;
    if (path.includes("/wms")) return 0.5;
    // `service=` is missing but the path says nothing either. A GetCapabilities is cheap and the
    // registry only reaches here when nothing better matched.
    return /getcapabilities/i.test(url.search) ? 0.3 : 0;
  },

  async probe(url, io, options) {
    const endpoint = serviceEndpoint(url, PROBE_PARAMS);
    const version = (queryParam(url, "version") === "1.1.1" ? "1.1.1" : "1.3.0") as WmsVersion;
    const xml = await io.text(capabilitiesUrl(endpoint, version), options);
    if (!/<(?:[\w.-]+:)?(?:WMS_Capabilities|WMT_MS_Capabilities|Capability)\b/i.test(xml)) {
      throw new SourceProbeError(
        "Odpověď nevypadá jako WMS GetCapabilities. Zkontroluj adresu služby.",
        endpoint
      );
    }

    const capabilities = parseWmsCapabilities(xml);
    const layers = flattenWmsLayers(capabilities.layers);
    if (!layers.some((layer) => layer.selectable)) {
      throw new SourceProbeError("Služba nenabízí žádnou vykreslitelnou vrstvu.", endpoint);
    }

    return {
      adapterId: wmsAdapter.id,
      kind: "wms",
      delivery: "tiles",
      // A service that advertises its own GetMap URL means it, and ignoring that is how you get
      // a layer of 404s from an endpoint whose capabilities loaded fine.
      endpoint: capabilities.getMapUrl
        ? serviceEndpoint(new URL(capabilities.getMapUrl, endpoint), PROBE_PARAMS)
        : endpoint,
      title: capabilities.title,
      ...(capabilities.abstract ? { description: capabilities.abstract } : {}),
      version: capabilities.version,
      sublayers: layers.map(
        ({ children: _children, crs: _crs, queryable: _queryable, ...rest }) => rest
      ),
      formats: capabilities.formats,
      crs: capabilities.crs.length ? capabilities.crs : (layers[0]?.crs ?? []),
      ...(capabilities.attributionLabel
        ? {
            attribution: [
              {
                label: capabilities.attributionLabel,
                ...(capabilities.attributionUrl ? { url: capabilities.attributionUrl } : {}),
                ...(capabilities.accessConstraints
                  ? { license: capabilities.accessConstraints }
                  : {})
              }
            ]
          }
        : {}),
      extra: {
        ...(capabilities.accessConstraints
          ? { accessConstraints: capabilities.accessConstraints }
          : {})
      }
    } satisfies SourceProbe;
  },

  tileTemplate(request) {
    const { probe } = request;
    const mercator = mercatorCrs(probe.crs ?? []);
    if (!mercator) {
      throw new SourceProbeError(
        "Služba neumí Web Mercator (EPSG:3857), takže ji nejde skládat do dlaždic.",
        probe.endpoint
      );
    }
    const version = probe.version === "1.1.1" ? "1.1.1" : "1.3.0";
    const query = new URLSearchParams({
      service: "WMS",
      version,
      request: "GetMap",
      layers: selected(request).join(","),
      styles: "",
      format: chooseFormat(probe.formats ?? []),
      transparent: "true",
      // 1.3.0 renamed the parameter, and sending the wrong name is a service exception rather
      // than a fallback.
      [version === "1.1.1" ? "srs" : "crs"]: mercator,
      width: "256",
      height: "256"
    });
    const separator = probe.endpoint.includes("?") ? "&" : "?";
    const time = timeFor(request);
    if (time) query.set("time", time.defaultValue);
    return `${probe.endpoint}${separator}${query.toString()}&bbox=${BBOX_PLACEHOLDER}`;
  },

  describe(request) {
    const { probe, layerId } = request;
    const chosen = selected(request);
    const time = timeFor(request);
    const titles = chosen
      .map((id) => probe.sublayers.find((sublayer) => sublayer.id === id)?.title ?? id)
      .filter(Boolean);
    return {
      schema: "mapos.layer-manifest",
      schemaVersion: MAPOS_V2_SCHEMA_VERSION,
      sdkRange: MAPOS_LAYER_SDK_RANGE,
      minimumRuntime: MAPOS_HOST_RUNTIME_VERSION,
      id: layerId,
      name: request.name || titles.join(", ") || probe.title,
      description: probe.description ?? `WMS ${probe.version ?? ""} — ${probe.title}`.trim(),
      category: request.category ?? "user",
      geometryKinds: ["Raster"],
      renderer: { type: "raster" },
      source: {
        type: "raster-tiles",
        tileTemplate: wmsAdapter.tileTemplate!(request),
        adapterId: wmsAdapter.id
      },
      // One GetMap per tile is exactly the tile strategy; nothing here is fetched per viewport.
      queryPolicy: { strategy: "tile" },
      capabilities: [],
      ...(time
        ? {
            filters: [
              {
                id: "wmsTime",
                label: time.truncated ? "Čas UTC · poslední termíny a výchozí" : "Čas UTC",
                kind: "single-select" as const,
                default: time.defaultValue,
                providerField: "TIME",
                options: time.values.map((value) => ({ id: value, label: value }))
              }
            ]
          }
        : {}),
      ...(probe.attribution?.length ? { attribution: probe.attribution } : {}),
      ...legendFor(request, chosen)
    } satisfies LayerManifestV2;
  }
};

function timeFor(request: DescribeRequest) {
  const chosen = selected(request);
  // One TIME applies to every selected WMS sublayer. Do not invent a shared domain.
  return chosen.length === 1
    ? wmsTimeChoices(request.probe.sublayers.find((layer) => layer.id === chosen[0])?.time)
    : null;
}

function capabilitiesUrl(endpoint: string, version: WmsVersion): string {
  const separator = endpoint.includes("?") ? "&" : "?";
  return `${endpoint}${separator}service=WMS&version=${version}&request=GetCapabilities`;
}

/** The chosen sublayers, or every drawable one when the caller has not chosen — which is what a
 *  service publishing a single layer should do without making the user pick it. */
function selected(request: DescribeRequest): string[] {
  const drawable = request.probe.sublayers.filter((sublayer) => sublayer.selectable);
  const chosen = request.sublayerIds.filter((id) =>
    drawable.some((sublayer) => sublayer.id === id)
  );
  if (chosen.length) return chosen;
  return drawable.slice(0, 1).map(({ id }) => id);
}

function mercatorCrs(offered: readonly string[]): string | null {
  const upper = offered.map((value) => value.toUpperCase());
  return WEB_MERCATOR.find((candidate) => upper.includes(candidate)) ?? null;
}

function chooseFormat(offered: readonly string[]): string {
  const match = FORMAT_PREFERENCE.find((candidate) =>
    offered.some((value) => value.toLowerCase() === candidate)
  );
  // A service that lists no formats is misreporting rather than offering nothing, and every WMS
  // implementation answers PNG.
  return match ?? offered.find((value) => value.startsWith("image/")) ?? "image/png";
}

/** A legend only if the service published a graphic for it. Inventing swatches for someone
 *  else's styling would put a key next to the map that does not match the pixels. */
function legendFor(
  request: DescribeRequest,
  chosen: readonly string[]
): Pick<LayerManifestV2, "legend"> {
  const items = chosen
    .map((id) => request.probe.sublayers.find((sublayer) => sublayer.id === id))
    .filter((sublayer) => sublayer?.legendUrl)
    .map((sublayer) => ({ label: sublayer!.title, imageUrl: sublayer!.legendUrl! }));
  return items.length ? { legend: { type: "image", title: request.probe.title, items } } : {};
}
