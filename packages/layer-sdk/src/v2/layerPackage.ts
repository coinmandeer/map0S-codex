import type { JsonValue } from "./common.js";
import { MAPOS_V2_SCHEMA_VERSION, assertCompatibleSchema } from "./common.js";
import type { MapOSFeatureV2 } from "./feature.js";
import type { LayerManifestV2 } from "./layer.js";
import type { SourceRecordV2, SourceRights } from "./source.js";
import { assertLayerManifestV2, assertMapOSFeatureV2 } from "./validation.js";
import { xmlAttribute, xmlChildText, xmlElements } from "./xml.js";

export const MAPOS_LAYER_PACKAGE_SCHEMA = "mapos.layer-package" as const;
export const MAPOS_LAYER_PACKAGE_VERSION = MAPOS_V2_SCHEMA_VERSION;
export const LAYER_IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const LAYER_IMPORT_MAX_FEATURES = 1_000;
export const LAYER_IMPORT_PREVIEW_SAMPLE = 20;

export type LayerImportFormatV2 = "mapos-package" | "geojson" | "csv" | "gpx";
export type LayerImportPinKindV2 = "place" | "route" | "task";
export type LayerImportVisibilityV2 = "private" | "public";

export interface MapOSLayerPackageV2 {
  schema: typeof MAPOS_LAYER_PACKAGE_SCHEMA;
  schemaVersion: string;
  id: string;
  exportedAt: string;
  manifest: LayerManifestV2;
  data: { type: "FeatureCollection"; features: MapOSFeatureV2[] };
  sources?: SourceRecordV2[];
  media?: Array<{ id: string; path: string; mediaType: string }>;
  styles?: Record<string, JsonValue>;
  readme?: string;
}

export interface LayerImportInputV2 {
  filename: string;
  /** CSV or raw JSON. API clients can send document instead to avoid JSON double encoding. */
  content?: string;
  document?: unknown;
}

export interface LayerImportCandidateV2 {
  sourceFeatureId: string;
  name: string;
  description: string | null;
  lng: number;
  lat: number;
  tags: string[];
  kind: LayerImportPinKindV2;
  properties: Record<string, JsonValue>;
  sources: SourceRecordV2[];
  /** The line a `route` candidate draws. `lng`/`lat` stay the anchor — the point the candidate
   *  is found, clustered and searched by — because a track still has to behave like one place
   *  in every list. Absent for a plain point. */
  path?: Array<[number, number]>;
}

export interface LayerImportDuplicateV2 {
  fingerprint: string;
  sourceFeatureIds: string[];
}

export interface LayerImportPreviewV2 {
  format: LayerImportFormatV2;
  filename: string;
  name: string;
  color: string;
  requestedVisibility: LayerImportVisibilityV2;
  featureCount: number;
  sample: LayerImportCandidateV2[];
  duplicates: LayerImportDuplicateV2[];
  warnings: string[];
  publicationErrors: string[];
  geometryRepairs: [];
}

export interface ParsedLayerImportV2 {
  preview: LayerImportPreviewV2;
  manifest: LayerManifestV2 | null;
  candidates: LayerImportCandidateV2[];
}

export interface LayerImportReportV2 {
  schema: "mapos.layer-import-report";
  schemaVersion: typeof MAPOS_LAYER_PACKAGE_VERSION;
  id: string;
  previewId: string;
  layerId: string | null;
  status: "committed" | "rolled-back";
  format: LayerImportFormatV2;
  featureCount: number;
  packageDigest: string;
  createdAt: string;
  rolledBackAt: string | null;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number, fallback = ""): string {
  return typeof value === "string" ? value.trim().slice(0, max) || fallback : fallback;
}

function utf8Bytes(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const code = char.codePointAt(0)!;
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function safeJson(value: unknown, depth = 0): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Import contains a non-finite number.");
    return value;
  }
  if (depth >= 12) throw new TypeError("Import data is nested too deeply.");
  if (Array.isArray(value)) return value.map((entry) => safeJson(entry, depth + 1));
  if (!record(value)) throw new TypeError("Import contains a non-JSON value.");
  const output: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
  for (const [key, entry] of Object.entries(value)) {
    if (["__proto__", "prototype", "constructor"].includes(key)) {
      throw new TypeError("Import contains an unsafe property name.");
    }
    output[key] = safeJson(entry, depth + 1);
  }
  return output;
}

