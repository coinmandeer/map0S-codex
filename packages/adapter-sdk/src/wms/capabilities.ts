import type { Bbox } from "@mapos/layer-sdk";
import {
  xmlAttribute,
  xmlChildText,
  xmlChildTexts,
  xmlDirectElements,
  xmlElements,
  xmlWithoutNested
} from "@mapos/layer-sdk";
import type { SourceSublayer } from "../contract.js";

/** The two WMS versions in the wild. They disagree about axis order and about what the CRS
 *  parameter is called, which is why the version has to be carried around rather than assumed. */
export type WmsVersion = "1.1.1" | "1.3.0";

export interface WmsCapabilities {
  version: WmsVersion;
  title: string;
  abstract?: string;
  /** The URL GetMap should be sent to, which is not always the URL capabilities came from —
   *  MapServer and GeoServer both advertise a different one, and honouring it is the difference
   *  between a working layer and 404s. */
  getMapUrl?: string;
  formats: string[];
  crs: string[];
  layers: WmsLayer[];
  attributionLabel?: string;
  attributionUrl?: string;
  accessConstraints?: string;
}

export interface WmsLayer extends SourceSublayer {
  crs: string[];
  /** Nested layers. WMS uses containment to express grouping, and a group is often not itself
   *  drawable — it has no `Name`, only a `Title`. */
  children: WmsLayer[];
  queryable: boolean;
}

/** Charged services exist and are not worth pretending about, so the words that mean "you will
 *  be billed or blocked" are surfaced to the user instead of discovered as a broken layer. */
const RESTRICTIVE_CONSTRAINTS = /\b(?:none|no conditions apply)\b/i;

export function parseWmsCapabilities(xml: string): WmsCapabilities {
  const root = xmlElements(xml, "WMS_Capabilities")[0] ??
    xmlElements(xml, "WMT_MS_Capabilities")[0] ??
      // Some services answer with just the body and no recognised root; reading the whole document
      // still finds the Service and Capability blocks below.
      { attributes: "", inner: xml };

  const version = xmlAttribute(root.attributes, "version") === "1.1.1" ? "1.1.1" : "1.3.0";
  const service = xmlElements(root.inner, "Service")[0]?.inner ?? "";
  const capability = xmlElements(root.inner, "Capability")[0]?.inner ?? "";
  const request = xmlElements(capability, "Request")[0]?.inner ?? "";
  const getMap = xmlElements(request, "GetMap")[0]?.inner ?? "";

  const constraints = xmlChildText(service, "AccessConstraints");
  const attribution = layerAttribution(capability);
  const topLevel = xmlDirectElements(capability, "Layer").flatMap((element) =>
    parseLayer(element.inner, element.attributes, version, [])
  );

  return {
    version,
    title: xmlChildText(service, "Title") || "WMS",
    ...optional("abstract", xmlChildText(service, "Abstract")),
    ...optional("getMapUrl", onlineResource(getMap)),
    formats: xmlChildTexts(getMap, "Format"),
    crs: crsNames(capability, version),
    layers: topLevel,
    // WMS has an element for exactly this. Falling back to the service title means a layer
    // always credits someone, since an unattributed overlay is not one we should draw.
    ...optional("attributionLabel", attribution.label || xmlChildText(service, "Title")),
    ...optional("attributionUrl", attribution.url),
    ...optional("accessConstraints", RESTRICTIVE_CONSTRAINTS.test(constraints) ? "" : constraints)
  };
}

/** The `<Attribution>` of the root layer, which is where a service names the body behind the
 *  data. Nested layers may override it, but a single credit for the layer we build is what the
 *  map's attribution bar can show. */
function layerAttribution(capability: string): { label: string; url: string } {
  const element = xmlElements(capability, "Attribution")[0]?.inner ?? "";
  return { label: xmlChildText(element, "Title"), url: onlineResource(element) };
}

/** Every drawable layer, flattened, groups first. What the wizard lists — a tree control for a
 *  service publishing four layers is ceremony, and for one publishing four hundred the flat list
 *  is what a search box can filter. */
export function flattenWmsLayers(layers: readonly WmsLayer[]): WmsLayer[] {
  return layers.flatMap((layer) => [layer, ...flattenWmsLayers(layer.children)]);
}

function parseLayer(
  inner: string,
  attributes: string,
  version: WmsVersion,
  inheritedCrs: readonly string[],
  inheritedTime?: SourceSublayer["time"]
): WmsLayer[] {
  // Only this layer's own fields: WMS nests `<Layer>` to group, and reading through the nesting
  // would give a group its first child's name.
  const own = xmlWithoutNested(inner, "Layer");
  const name = xmlChildText(own, "Name");
  const title = xmlChildText(own, "Title");
  // A layer with no title at all is a malformed entry, not a group; skipping it is better than
  // offering the user a nameless row.
  if (!name && !title) return [];

  const crs = [...new Set([...inheritedCrs, ...crsNames(own, version)])];
  const time = timeDimension(own, inheritedTime);
  const children = xmlDirectElements(inner, "Layer").flatMap((child) =>
    parseLayer(child.inner, child.attributes, version, crs, time)
  );

  return [
    {
      // A group without a Name cannot be requested, so it gets a synthetic id and is marked
      // unselectable rather than being offered and then failing.
      id: name || `group:${title}`,
      title: title || name,
      ...optional("description", xmlChildText(own, "Abstract")),
      // `Name` is exactly the WMS test for "can be requested".
      selectable: Boolean(name),
      queryable: xmlAttribute(attributes, "queryable") === "1",
      crs,
      ...(time ? { time } : {}),
      ...optionalBbox(own, version),
      ...optional("legendUrl", legendUrl(own)),
      children
    }
  ];
}

