import {
  MAPOS_HOST_RUNTIME_VERSION,
  MAPOS_LAYER_SDK_RANGE,
  MAPOS_V2_SCHEMA_VERSION,
  type FeatureCollection,
  type LayerManifestV2
} from "@mapos/layer-sdk";
import type { DescribeRequest, SourceAdapter, SourceProbe, SourceSublayer } from "../contract.js";
import { SourceProbeError } from "../contract.js";
import { serviceEndpoint } from "../registry.js";
import { esriFeaturesToGeoJson, type EsriFeature } from "./esriJson.js";

/**
 * ArcGIS REST — the other half of Europe's public map services.
 *
 * One adapter for two service types, because a pasted URL does not tell you which you have until
 * you ask, and the difference is only what happens after `probe`:
 *
 *  - `MapServer` renders images. It delivers `tiles`, either from its own cache
 *    (`/tile/{z}/{y}/{x}` — note ArcGIS orders row before column) or by rendering each tile with
 *    `/export`. The cache is preferred when the service has one: it is a file read rather than a
 *    render, so it is faster and does not bill against the service's rendering capacity.
 *  - `FeatureServer` returns geometry. It delivers `features` per viewport, which means the
 *    features are clickable and filterable rather than baked into pixels.
 *
 * A `MapServer` also answers `/query` on its sublayers when its capabilities include `Query`,
 * but it is described as tiles anyway: a service that offers an image is a service whose
 * cartography someone designed, and re-rendering it from raw geometry would throw that away.
 */
const PROBE_PARAMS = ["f", "token", "callback"] as const;

/** ArcGIS pages long layer lists; a service with more sublayers than this is a catalogue, and
 *  the wizard's list is not the place to enumerate it. */
const MAX_SUBLAYERS = 400;

/** Esri's own well-known ids for Web Mercator. `102100` predates the EPSG code and is still what
 *  many services report. */
const WEB_MERCATOR_WKIDS = [3857, 102100, 102113, 900913];

interface ArcGisServiceJson {
  currentVersion?: number;
  serviceDescription?: string;
  description?: string;
  mapName?: string;
  copyrightText?: string;
  capabilities?: string;
  singleFusedMapCache?: boolean;
  supportedImageFormatTypes?: string;
  supportedQueryFormats?: string;
  spatialReference?: { wkid?: number; latestWkid?: number };
  fullExtent?: { xmin?: number; ymin?: number; xmax?: number; ymax?: number };
  initialExtent?: { xmin?: number; ymin?: number; xmax?: number; ymax?: number };
  tileInfo?: {
    lods?: Array<{ level?: number }>;
    spatialReference?: { wkid?: number; latestWkid?: number };
  };
  layers?: Array<{
    id?: number | string;
    name?: string;
    description?: string;
    parentLayerId?: number;
    subLayerIds?: number[] | null;
    geometryType?: string;
    minScale?: number;
    maxScale?: number;
    defaultVisibility?: boolean;
  }>;
  error?: { message?: string; details?: string[] };
}

