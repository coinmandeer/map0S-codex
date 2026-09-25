import type { GeoFeature, GeoFeatureProperties, LinePositions } from "@mapos/layer-sdk";

/**
 * Esri JSON geometry → the geometry MapOS renders.
 *
 * Needed because `f=geojson` only arrived in ArcGIS 10.4 and a great many public services — the
 * municipal and cadastral ones especially, which is exactly what people paste — are older. The
 * alternative to converting is telling the user their URL is unsupported when it works fine.
 *
 * `GeoGeometry` is a point or a line, so a polygon becomes the line of each of its rings. That
 * is a real reduction and not a lossless import: a parcel arrives as its outline rather than as
 * a fill, and holes arrive as more outlines. It is the honest rendering of a polygon in a
 * point-and-line renderer, and it beats dropping the feature.
 */
interface EsriPoint {
  x?: unknown;
  y?: unknown;
}

interface EsriGeometry extends EsriPoint {
  points?: unknown;
  paths?: unknown;
  rings?: unknown;
}

export interface EsriFeature {
  attributes?: Record<string, unknown>;
  geometry?: EsriGeometry;
}

/**
 * `layerId` and `nameFields` come from the service's metadata: ArcGIS has a display-field
 * convention (`displayField`) and nothing else that reliably names a row.
 */
export function esriFeaturesToGeoJson(
  features: readonly EsriFeature[],
  options: { layerId: string; idField?: string; nameField?: string; category?: string }
): GeoFeature[] {
  return features.flatMap((feature, index) => {
    const attributes = feature.geometry ? (feature.attributes ?? {}) : null;
    if (!attributes) return [];
    const geometries = esriGeometries(feature.geometry!);
    return geometries.map((geometry, part) => ({
      type: "Feature" as const,
      geometry,
      properties: properties(attributes, {
        ...options,
        // A multi-part geometry becomes several features, and they cannot share an id.
        suffix: geometries.length > 1 ? `:${part}` : "",
        fallbackId: String(index)
      })
    }));
  });
}

function properties(
  attributes: Record<string, unknown>,
  options: {
    layerId: string;
    idField?: string;
    nameField?: string;
    category?: string;
    suffix: string;
    fallbackId: string;
  }
): GeoFeatureProperties {
  const rawId = options.idField ? attributes[options.idField] : undefined;
  const id = scalar(rawId) ?? attributes["OBJECTID"] ?? attributes["objectid"];
  const name = options.nameField ? scalar(attributes[options.nameField]) : undefined;
  return {
    ...attributes,
    id: `${id ?? options.fallbackId}${options.suffix}`,
    name: name ?? `#${id ?? options.fallbackId}`,
    layerId: options.layerId,
    ...(options.category ? { category: options.category } : {})
  };
}

function scalar(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function esriGeometries(geometry: EsriGeometry): GeoFeature["geometry"][] {
  const point = position(geometry);
  if (point) return [{ type: "Point", coordinates: point }];

  if (Array.isArray(geometry.points)) {
    return geometry.points
      .map((value) => position(value))
      .filter((value): value is [number, number] => value !== null)
      .map((coordinates) => ({ type: "Point" as const, coordinates }));
  }

  // Rings and paths have the same shape; a ring is a path that closes.
  const lines = Array.isArray(geometry.paths)
    ? geometry.paths
    : Array.isArray(geometry.rings)
      ? geometry.rings
      : [];
  return lines
    .map((line) => linePositions(line))
    .filter((value): value is LinePositions => value !== null)
    .map((coordinates) => ({ type: "LineString" as const, coordinates }));
}

/** Esri writes `[x, y]` with optional z and m trailing, so extra members are dropped rather than
 *  refused. */
function position(value: unknown): [number, number] | null {
  if (Array.isArray(value)) {
    const [x, y] = value;
    return Number.isFinite(x) && Number.isFinite(y) ? [Number(x), Number(y)] : null;
  }
  if (value && typeof value === "object") {
    const { x, y } = value as EsriPoint;
    return Number.isFinite(x) && Number.isFinite(y) ? [Number(x), Number(y)] : null;
  }
  return null;
}

function linePositions(line: unknown): LinePositions | null {
  if (!Array.isArray(line)) return null;
  const positions = line
    .map((value) => position(value))
    .filter((value): value is [number, number] => value !== null);
  // A single-position line has no direction and draws as nothing.
  if (positions.length < 2) return null;
  return positions as LinePositions;
}