function jsonObject(value: unknown): Record<string, JsonValue> {
  const clean = safeJson(record(value) ? value : {});
  if (!record(clean)) return {};
  const encoded = JSON.stringify(clean);
  if (utf8Bytes(encoded) > 16_384) {
    throw new TypeError("Properties of one feature exceed 16384 bytes.");
  }
  return clean;
}

function position(value: unknown): [number, number] {
  if (!Array.isArray(value) || value.length < 2) throw new TypeError("Feature has no position.");
  const lng = Number(value[0]);
  const lat = Number(value[1]);
  if (
    !Number.isFinite(lng) ||
    !Number.isFinite(lat) ||
    lng < -180 ||
    lng > 180 ||
    lat < -90 ||
    lat > 90
  ) {
    throw new TypeError("Feature has invalid coordinates.");
  }
  return [lng, lat];
}

function tags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => text(entry, 40)).filter(Boolean))].slice(0, 12);
}

function kind(value: unknown): LayerImportPinKindV2 {
  return value === "route" || value === "task" ? value : "place";
}

function color(value: unknown): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : "#10b981";
}

function rights(value: unknown): SourceRights {
  return ["open", "restricted-display", "restricted-export", "private", "unknown"].includes(
    String(value)
  )
    ? (value as SourceRights)
    : "unknown";
}

function legacySources(value: unknown, fallbackId: string, now: string): SourceRecordV2[] {
  if (!Array.isArray(value)) {
    return [
      {
        providerId: "mapos-import",
        sourceId: fallbackId,
        retrievedAt: now,
        confidence: 1,
        attribution: "Imported by the layer owner",
        license: null,
        rights: "unknown"
      }
    ];
  }
  const sources = value.slice(0, 16).flatMap((entry): SourceRecordV2[] => {
    if (!record(entry)) return [];
    const providerId = text(entry.providerId ?? entry.source, 80);
    const sourceId = text(entry.sourceId ?? entry.sourceRef, 240);
    if (!providerId || !sourceId) return [];
    const license = text(entry.license, 120) || null;
    const attribution = text(entry.attribution, 500);
    return [
      {
        providerId,
        sourceId,
        retrievedAt: text(entry.retrievedAt ?? entry.capturedAt, 40, now),
        confidence:
          typeof entry.confidence === "number" && entry.confidence >= 0 && entry.confidence <= 1
            ? entry.confidence
            : 1,
        attribution,
        license,
        rights: entry.rights === undefined && license && attribution ? "open" : rights(entry.rights)
      }
    ];
  });
  return sources.length ? sources : legacySources(undefined, fallbackId, now);
}

function sourceRecords(value: unknown, fallbackId: string, now: string): SourceRecordV2[] {
  return legacySources(value, fallbackId, now).map((source) => ({ ...source }));
}

function assertSourceRecord(value: unknown, field: string): asserts value is SourceRecordV2 {
  if (!record(value)) throw new TypeError(`${field} must be an object.`);
  if (!text(value.providerId, 80) || !text(value.sourceId, 240)) {
    throw new TypeError(`${field} requires providerId and sourceId.`);
  }
  if (!text(value.retrievedAt, 40) || Number.isNaN(Date.parse(String(value.retrievedAt)))) {
    throw new TypeError(`${field}.retrievedAt must be a date-time.`);
  }
  if (typeof value.confidence !== "number" || value.confidence < 0 || value.confidence > 1) {
    throw new TypeError(`${field}.confidence must be between 0 and 1.`);
  }
  if (value.rights !== undefined && rights(value.rights) !== value.rights) {
    throw new TypeError(`${field}.rights is invalid.`);
  }
}

