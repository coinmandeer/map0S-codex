import {
  MAPOS_HOST_RUNTIME_VERSION,
  MAPOS_LAYER_SDK_RANGE,
  MAPOS_V2_SCHEMA_VERSION,
  xmlAttribute,
  xmlChildText,
  xmlChildTexts,
  xmlElements,
  xmlWithoutNested
} from "@mapos/layer-sdk";
import type { DescribeRequest, SourceAdapter } from "../contract.js";
import { SourceProbeError } from "../contract.js";
import { queryParam, serviceEndpoint } from "../registry.js";

const HALF_WORLD = 20037508.342789244;
interface Matrix {
  id: string;
  prefix: string;
  suffix: string;
  min: number;
  max: number;
}
interface TileDefinition {
  template: string;
  min: number;
  max: number;
}

/** Only grids which MapLibre's XYZ source can actually address. Local/4326 grids require
 * reprojection, and pretending their matrix identifiers are zooms produces misplaced tiles. */
function matrix(inner: string): Matrix | undefined {
  const own = xmlWithoutNested(inner, "TileMatrix");
  if (!/(?:[:/])(?:3857|900913|102100|102113)$/.test(xmlChildText(own, "SupportedCRS"))) return;
  const levels = xmlElements(inner, "TileMatrix").map(({ inner: row }) => {
    const width = Number(xmlChildText(row, "MatrixWidth"));
    const zoom = Math.log2(width);
    const origin = xmlChildText(row, "TopLeftCorner").split(/\s+/).map(Number);
    const scale = Number(xmlChildText(row, "ScaleDenominator"));
    const id = xmlChildText(row, "Identifier");
    const match = /^(.*?)(\d+)(\D*)$/.exec(id);
    if (
      !Number.isInteger(zoom) ||
      zoom < 0 ||
      zoom > 24 ||
      Number(xmlChildText(row, "MatrixHeight")) !== width ||
      Number(xmlChildText(row, "TileWidth")) !== 256 ||
      Number(xmlChildText(row, "TileHeight")) !== 256 ||
      origin.length !== 2 ||
      origin.some((value) => !Number.isFinite(value)) ||
      !Number.isFinite(scale) ||
      Math.abs(origin[0]! + HALF_WORLD) > 1 ||
      Math.abs(origin[1]! - HALF_WORLD) > 1 ||
      Math.abs((scale * 0.00028 * 256 * width) / (HALF_WORLD * 2) - 1) > 0.00001 ||
      !match ||
      match[2] !== String(zoom)
    )
      return undefined;
    return { zoom, prefix: match[1]!, suffix: match[3]! };
  });
  if (!levels.length || levels.some((level) => !level)) return;
  const valid = levels.filter((level) => level !== undefined).sort((a, b) => a.zoom - b.zoom);
  const first = valid[0]!;
  if (
    valid.some(
      (level, i) =>
        level.zoom !== first.zoom + i ||
        level.prefix !== first.prefix ||
        level.suffix !== first.suffix
    )
  )
    return;
  return {
    id: xmlChildText(own, "Identifier"),
    prefix: first.prefix,
    suffix: first.suffix,
    min: first.zoom,
    max: valid.at(-1)!.zoom
  };
}

function definition(request: DescribeRequest): TileDefinition {
  const ids = request.sublayerIds.length
    ? request.sublayerIds
    : request.probe.sublayers
        .filter((s) => s.selectable)
        .slice(0, 1)
        .map((s) => s.id);
  if (ids.length !== 1)
    throw new SourceProbeError(
      "WMTS přidává jednu vrstvu najednou. Další přidej samostatně.",
      request.probe.endpoint
    );
  const encoded = request.probe.extra?.tileDefinitions;
  if (typeof encoded !== "string" || encoded.length > 2_000_000)
    throw new SourceProbeError("Chybí definice WMTS dlaždic.", request.probe.endpoint);
  let defs: Record<string, TileDefinition>;
  try {
    const parsed: unknown = JSON.parse(encoded);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("Invalid definitions");
    defs = parsed as Record<string, TileDefinition>;
  } catch {
    throw new SourceProbeError("Neplatná definice WMTS dlaždic.", request.probe.endpoint);
  }
  const value = Object.hasOwn(defs, ids[0]!) ? defs[ids[0]!] : undefined;
  if (
    !value ||
    typeof value.template !== "string" ||
    !/^https:\/\//.test(value.template) ||
    !Number.isInteger(value.min) ||
    !Number.isInteger(value.max) ||
    value.min < 0 ||
    value.max > 24 ||
    value.min > value.max ||
    !["{z}", "{x}", "{y}"].every((part) => value.template.includes(part)) ||
    /[{}]/.test(value.template.replace(/\{[zxy]\}/g, ""))
  ) {
    throw new SourceProbeError(
      "Tato WMTS mřížka není podporovaná; je potřeba Web Mercator / XYZ 256 px.",
      request.probe.endpoint
    );
  }
  return value;
}

