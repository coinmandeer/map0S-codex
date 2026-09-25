import { CATALOG_DATA } from "./catalogData.js";
import type { GeoJsonGeometry, GeoJsonBbox, PlanDocumentV2 } from "./v2/index.js";
import type { FilterValues } from "./types.js";
export interface MapContextSnapshot {
  schema: "mapos.map-context";
  schemaVersion: "1.0.0";
  revision: number;
  basemapId: string;
  view: { longitude: number; latitude: number; zoom: number };
  bbox?: GeoJsonBbox;
  layers: Record<string, { visible: boolean; opacity: number; filters: FilterValues }>;
  time: string | null;
  areaId: string | null;
  selectedFeatureIds: string[];
  planRevision: number | null;
}
export interface MapScenePatch {
  schema: "mapos.scene-patch";
  schemaVersion: "1.0.0";
  id: string;
  runId: string;
  conversationId: string;
  revision: number;
  explanation: string;
  basemapId?: string;
  layers?: MapContextSnapshot["layers"];
  artifactIds?: string[];
  bbox?: GeoJsonBbox;
  time?: string | null;
}
export interface TripPlanDraft {
  schema: "mapos.trip-draft";
  schemaVersion: "1.0.0";
  conversationId: string;
  plan: PlanDocumentV2;
  lockedStopIds: string[];
  savedPlanId?: string;
}
export interface ConversationSummary {
  id: string;
  title: string;
  revision: number;
  updatedAt: string;
}
export interface MapArtifactSource {
  id: string;
  label: string;
  url?: string;
  retrievedAt?: string;
}
export interface MapResultArtifact {
  schema: "mapos.map-result";
  schemaVersion: "1.0.0";
  id: string;
  conversationId: string;
  runId: string;
  revision: number;
  title: string;
  /** Registered display source; the geometry collection stays empty for this result. */
  registeredRaster?: { layerId: string };
  data: {
    type: "FeatureCollection";
    features: {
      type: "Feature";
      id: string;
      geometry: GeoJsonGeometry;
      properties: {
        title: string;
        sourceId: string;
        value?: number | null;
        category?: string;
        layerId?: string;
        sourceFeatureId?: string;
      };
    }[];
  };
  style: {
    palette: "blue" | "diverging" | "categories";
    opacity: number;
    minimum?: number;
    maximum?: number;
    midpoint?: number;
    categories?: string[];
  };
  sources: MapArtifactSource[];
  legend?: { title: string; unit: string; time: string; noDataLabel: string };
  derived?: { method: "geodesic-buffer"; description: string };
}
export type MapResultDraft = Pick<
  MapResultArtifact,
  "id" | "title" | "data" | "style" | "sources" | "legend" | "derived" | "registeredRaster"