export function assertMapOSLayerPackageV2(value: unknown): asserts value is MapOSLayerPackageV2 {
  if (!record(value)) throw new TypeError("Layer package must be an object.");
  assertCompatibleSchema(
    { schema: String(value.schema), schemaVersion: String(value.schemaVersion) },
    MAPOS_LAYER_PACKAGE_SCHEMA
  );
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(String(value.id ?? ""))) {
    throw new TypeError("Layer package id is invalid.");
  }
  if (typeof value.exportedAt !== "string" || Number.isNaN(Date.parse(value.exportedAt))) {
    throw new TypeError("Layer package exportedAt must be a date-time.");
  }
  assertLayerManifestV2(value.manifest);
  if (
    !record(value.data) ||
    value.data.type !== "FeatureCollection" ||
    !Array.isArray(value.data.features)
  ) {
    throw new TypeError("Layer package has no FeatureCollection.");
  }
  if (value.data.features.length > LAYER_IMPORT_MAX_FEATURES) {
    throw new TypeError(`Layer package contains more than ${LAYER_IMPORT_MAX_FEATURES} features.`);
  }
  value.data.features.forEach(assertMapOSFeatureV2);
  if (value.sources !== undefined) {
    if (!Array.isArray(value.sources) || value.sources.length > LAYER_IMPORT_MAX_FEATURES) {
      throw new TypeError("Layer package sources are invalid.");
    }
    value.sources.forEach((source, index) => assertSourceRecord(source, `sources[${index}]`));
  }
  if (value.media !== undefined) {
    if (!Array.isArray(value.media) || value.media.length > LAYER_IMPORT_MAX_FEATURES) {
      throw new TypeError("Layer package media inventory is invalid.");
    }
    for (const [index, media] of value.media.entries()) {
      if (
        !record(media) ||
        !text(media.id, 160) ||
        !text(media.mediaType, 160) ||
        !text(media.path, 500) ||
        String(media.path).startsWith("/") ||
        String(media.path).split(/[\\/]/).includes("..")
      ) {
        throw new TypeError(`media[${index}] must use a safe relative path.`);
      }
    }
  }
}

function candidateFromGeoJson(
  raw: unknown,
  index: number,
  format: LayerImportFormatV2,
  now: string
): LayerImportCandidateV2 {
  if (!record(raw) || raw.type !== "Feature" || !record(raw.geometry)) {
    throw new TypeError(`Feature ${index + 1} is not a GeoJSON Feature.`);
  }
  if (raw.geometry.type !== "Point") {
    throw new TypeError(
      `Feature ${index + 1} uses unsupported geometry; no silent repair was applied.`
    );
  }
  const [lng, lat] = position(raw.geometry.coordinates);
  const properties = record(raw.properties) ? raw.properties : {};
  const sourceFeatureId = text(raw.id, 240, `feature:${index + 1}`);
  const isCanonical = properties.schema === "mapos.feature";
  if (isCanonical) assertMapOSFeatureV2(properties);
  const custom = jsonObject(record(properties.custom) ? properties.custom : properties);
  delete custom.maposProvenance;
  delete custom.sources;
  const rawSources = isCanonical
    ? (properties as unknown as MapOSFeatureV2).sources
    : (properties.maposProvenance ?? properties.sources);
  return {
    sourceFeatureId,
    name: text(properties.name ?? properties.title, 120, `Point ${index + 1}`),
    description: text(properties.description, 2_000) || null,
    lng,
    lat,
    tags: tags(properties.tags),
    kind: kind(properties.kind),
    properties: custom,
    sources: sourceRecords(rawSources, `${format}:${sourceFeatureId}`, now)
  };
}

function candidateFromMapOSFeature(raw: unknown, index: number): LayerImportCandidateV2 {
  assertMapOSFeatureV2(raw);
  if (raw.geometry.type !== "Point") {
    throw new TypeError(
      `Feature ${index + 1} uses unsupported geometry; no silent repair was applied.`
    );
  }
  const [lng, lat] = position(raw.geometry.coordinates);
  return {
    sourceFeatureId: raw.id,
    name: text(raw.properties.title, 120, `Point ${index + 1}`),
    description: text(raw.properties.description, 2_000) || null,
    lng,
    lat,
    tags: tags(raw.properties.tags),
    kind: kind(raw.properties.kind),
    properties: jsonObject(raw.properties.extensions ?? {}),
    sources: raw.sources.map((source) => ({ ...source }))
  };
}