export const arcgisAdapter: SourceAdapter = {
  id: "arcgis",
  label: "ArcGIS REST",
  kinds: ["arcgis-mapserver", "arcgis-featureserver"],

  detect(url) {
    const path = url.pathname;
    // The service type is in the path and nowhere else, which makes this the one protocol that
    // can be recognised with complete confidence before any request.
    if (/\/(?:Map|Feature|Image)Server(?:\/\d+)?\/?$/i.test(path)) return 1;
    // `.../MapServer/WMSServer` is a WMS façade, and the WMS adapter should have it.
    if (/\/(?:Map|Feature)Server\/(?:WMSServer|WFSServer)/i.test(path)) return 0;
    if (/\/(?:Map|Feature)Server\//i.test(path)) return 0.7;
    if (/\/arcgis\/rest\/services\//i.test(path)) return 0.6;
    return 0;
  },

  async probe(url, io, options) {
    const endpoint = serviceEndpoint(stripSublayer(url), PROBE_PARAMS);
    const separator = endpoint.includes("?") ? "&" : "?";
    const service = (await io.json(`${endpoint}${separator}f=json`, options)) as ArcGisServiceJson;
    if (service?.error) {
      // ArcGIS answers HTTP 200 with an error body, so this is not caught by the fetch layer.
      throw new SourceProbeError(service.error.message ?? "Služba ArcGIS odmítla dotaz.", endpoint);
    }

    const feature = /\/FeatureServer/i.test(endpoint);
    const sublayers = sublayersOf(service, feature);
    if (!sublayers.length) {
      throw new SourceProbeError("Služba nenabízí žádnou vrstvu.", endpoint);
    }
    const cached =
      !feature &&
      service.singleFusedMapCache === true &&
      mercator(service.tileInfo?.spatialReference);

    return {
      adapterId: arcgisAdapter.id,
      kind: feature ? "arcgis-featureserver" : "arcgis-mapserver",
      delivery: feature ? "features" : "tiles",
      endpoint,
      title:
        service.mapName ||
        service.serviceDescription?.split("\n")[0]?.trim() ||
        lastPathSegment(endpoint),
      ...(service.description || service.serviceDescription
        ? { description: (service.description || service.serviceDescription)!.trim() }
        : {}),
      ...(service.currentVersion ? { version: String(service.currentVersion) } : {}),
      sublayers,
      ...(service.copyrightText?.trim()
        ? { attribution: [{ label: service.copyrightText.trim() }] }
        : {}),
      formats: imageFormats(service.supportedImageFormatTypes),
      crs: mercator(service.spatialReference) || cached ? ["EPSG:3857"] : [],
      extra: {
        cached,
        // The map's own cache has a zoom ceiling; without it MapLibre asks for levels the
        // archive does not contain and the layer goes blank when you zoom in.
        ...(cached ? { maxZoom: maxCachedZoom(service) } : {}),
        ...(feature ? { geoJson: supportsGeoJson(service.supportedQueryFormats) } : {})
      }
    } satisfies SourceProbe;
  },

  tileTemplate(request) {
    const { probe } = request;
    if (probe.delivery !== "tiles") {
      throw new SourceProbeError(
        "FeatureServer se nedlaždicuje; dotazuje se po výřezu.",
        probe.endpoint
      );
    }
    if (probe.extra?.cached === true) {
      return `${probe.endpoint}/tile/{z}/{y}/{x}`;
    }
    if (!probe.crs?.includes("EPSG:3857")) {
      throw new SourceProbeError(
        "Služba neumí Web Mercator (EPSG:3857), takže ji nejde skládat do dlaždic.",
        probe.endpoint
      );
    }
    const query = new URLSearchParams({
      // `show:` rather than a bare list, or the service draws its default visibility instead of
      // what the user chose.
      layers: `show:${selected(request).join(",")}`,
      bboxSR: "3857",
      imageSR: "3857",
      size: "256,256",
      format: chooseFormat(probe.formats ?? []),
      transparent: "true",
      f: "image"
    });
    return `${probe.endpoint}/export?bbox={bbox-epsg-3857}&${query.toString()}`;
  },

  async features(request, bbox, io, options) {
    const { probe } = request;
    const [layerId] = selected(request);
    if (probe.delivery !== "features" || !layerId) {
      throw new SourceProbeError("Tahle služba nevrací geometrii.", probe.endpoint);
    }
    const sublayer = probe.sublayers.find((entry) => entry.id === layerId);
    const geoJson = probe.extra?.geoJson === true;
    const query = new URLSearchParams({
      where: "1=1",
      outFields: "*",
      returnGeometry: "true",
      resultRecordCount: "1000",
      geometryPrecision: "6",
      geometry: bbox.join(","),
      geometryType: "esriGeometryEnvelope",
      spatialRel: "esriSpatialRelIntersects",
      // WGS84 in and out, so no reprojection happens on our side of the wire.
      inSR: "4326",
      outSR: "4326",
      f: geoJson ? "geojson" : "json"
    });
    const response = (await io.json(
      `${probe.endpoint}/${layerId}/query?${query.toString()}`,
      options
    )) as {
      error?: { message?: string };
      exceededTransferLimit?: boolean;
      features?: EsriFeature[];
      type?: string;
      objectIdFieldName?: string;
      displayFieldName?: string;
    };
    if (response?.error) {
      throw new SourceProbeError(response.error.message ?? "Dotaz odmítnut.", probe.endpoint);
    }

    const exceeded = response.exceededTransferLimit || (response.features?.length ?? 0) > 1000;
    if (response.features) response.features = response.features.slice(0, 1000);
    const features = geoJson
      ? ((response as unknown as FeatureCollection).features ?? []).map((entry) => ({
          ...entry,
          properties: { ...entry.properties, layerId: request.layerId }
        }))
      : esriFeaturesToGeoJson(response.features ?? [], {
          layerId: request.layerId,
          ...(response.objectIdFieldName ? { idField: response.objectIdFieldName } : {}),
          ...(response.displayFieldName ? { nameField: response.displayFieldName } : {}),
          ...(sublayer ? { category: sublayer.title } : {})
        });

    return {
      type: "FeatureCollection",
      features: features.slice(0, 4000),
      query: {
        status: exceeded || features.length > 4000 ? "partial" : "complete",
        truncated: Boolean(exceeded || features.length > 4000)
      },
      // ArcGIS silently truncates at the service's `maxRecordCount`. Saying so is the difference
      // between a half-drawn map and a known one.
      ...(exceeded || features.length > 4000
        ? { notice: "Služba vrátila jen část výsledků — přibliž mapu." }
        : {})
    } satisfies FeatureCollection;
  },

  describe(request) {
    const { probe, layerId } = request;
    const chosen = selected(request);
    if (probe.delivery === "features" && chosen.length !== 1)
      throw new SourceProbeError("FeatureServer přidává jednu vrstvu najednou.", probe.endpoint);
    const titles = chosen.map(
      (id) => probe.sublayers.find((sublayer) => sublayer.id === id)?.title ?? id
    );
    const tiles = probe.delivery === "tiles";
    const maxZoom = Number(probe.extra?.maxZoom);

    return {
      schema: "mapos.layer-manifest",
      schemaVersion: MAPOS_V2_SCHEMA_VERSION,
      sdkRange: MAPOS_LAYER_SDK_RANGE,
      minimumRuntime: MAPOS_HOST_RUNTIME_VERSION,
      id: layerId,
      name: request.name || titles.join(", ") || probe.title,
      description: probe.description ?? probe.title,
      category: request.category ?? "user",
      geometryKinds: tiles ? ["Raster"] : ["Point", "LineString"],
      // `symbols` rather than `circles`: a FeatureServer's rows are named places, and a line
      // converted from a polygon outline still reads as one when it carries a label.
      renderer: tiles ? { type: "raster" } : { type: "symbols" },
      source: tiles
        ? {
            type: "raster-tiles",
            tileTemplate: arcgisAdapter.tileTemplate!(request),
            adapterId: arcgisAdapter.id
          }
        : {
            type: "server-adapter",
            adapterId: arcgisAdapter.id,
            endpoint: `${probe.endpoint}/${chosen[0] ?? ""}/query`
          },
      queryPolicy: tiles
        ? {
            strategy: "tile",
            // A tile cache stops at the zoom it was built to; asking past it returns nothing and
            // the layer goes blank exactly when the user leans in.
            ...(Number.isFinite(maxZoom) && maxZoom > 0 ? { maxZoom } : {})
          }
        : // A FeatureServer query is unbounded, so a continent-wide viewport would ask for
          // everything. Held back until the viewport is a plausible amount of geometry. How many
          // rows come back is the service's own `maxRecordCount`, and `features()` reports it
          // when the service truncates.
          { strategy: "viewport", minZoom: 9 },
      capabilities: [],
      ...(probe.attribution?.length ? { attribution: probe.attribution } : {})
    } satisfies LayerManifestV2;
  }
};

/**
 * `.../FeatureServer/3` is a layer inside a service, and people paste it far more often than the
 * service root because it is what the ArcGIS web viewer's address bar shows. Probing the root
 * and pre-selecting that layer is more useful than refusing the URL.
 */
function stripSublayer(url: URL): URL {
  const trimmed = new URL(url.href);
  trimmed.pathname = trimmed.pathname.replace(/\/(\d+)\/?$/, "");
  return trimmed;
}

/** The sublayer id in a pasted `.../FeatureServer/3`, so the wizard can start there. */
export function arcgisPastedSublayer(url: URL): string | null {
  return /\/(?:Map|Feature|Image)Server\/(\d+)\/?$/i.exec(url.pathname)?.[1] ?? null;
}

function sublayersOf(service: ArcGisServiceJson, feature: boolean): SourceSublayer[] {
  const layers = (service.layers ?? []).slice(0, MAX_SUBLAYERS);
  const entries = layers.flatMap((layer) => {
    const id = layer.id;
    if (id === undefined || id === null) return [];
    // A group layer in ArcGIS holds `subLayerIds` and has nothing of its own to draw. A
    // MapServer can still be asked to render it, but a FeatureServer cannot be queried for it.
    const group = Array.isArray(layer.subLayerIds) && layer.subLayerIds.length > 0;
    return [
      {
        id: String(id),
        title: layer.name?.trim() || `#${id}`,
        ...(layer.description?.trim() ? { description: layer.description.trim() } : {}),
        selectable: feature ? !group : true
      } satisfies SourceSublayer
    ];
  });
  // An `ImageServer`, and a `FeatureServer` reached at one of its layers, publish no list at
  // all; the service is itself the one thing to draw.
  if (entries.length) return entries;
  return [{ id: "0", title: service.mapName || "Vrstva", selectable: true }];
}

function selected(request: DescribeRequest): string[] {
  const drawable = request.probe.sublayers.filter((sublayer) => sublayer.selectable);
  const chosen = request.sublayerIds.filter((id) =>
    drawable.some((sublayer) => sublayer.id === id)
  );
  if (chosen.length) return chosen;
  // A FeatureServer is queried one layer at a time; a MapServer renders all of them at once.
  return request.probe.delivery === "features"
    ? drawable.slice(0, 1).map(({ id }) => id)
    : drawable.map(({ id }) => id);
}

function mercator(reference?: { wkid?: number; latestWkid?: number }): boolean {
  const wkid = reference?.latestWkid ?? reference?.wkid;
  return wkid !== undefined && WEB_MERCATOR_WKIDS.includes(wkid);
}

function maxCachedZoom(service: ArcGisServiceJson): number {
  const levels = (service.tileInfo?.lods ?? [])
    .map((lod) => lod.level)
    .filter((level): level is number => typeof level === "number");
  return levels.length ? Math.max(...levels) : 19;
}

/** Esri names its formats `PNG32`, `PNG24`, `JPG`. Transparency needs a PNG with an alpha
 *  channel, and `PNG32` is the one that always has one. */
function imageFormats(supported?: string): string[] {
  const listed = (supported ?? "PNG32,PNG24,PNG,JPG")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  const preferred = ["PNG32", "PNG24", "PNG8", "PNG", "GIF", "JPG"];
  return [
    ...preferred.filter((value) => listed.includes(value)),
    ...listed.filter((value) => !preferred.includes(value))
  ];
}

function chooseFormat(formats: readonly string[]): string {
  return formats[0] ?? "png32";
}

function supportsGeoJson(supported?: string): boolean {
  return (supported ?? "").split(",").some((value) => value.trim().toLowerCase() === "geojson");
}

function lastPathSegment(endpoint: string): string {
  const segments = endpoint.split("?")[0]!.split("/").filter(Boolean);
  // The service type is the last segment and the service's name is the one before it.
  return segments[segments.length - 2] ?? segments[segments.length - 1] ?? "ArcGIS";
}