export const wmtsAdapter: SourceAdapter = {
  id: "wmts",
  label: "WMTS",
  kinds: ["wmts"],
  detect(url) {
    const service = queryParam(url, "service")?.toLowerCase();
    if (service) return service === "wmts" ? 1 : 0;
    return /(?:\/wmts(?:\/|\.|$)|WMTSCapabilities\.xml$)/i.test(url.pathname) ? 0.95 : 0;
  },
  async probe(url, io, options) {
    const endpoint = serviceEndpoint(url, ["service", "request", "version"]);
    const target = new URL(endpoint);
    if (!/\.xml$/i.test(target.pathname)) {
      target.searchParams.set("SERVICE", "WMTS");
      target.searchParams.set("REQUEST", "GetCapabilities");
      target.searchParams.set("VERSION", "1.0.0");
    }
    const xml = (await io.text(target.href, options)).replace(/<!--[\s\S]*?-->/g, "");
    const root = xmlElements(xml, "Capabilities")[0];
    if (!root || xmlAttribute(root.attributes, "version") !== "1.0.0")
      throw new SourceProbeError("Zdroj nevrátil WMTS 1.0.0 capabilities.", endpoint);
    const contents = xmlElements(root.inner, "Contents")[0]?.inner ?? "";
    const grids = xmlElements(contents, "TileMatrixSet")
      .map(({ inner }) => matrix(inner))
      .filter((grid) => grid !== undefined);
    const operation = xmlElements(root.inner, "Operation").find(
      (op) => xmlAttribute(op.attributes, "name") === "GetTile"
    );
    // KVP is used only when the service advertises it, never against a static XML document.
    const get = xmlElements(operation?.inner ?? "", "Get").find((entry) => {
      const encodings = xmlElements(entry.inner, "Constraint").filter(
        (c) => xmlAttribute(c.attributes, "name") === "GetEncoding"
      );
      return (
        !encodings.length || encodings.some((c) => xmlChildTexts(c.inner, "Value").includes("KVP"))
      );
    });
    const getUrl = get && xmlAttribute(get.attributes, "href");
    const definitions: Record<string, TileDefinition> = Object.create(null);
    const sublayers = xmlElements(contents, "Layer")
      .slice(0, 2000)
      .map(({ inner }) => {
        const own = xmlWithoutNested(
          xmlWithoutNested(xmlWithoutNested(inner, "Style"), "Dimension"),
          "TileMatrixSetLink"
        );
        const id = xmlChildText(own, "Identifier");
        const title = xmlChildText(own, "Title") || id;
        const links = xmlElements(inner, "TileMatrixSetLink");
        // Partial matrix limits need a mask/proxy; do not issue requests outside declared coverage.
        const grid = links.flatMap((link) =>
          xmlElements(link.inner, "TileMatrixSetLimits").length
            ? []
            : grids.filter((g) => g.id === xmlChildText(link.inner, "TileMatrixSet"))
        )[0];
        const styles = xmlElements(inner, "Style");
        const style = xmlChildText(
          (
            styles.find((s) =>
              /^(?:true|1)$/.test(xmlAttribute(s.attributes, "isDefault") ?? "")
            ) ?? styles[0]
          )?.inner ?? "",
          "Identifier"
        );
        const formats = xmlChildTexts(own, "Format");
        const format = ["image/png", "image/webp", "image/jpeg"].find((f) => formats.includes(f));
        const dimensions = xmlElements(inner, "Dimension").map(
          (d) => [xmlChildText(d.inner, "Identifier"), xmlChildText(d.inner, "Default")] as const
        );
        let template = "";
        if (id && grid && format && dimensions.every(([key, value]) => key && value)) {
          const resource = xmlElements(inner, "ResourceURL").find(
            (r) =>
              xmlAttribute(r.attributes, "resourceType") === "tile" &&
              xmlAttribute(r.attributes, "format") === format
          );
          const raw = resource && xmlAttribute(resource.attributes, "template");
          const values: Record<string, string> = Object.fromEntries(dimensions);
          Object.assign(values, { Style: style, TileMatrixSet: grid.id });
          if (raw) {
            template = new URL(raw, endpoint).href.replace(/%7B/gi, "{").replace(/%7D/gi, "}");
            template = template.replace(/\{([^}]+)\}/g, (token, key: string) => {
              if (key === "TileMatrix")
                return `${encodeURIComponent(grid.prefix)}{z}${encodeURIComponent(grid.suffix)}`;
              if (key === "TileRow") return "{y}";
              if (key === "TileCol") return "{x}";
              return Object.hasOwn(values, key) ? encodeURIComponent(values[key]!) : token;
            });
          } else if (getUrl) {
            const tile = new URL(getUrl, endpoint);
            for (const [key, value] of Object.entries({
              SERVICE: "WMTS",
              REQUEST: "GetTile",
              VERSION: "1.0.0",
              LAYER: id,
              STYLE: style,
              FORMAT: format,
              TILEMATRIXSET: grid.id,
              TILEMATRIX: `${grid.prefix}{z}${grid.suffix}`,
              TILEROW: "{y}",
              TILECOL: "{x}",
              ...Object.fromEntries(dimensions)
            }))
              tile.searchParams.set(key, value);
            template = tile.href.replace(/%7B/gi, "{").replace(/%7D/gi, "}");
          }
          if (template.startsWith("https://") && !/[{}]/.test(template.replace(/\{[zxy]\}/g, "")))
            definitions[id] = { template, min: grid.min, max: grid.max };
        }
        return {
          id,
          title,
          selectable: Boolean(definitions[id]),
          ...(definitions[id]
            ? { minZoom: grid!.min, maxZoom: grid!.max }
            : { description: "Nepodporovaná mřížka, rozměr nebo adresa dlaždic." })
        };
      })
      .filter((layer) => layer.id);
    if (!sublayers.length) throw new SourceProbeError("WMTS neobsahuje žádné vrstvy.", endpoint);
    const service = xmlElements(root.inner, "ServiceIdentification")[0]?.inner ?? "";
    const provider = xmlElements(root.inner, "ServiceProvider")[0]?.inner ?? "";
    const title = xmlChildText(service, "Title") || "WMTS";
    const description = [
      xmlChildText(service, "Abstract"),
      ...xmlChildTexts(service, "AccessConstraints").filter(
        (value) => !/^(none|no conditions apply)$/i.test(value)
      )
    ]
      .filter(Boolean)
      .join("\n");
    return {
      adapterId: "wmts",
      kind: "wmts",
      delivery: "tiles",
      endpoint,
      title,
      ...(description ? { description } : {}),
      version: "1.0.0",
      sublayers,
      attribution: [{ label: xmlChildText(provider, "ProviderName") || title }],
      extra: { tileDefinitions: JSON.stringify(definitions) }
    };
  },
  tileTemplate(request) {
    return definition(request).template;
  },
  describe(request) {
    const tile = definition(request);
    const selected =
      request.probe.sublayers.find((s) => s.id === request.sublayerIds[0]) ??
      request.probe.sublayers.find((s) => s.selectable);
    return {
      schema: "mapos.layer-manifest",
      schemaVersion: MAPOS_V2_SCHEMA_VERSION,
      sdkRange: MAPOS_LAYER_SDK_RANGE,
      minimumRuntime: MAPOS_HOST_RUNTIME_VERSION,
      id: request.layerId,
      name: request.name || selected?.title || request.probe.title,
      description: request.probe.description ?? request.probe.title,
      category: request.category ?? "user",
      geometryKinds: ["Raster"],
      renderer: { type: "raster" },
      source: { type: "raster-tiles", tileTemplate: tile.template, adapterId: "wmts" },
      queryPolicy: { strategy: "tile", minZoom: tile.min, maxZoom: tile.max },
      capabilities: [],
      ...(request.probe.attribution ? { attribution: request.probe.attribution } : {})
    };
  }
};