function csvRows(value: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index <= value.length; index += 1) {
    const character = value[index] ?? "\n";
    if (quoted && character === '"' && value[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') quoted = !quoted;
    else if (!quoted && (character === "," || character === ";")) {
      row.push(cell);
      cell = "";
    } else if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && value[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((entry) => entry.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += character;
  }
  if (quoted) throw new TypeError("CSV has an unterminated quote.");
  return rows;
}

function parseCsv(content: string, now: string): LayerImportCandidateV2[] {
  const rows = csvRows(content);
  const headers = rows.shift()?.map((entry) => entry.trim().toLowerCase()) ?? [];
  const column = (name: string) => headers.indexOf(name);
  if (column("lng") < 0 || column("lat") < 0)
    throw new TypeError("CSV requires lng and lat columns.");
  return rows.map((row, index) => {
    const [lng, lat] = position([row[column("lng")], row[column("lat")]]);
    const sourceId = text(row[column("sourceref")], 240, `row:${index + 2}`);
    const attribution = text(row[column("attribution")], 500);
    const license = text(row[column("license")], 120) || null;
    return {
      sourceFeatureId: sourceId,
      name: text(row[column("name")], 120, `Point ${index + 1}`),
      description: text(row[column("description")], 2_000) || null,
      lng,
      lat,
      tags: text(row[column("tags")], 500)
        .split("|")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .slice(0, 12),
      kind: kind(row[column("kind")]),
      properties: {},
      sources: [
        {
          providerId: text(row[column("source")], 80, "csv-import"),
          sourceId,
          retrievedAt: now,
          confidence: 1,
          attribution,
          license,
          rights: attribution && license ? "open" : "unknown"
        }
      ]
    };
  });
}

/** A watch writes a fix every second, so an afternoon ride arrives as tens of thousands of
 *  points. Storing and drawing all of them costs far more than it shows: at any zoom a route is
 *  a line, and the jitter between consecutive fixes is smaller than the line is wide. */
const GPX_PATH_MAX_POINTS = 2_000;
/** Roughly a metre. Below GPS accuracy, so removing these points cannot change the drawn line. */
const GPX_SIMPLIFY_TOLERANCE_DEG = 1e-5;

function gpxPoints(source: string, tag: string): Array<[number, number]> {
  return xmlElements(source, tag).map((element) =>
    position([xmlAttribute(element.attributes, "lon"), xmlAttribute(element.attributes, "lat")])
  );
}

function perpendicularDistance(
  point: [number, number],
  start: [number, number],
  end: [number, number]
): number {
  const runX = end[0] - start[0];
  const runY = end[1] - start[1];
  if (runX === 0 && runY === 0) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const along =
    ((point[0] - start[0]) * runX + (point[1] - start[1]) * runY) / (runX * runX + runY * runY);
  const clamped = Math.min(1, Math.max(0, along));
  return Math.hypot(point[0] - (start[0] + clamped * runX), point[1] - (start[1] + clamped * runY));
}

/** Ramer–Douglas–Peucker. Chosen over uniform sampling because it keeps the corners, which is
 *  the whole shape of a route; dropping every n-th point rounds off exactly the switchbacks
 *  that make a track recognisable. */
function simplifyPath(
  points: readonly [number, number][],
  tolerance: number
): Array<[number, number]> {
  if (points.length < 3) return [...points];
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const spans: Array<[number, number]> = [[0, points.length - 1]];
  while (spans.length) {
    const [first, last] = spans.pop()!;
    let farthestIndex = -1;
    let farthest = tolerance;
    for (let index = first + 1; index < last; index += 1) {
      const distance = perpendicularDistance(points[index]!, points[first]!, points[last]!);
      if (distance > farthest) {
        farthest = distance;
        farthestIndex = index;
      }
    }
    if (farthestIndex < 0) continue;
    keep[farthestIndex] = 1;
    spans.push([first, farthestIndex], [farthestIndex, last]);
  }
  return points.filter((_point, index) => keep[index] === 1);
}

function boundedPath(points: readonly [number, number][]): {
  path: Array<[number, number]>;
  reduced: boolean;
} {
  let tolerance = GPX_SIMPLIFY_TOLERANCE_DEG;
  let path = simplifyPath(points, tolerance);
  // Raising the tolerance geometrically converges in a handful of passes even for a very dense
  // track, and stops well before a tolerance that would visibly move the line.
  while (path.length > GPX_PATH_MAX_POINTS && tolerance < 0.01) {
    tolerance *= 4;
    path = simplifyPath(points, tolerance);
  }
  return { path, reduced: path.length < points.length };
}

function pathLengthKm(points: readonly [number, number][]): number {
  let metres = 0;
  for (let index = 1; index < points.length; index += 1) {
    const [previousLng, previousLat] = points[index - 1]!;
    const [lng, lat] = points[index]!;
    const meanLat = (((previousLat + lat) / 2) * Math.PI) / 180;
    // Equirectangular: the error against haversine over a single fix interval is far below the
    // accuracy of the fixes themselves, and this is a summary shown to one decimal place.
    const east = (lng - previousLng) * 111_320 * Math.cos(meanLat);
    const north = (lat - previousLat) * 110_574;
    metres += Math.hypot(east, north);
  }
  return Math.round(metres) / 1000;
}

function gpxSource(sourceId: string, now: string): SourceRecordV2[] {
  return [
    {
      providerId: "gpx-import",
      sourceId,
      retrievedAt: now,
      confidence: 1,
      // A GPX out of a watch or a planner is the importer's own recording. Claiming a licence
      // for it would be inventing provenance, so it stays `unknown` and cannot be published.
      attribution: "",
      license: null,
      rights: "unknown"
    }
  ];
}

function parseGpx(
  content: string,
  now: string
): { candidates: LayerImportCandidateV2[]; warnings: string[] } {
  if (!/<gpx[\s>]/i.test(content)) throw new TypeError("GPX has no <gpx> root element.");
  const candidates: LayerImportCandidateV2[] = [];
  let reducedTracks = 0;

  xmlElements(content, "wpt").forEach((element, index) => {
    const [lng, lat] = position([
      xmlAttribute(element.attributes, "lon"),
      xmlAttribute(element.attributes, "lat")
    ]);
    const sourceFeatureId = `wpt:${index + 1}`;
    const elevation = Number(xmlChildText(element.inner, "ele"));
    const time = xmlChildText(element.inner, "time");
    candidates.push({
      sourceFeatureId,
      name: text(xmlChildText(element.inner, "name"), 120, `Bod ${index + 1}`),
      description:
        text(xmlChildText(element.inner, "desc") || xmlChildText(element.inner, "cmt"), 2_000) ||
        null,
      lng,
      lat,
      tags: [],
      kind: "place",
      properties: {
        ...(Number.isFinite(elevation) && elevation !== 0 ? { elevationM: elevation } : {}),
        ...(time && !Number.isNaN(Date.parse(time)) ? { recordedAt: time } : {})
      },
      sources: gpxSource(sourceFeatureId, now)
    });
  });

  // Tracks are what a watch records; routes are what a planner exports. They differ in intent
  // upstream but arrive here as the same thing — an ordered line with a name.
  for (const [tag, pointTag, label] of [
    ["trk", "trkpt", "Trasa"],
    ["rte", "rtept", "Trasa"]
  ] as const) {
    xmlElements(content, tag).forEach((element, index) => {
      const points = gpxPoints(element.inner, pointTag);
      if (points.length < 2) return;
      const { path, reduced } = boundedPath(points);
      if (reduced) reducedTracks += 1;
      // The name and description sit before the first point in GPX's own ordering, so reading
      // only the head avoids picking up a name that belongs to a point inside the track.
      const head =
        element.inner.split(
          new RegExp(`<${pointTag === "trkpt" ? "trkseg" : "rtept"}\\b`, "i")
        )[0] ?? "";
      const sourceFeatureId = `${tag}:${index + 1}`;
      candidates.push({
        sourceFeatureId,
        name: text(xmlChildText(head, "name"), 120, `${label} ${index + 1}`),
        description: text(xmlChildText(head, "desc") || xmlChildText(head, "cmt"), 2_000) || null,
        lng: path[0]![0],
        lat: path[0]![1],
        tags: [],
        kind: "route",
        properties: { distanceKm: pathLengthKm(points), pointCount: path.length },
        sources: gpxSource(sourceFeatureId, now),
        path
      });
    });
  }

  const warnings = ["GPX has no MapOS manifest and can only be imported privately."];
  if (reducedTracks) {
    warnings.push(
      `${reducedTracks === 1 ? "Trasa byla" : `${reducedTracks} trasy byly`} zjednodušena pod ` +
        `${GPX_PATH_MAX_POINTS} bodů; tvar linie zůstává, jen bez záznamového šumu.`
    );
  }
  return { candidates, warnings };
}

function publicationErrors(
  manifest: LayerManifestV2 | null,
  candidates: readonly LayerImportCandidateV2[]
): string[] {
  const errors: string[] = [];
  if (!manifest) errors.push("Public import requires a MapOS package manifest.");
  if (
    manifest &&
    (manifest.attribution ?? []).some((entry) => !entry.label.trim() || !entry.license?.trim())
  ) {
    errors.push("Every manifest attribution requires both label and license for publication.");
  }
  if (
    candidates.some((candidate) =>
      candidate.sources.some(
        (source) =>
          !source.attribution?.trim() || !source.license?.trim() || source.rights !== "open"
      )
    )
  ) {
    errors.push(
      "Every feature source requires attribution, licence and open rights for publication."
    );
  }
  return [...new Set(errors)];
}

function duplicateGroups(candidates: readonly LayerImportCandidateV2[]): LayerImportDuplicateV2[] {
  const groups = new Map<string, string[]>();
  for (const candidate of candidates) {
    const fingerprint = `${candidate.lng.toFixed(6)},${candidate.lat.toFixed(6)}:${candidate.name.trim().toLocaleLowerCase("en")}`;
    groups.set(fingerprint, [...(groups.get(fingerprint) ?? []), candidate.sourceFeatureId]);
  }
  return [...groups.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([fingerprint, sourceFeatureIds]) => ({ fingerprint, sourceFeatureIds }));
}

function filenameName(filename: string): string {
  return (
    filename
      .replace(/\.(mapos\.)?(geo)?json$/i, "")
      .replace(/\.(csv|gpx)$/i, "")
      .slice(0, 120) || "Imported layer"
  );
}

export function parseLayerImportV2(
  input: LayerImportInputV2,
  now = new Date().toISOString()
): ParsedLayerImportV2 {
  const filename = text(input.filename, 240, "import.json");
  if ((input.content === undefined) === (input.document === undefined)) {
    throw new TypeError("Provide exactly one of content or document.");
  }
  const encoded = input.content ?? JSON.stringify(input.document);
  if (utf8Bytes(encoded) > LAYER_IMPORT_MAX_BYTES) throw new TypeError("Import exceeds 5 MiB.");
  const lowerName = filename.toLowerCase();
  // Sniffed as well as named, because a file copied off a watch or out of a share sheet often
  // keeps a generic name while the content is unambiguous.
  const gpx =
    lowerName.endsWith(".gpx") ||
    (input.content !== undefined && /^\s*(?:<\?xml[^>]*\?>\s*)*<gpx\b/i.test(input.content));
  const csv = !gpx && lowerName.endsWith(".csv");
  let format: LayerImportFormatV2;
  let manifest: LayerManifestV2 | null = null;
  let candidates: LayerImportCandidateV2[];
  let warnings: string[] = [];
  if (gpx) {
    if (input.content === undefined) throw new TypeError("GPX import requires content.");
    format = "gpx";
    const parsed = parseGpx(input.content, now);
    candidates = parsed.candidates;
    warnings = parsed.warnings;
  } else if (csv) {
    if (input.content === undefined) throw new TypeError("CSV import requires content.");
    format = "csv";
    candidates = parseCsv(input.content, now);
    warnings = ["CSV has no MapOS manifest and can only be imported privately."];
  } else {
    let document = input.document;
    if (document === undefined) {
      try {
        document = JSON.parse(input.content!);
      } catch {
        throw new TypeError("Import is not valid JSON.");
      }
    }
    if (!record(document)) throw new TypeError("Import document must be an object.");
    if (
      document.schema === MAPOS_LAYER_PACKAGE_SCHEMA ||
      document.schema === "mapos.user-layer-package"
    ) {
      if (document.schema === MAPOS_LAYER_PACKAGE_SCHEMA) assertMapOSLayerPackageV2(document);
      else
        assertCompatibleSchema(
          { schema: MAPOS_LAYER_PACKAGE_SCHEMA, schemaVersion: String(document.schemaVersion) },
          MAPOS_LAYER_PACKAGE_SCHEMA
        );
      assertLayerManifestV2(document.manifest);
      manifest = document.manifest;
      if (
        !record(document.data) ||
        document.data.type !== "FeatureCollection" ||
        !Array.isArray(document.data.features)
      ) {
        throw new TypeError("MapOS package has no FeatureCollection.");
      }
      format = "mapos-package";
      candidates =
        document.schema === MAPOS_LAYER_PACKAGE_SCHEMA
          ? document.data.features.map(candidateFromMapOSFeature)
          : document.data.features.map((feature, index) =>
              candidateFromGeoJson(feature, index, format, now)
            );
    } else if (document.type === "FeatureCollection" && Array.isArray(document.features)) {
      format = "geojson";
      candidates = document.features.map((feature, index) =>
        candidateFromGeoJson(feature, index, format, now)
      );
      warnings = ["GeoJSON has no MapOS manifest and can only be imported privately."];
    } else throw new TypeError("Supported formats are MapOS package, GeoJSON, CSV and GPX.");
  }
  if (candidates.length > LAYER_IMPORT_MAX_FEATURES)
    throw new TypeError(`Import contains more than ${LAYER_IMPORT_MAX_FEATURES} features.`);
  if (!candidates.length) warnings.push("The import contains no features.");
  const requestedVisibility =
    manifest?.permissions?.defaultVisibility === "public" ? "public" : "private";
  const errors = publicationErrors(manifest, candidates);
  if (requestedVisibility === "public" && errors.length) {
    warnings.push(
      `Prototype source metadata advisory (publication remains available): ${errors.join(" ")}`
    );
  }
  const preview: LayerImportPreviewV2 = {
    format,
    filename,
    name: text(manifest?.name, 120, filenameName(filename)),
    color: color(manifest?.color),
    requestedVisibility,
    featureCount: candidates.length,
    sample: candidates.slice(0, LAYER_IMPORT_PREVIEW_SAMPLE).map((candidate) => {
      // The preview answers "is this the right file", which the anchor and the point count
      // already do. Twenty tracks' worth of coordinates would dwarf the rest of the response
      // for a view that never draws them.
      const { path: _path, ...withoutPath } = candidate;
      return { ...withoutPath, sources: candidate.sources.map((source) => ({ ...source })) };
    }),
    duplicates: duplicateGroups(candidates),
    warnings,
    publicationErrors: [],
    geometryRepairs: []
  };
  return { preview, manifest, candidates };
}

export function assertLayerImportPublishableV2(parsed: ParsedLayerImportV2): void {
  // Prototype policy: source-rights findings are advisory and never block public import.
  void parsed;
}

export function buildMapOSLayerPackageV2(input: {
  id: string;
  manifest: LayerManifestV2;
  features: MapOSFeatureV2[];
  exportedAt: string;
  sources?: SourceRecordV2[];
}): MapOSLayerPackageV2 {
  assertLayerManifestV2(input.manifest);
  input.features.forEach(assertMapOSFeatureV2);
  const layerPackage: MapOSLayerPackageV2 = {
    schema: MAPOS_LAYER_PACKAGE_SCHEMA,
    schemaVersion: MAPOS_LAYER_PACKAGE_VERSION,
    id: input.id,
    exportedAt: input.exportedAt,
    manifest: input.manifest,
    data: { type: "FeatureCollection", features: input.features },
    ...(input.sources ? { sources: input.sources } : {})
  };
  assertMapOSLayerPackageV2(layerPackage);
  return layerPackage;
}

export function layerPackageGeoJsonV2(layerPackage: MapOSLayerPackageV2): string {
  return JSON.stringify(layerPackage.data, null, 2);
}