/** 1.3 uses Dimension content; 1.1 separates the unit declaration from Extent content.
 * Preserve the compact domain and inherited attributes instead of generating years of dates. */
function timeDimension(own: string, inherited?: SourceSublayer["time"]): SourceSublayer["time"] {
  const dimension = xmlElements(own, "Dimension").find(
    (element) => xmlAttribute(element.attributes, "name")?.toLowerCase() === "time"
  );
  const extent = xmlElements(own, "Extent").find(
    (element) => xmlAttribute(element.attributes, "name")?.toLowerCase() === "time"
  );
  if (!dimension && !extent) return inherited ? { ...inherited } : undefined;
  const valueElement = extent ?? dimension!;
  const values = valueElement.inner.trim() || inherited?.values || "";
  const units =
    (dimension && xmlAttribute(dimension.attributes, "units")) || inherited?.units || "";
  if (values.length > 65_536) throw new Error("WMS time domain exceeds 64 KiB");
  const result: NonNullable<SourceSublayer["time"]> = { ...inherited, units, values };
  for (const element of [dimension, extent]) {
    if (!element) continue;
    const defaultValue = xmlAttribute(element.attributes, "default");
    if (defaultValue) result.default = defaultValue;
    for (const key of ["nearestValue", "multipleValues", "current"] as const) {
      const raw = xmlAttribute(element.attributes, key);
      if (raw === "1" || raw === "true") result[key] = true;
      if (raw === "0" || raw === "false") result[key] = false;
    }
  }
  return result;
}

/** WMS 1.3.0 renamed `SRS` to `CRS`. Reading both means a 1.1.1 service is not reported as
 *  supporting no projections at all. */
function crsNames(scope: string, version: WmsVersion): string[] {
  const tag = version === "1.1.1" ? "SRS" : "CRS";
  return [...new Set(xmlChildTexts(scope, tag).flatMap((value) => value.split(/\s+/)))].filter(
    Boolean
  );
}

function optionalBbox(inner: string, version: WmsVersion): { bbox?: Bbox } {
  // 1.3.0 publishes `EX_GeographicBoundingBox`; 1.1.1 publishes `LatLonBoundingBox`. Both are
  // WGS84 in longitude/latitude order, which is why neither needs the axis-order dance.
  const geographic = xmlElements(inner, "EX_GeographicBoundingBox")[0]?.inner;
  if (geographic) {
    const bbox = numbers([
      xmlChildText(geographic, "westBoundLongitude"),
      xmlChildText(geographic, "southBoundLatitude"),
      xmlChildText(geographic, "eastBoundLongitude"),
      xmlChildText(geographic, "northBoundLatitude")
    ]);
    return bbox ? { bbox } : {};
  }
  if (version === "1.1.1") {
    const latLon = xmlElements(inner, "LatLonBoundingBox")[0]?.attributes;
    if (latLon) {
      const bbox = numbers([
        xmlAttribute(latLon, "minx"),
        xmlAttribute(latLon, "miny"),
        xmlAttribute(latLon, "maxx"),
        xmlAttribute(latLon, "maxy")
      ]);
      return bbox ? { bbox } : {};
    }
  }
  return {};
}

function legendUrl(inner: string): string {
  const style = xmlElements(inner, "Style")[0]?.inner ?? "";
  const legend = xmlElements(style, "LegendURL")[0]?.inner ?? "";
  return onlineResource(legend);
}

function onlineResource(scope: string): string {
  for (const element of xmlElements(scope, "OnlineResource")) {
    const href = xmlAttribute(element.attributes, "href");
    if (href) return href;
  }
  return "";
}

function numbers(values: Array<string | undefined>): Bbox | undefined {
  const parsed = values.map((value) => Number(value));
  if (parsed.length !== 4 || parsed.some((value) => !Number.isFinite(value))) return undefined;
  const [west, south, east, north] = parsed as [number, number, number, number];
  // A service that publishes a degenerate or inverted extent has told us nothing usable, and a
  // zero-area bbox would later read as "covers nothing".
  if (west >= east || south >= north) return undefined;
  return [west, south, east, north];
}

function optional<K extends string>(key: K, value: string): Partial<Record<K, string>> {
  return value ? ({ [key]: value } as Record<K, string>) : {};
}