>;
/** Smallest longitude interval, including results spanning the date line. East may exceed 180. */
export function mapArtifactBounds(artifacts: readonly MapResultArtifact[]): GeoJsonBbox | null {
  const longitudes: number[] = [];
  let south = 90,
    north = -90;
  const visit = (coordinates: unknown) => {
    if (!Array.isArray(coordinates)) return;
    if (typeof coordinates[0] === "number" && typeof coordinates[1] === "number") {
      longitudes.push((coordinates[0] + 360) % 360);
      south = Math.min(south, coordinates[1]);
      north = Math.max(north, coordinates[1]);
    } else for (const child of coordinates) visit(child);
  };
  for (const artifact of artifacts)
    for (const feature of artifact.data.features) visit(feature.geometry.coordinates);
  if (!longitudes.length) return null;
  longitudes.sort((a, b) => a - b);
  let gap = -1,
    start = 0;
  for (let i = 0; i < longitudes.length; i++) {
    const next = longitudes[(i + 1) % longitudes.length]! + (i === longitudes.length - 1 ? 360 : 0);
    if (next - longitudes[i]! > gap) {
      gap = next - longitudes[i]!;
      start = next % 360;
    }
  }
  const west = start > 180 ? start - 360 : start;
  return [west, south, west + 360 - gap, north];
}
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const text = (v: unknown, max = 200): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= max;
/** The UI snapshot is descriptive input, never authority to access a layer or plan. */
export function isMapContextSnapshot(value: unknown): value is MapContextSnapshot {
  if (
    !record(value) ||
    value.schema !== "mapos.map-context" ||
    value.schemaVersion !== "1.0.0" ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 0 ||
    !text(value.basemapId) ||
    !record(value.view) ||
    !finite(value.view.longitude) ||
    Math.abs(value.view.longitude) > 180 ||
    !finite(value.view.latitude) ||
    Math.abs(value.view.latitude) > 90 ||
    !finite(value.view.zoom) ||
    value.view.zoom < 0 ||
    value.view.zoom > 24 ||
    !record(value.layers) ||
    Object.keys(value.layers).length > 100 ||
    !(value.time === null || (text(value.time) && Number.isFinite(Date.parse(value.time)))) ||
    !(value.areaId === null || text(value.areaId, 1024)) ||
    !(
      value.planRevision === null ||
      (Number.isSafeInteger(value.planRevision) && Number(value.planRevision) >= 0)
    ) ||
    !Array.isArray(value.selectedFeatureIds) ||
    value.selectedFeatureIds.length > 40 ||
    !value.selectedFeatureIds.every((id) => text(id, 300))
  )
    return false;
  if (
    value.bbox !== undefined &&
    (!Array.isArray(value.bbox) ||
      value.bbox.length !== 4 ||
      !value.bbox.every(finite) ||
      value.bbox[0] < -180 ||
      value.bbox[2] > 180 ||
      value.bbox[1] < -90 ||
      value.bbox[3] > 90 ||
      value.bbox[0] >= value.bbox[2] ||
      value.bbox[1] >= value.bbox[3])
  )
    return false;
  return Object.entries(value.layers).every(
    ([id, layer]) =>
      text(id) &&
      record(layer) &&
      typeof layer.visible === "boolean" &&
      finite(layer.opacity) &&
      layer.opacity >= 0 &&
      layer.opacity <= 1 &&
      record(layer.filters) &&
      Object.keys(layer.filters).length <= 30 &&
      Object.values(layer.filters).every(
        (v) =>
          typeof v === "boolean" ||
          finite(v) ||
          (typeof v === "string" && v.length <= 200) ||
          (Array.isArray(v) &&
            v.length <= 100 &&
            v.every((x) => typeof x === "string" && x.length <= 200))
      )
  );
}
/** Bounded GeoJSON validation. Rings close explicitly; holes remain separate rings. */
export function isMapResultArtifact(value: unknown): value is MapResultArtifact {
  if (
    !record(value) ||
    value.schema !== "mapos.map-result" ||
    value.schemaVersion !== "1.0.0" ||
    !text(value.id) ||
    !text(value.conversationId) ||
    !text(value.runId) ||
    !text(value.title) ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 0
  )
    return false;
  if (
    !record(value.style) ||
    !["blue", "diverging", "categories"].includes(String(value.style.palette)) ||
    !finite(value.style.opacity) ||
    value.style.opacity < 0 ||
    value.style.opacity > 1
  )
    return false;
  for (const key of ["minimum", "maximum", "midpoint"])
    if (value.style[key] !== undefined && !finite(value.style[key])) return false;
  if (
    value.style.minimum !== undefined &&
    value.style.maximum !== undefined &&
    Number(value.style.minimum) >= Number(value.style.maximum)
  )
    return false;
  if (
    value.style.midpoint !== undefined &&
    (value.style.minimum === undefined ||
      value.style.maximum === undefined ||
      Number(value.style.midpoint) <= Number(value.style.minimum) ||
      Number(value.style.midpoint) >= Number(value.style.maximum))
  )
    return false;
  if (
    value.style.categories !== undefined &&
    (!Array.isArray(value.style.categories) ||
      value.style.categories.length > 100 ||
      !value.style.categories.every((v) => text(v)))
  )
    return false;
  if (
    !Array.isArray(value.sources) ||
    !value.sources.length ||
    value.sources.length > 100 ||
    !value.sources.every(
      (s) =>
        record(s) &&
        text(s.id) &&
        text(s.label, 500) &&
        (s.url === undefined || (typeof s.url === "string" && /^https?:\/\//.test(s.url)))
    )
  )
    return false;
  const sources = new Set(value.sources.map((s) => (s as MapArtifactSource).id));
  if (
    value.legend !== undefined &&
    (!record(value.legend) ||
      !["title", "unit", "time", "noDataLabel"].every(
        (k) =>
          typeof (value.legend as Record<string, unknown>)[k] === "string" &&
          String((value.legend as Record<string, unknown>)[k]).length <= 200
      ))
  )
    return false;
  if (
    !record(value.data) ||
    value.data.type !== "FeatureCollection" ||
    !Array.isArray(value.data.features) ||
    value.data.features.length > 10000
  )
    return false;
  if (value.registeredRaster !== undefined) {
    const reference = value.registeredRaster;
    if (
      !record(reference) ||
      !text(reference.layerId) ||
      Object.keys(reference).some((key) => key !== "layerId") ||
      CATALOG_DATA[reference.layerId]?.geometry !== "raster" ||
      !CATALOG_DATA[reference.layerId]?.operations.includes("display") ||
      value.data.features.length !== 0 ||
      !value.legend ||
      value.style.minimum !== undefined ||
      value.style.maximum !== undefined ||
      value.style.categories !== undefined
    )
      return false;
  }
  let count = 0;
  const ids = new Set<string>();
  const position = (p: unknown) =>
    Array.isArray(p) &&
    p.length === 2 &&
    p.every(finite) &&
    Math.abs(p[0]) <= 180 &&
    Math.abs(p[1]) <= 90 &&
    ++count <= 100000;
  const line = (p: unknown) => Array.isArray(p) && p.length >= 2 && p.every(position);
  const ring = (p: unknown) =>
    line(p) &&
    Array.isArray(p) &&
    p.length >= 4 &&
    JSON.stringify(p[0]) === JSON.stringify(p.at(-1));
  const polygon = (p: unknown) => Array.isArray(p) && p.length > 0 && p.every(ring);
  const geometry = (g: unknown) => {
    if (!record(g)) return false;
    const p = g.coordinates;
    switch (g.type) {
      case "Point":
        return position(p);
      case "MultiPoint":
        return Array.isArray(p) && p.length > 0 && p.every(position);
      case "LineString":
        return line(p);
      case "MultiLineString":
        return Array.isArray(p) && p.length > 0 && p.every(line);
      case "Polygon":
        return polygon(p);
      case "MultiPolygon":
        return Array.isArray(p) && p.length > 0 && p.every(polygon);
      default:
        return false;
    }
  };
  return value.data.features.every((f) => {
    if (
      !record(f) ||
      f.type !== "Feature" ||
      !text(f.id) ||
      ids.has(f.id) ||
      !geometry(f.geometry) ||
      !record(f.properties) ||
      !text(f.properties.title, 500) ||
      !sources.has(String(f.properties.sourceId))
    )
      return false;
    ids.add(f.id);
    const number = f.properties.value;
    if (number !== undefined && number !== null && (!finite(number) || !value.legend)) return false;
    return true;
  });
}

/** Changes cross a trust boundary even when a registered model adapter produced them. */
export function isMapScenePatch(value: unknown): value is MapScenePatch {
  if (
    !record(value) ||
    value.schema !== "mapos.scene-patch" ||
    value.schemaVersion !== "1.0.0" ||
    !text(value.id) ||
    !text(value.runId) ||
    !text(value.conversationId) ||
    !text(value.explanation, 500) ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 0
  )
    return false;
  if (
    Object.keys(value).some(
      (k) =>
        ![
          "schema",
          "schemaVersion",
          "id",
          "runId",
          "conversationId",
          "revision",
          "explanation",
          "basemapId",
          "layers",
          "artifactIds",
          "bbox",
          "time"
        ].includes(k)
    )
  )
    return false;
  if (
    value.artifactIds !== undefined &&
    (!Array.isArray(value.artifactIds) ||
      value.artifactIds.length > 30 ||
      !value.artifactIds.every((id) => text(id)))
  )
    return false;
  return isMapContextSnapshot({
    schema: "mapos.map-context",
    schemaVersion: "1.0.0",
    revision: value.revision,
    basemapId: value.basemapId ?? "unchanged",
    view: { longitude: 0, latitude: 0, zoom: 1 },
    layers: value.layers ?? {},
    time: value.time ?? null,
    areaId: null,
    selectedFeatureIds: [],
    planRevision: null,
    ...(value.bbox !== undefined ? { bbox: value.bbox } : {})
  });
}
