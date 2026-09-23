/**
 * The one-off import behind every thematic overlay.
 *
 * Boundaries are read once and stored; statistics are then just rows keyed on `(level, code)`.
 * That split is why this file has no schedule: NUTS is revised every three years, so re-running
 * the import is a deliberate act after an edition changes, not a job.
 *
 * Fetching and persisting are both injected. The normalisers are the part with real decisions in
 * them — which property is the code, what nests inside what — and they are tested against
 * fixtures of the actual upstream shapes without a network or a database.
 */

import { sql as dsql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "../db/index.js";
import { fetchText } from "../utils/upstream.js";
import {
  createGeoUnitRelease,
  stageGeoUnitRows,
  publishGeoUnitRelease,
  failGeoUnitRelease,
  updateGeoUnitReleaseMetadata
} from "./geoUnitReleases.js";
import {
  defaultGeoUnitSourceIds,
  GEO_UNIT_SOURCES,
  type GeoJsonFeature,
  type GeoUnitLevel,
  type GeoUnitSource
} from "./geoUnitSources.js";

export interface GeoUnitRow {
  level: GeoUnitLevel;
  code: string;
  name: string;
  parentCode: string | null;
  country: string | null;
  sourceId: string;
  edition: string;
  geometry: { type?: string; coordinates?: unknown };
  areaKm2: number | null;
}

export interface GeoUnitImportResult {
  sourceId: string;
  read: number;
  written: number;
  skipped: number;
  /** Repeated feature identities; staged publication unions disconnected parts. */
  duplicates: number;
}

export interface GeoUnitImportDeps {
  fetchCollection: (url: string, source: GeoUnitSource) => Promise<unknown>;
  persist: (rows: readonly GeoUnitRow[]) => Promise<void>;
}

/** Rows per statement. Large enough that a continent is a handful of round trips, small enough
 *  that one failure does not lose the whole import. */
const BATCH = 200;

export async function importGeoUnitSource(
  source: GeoUnitSource,
  deps: GeoUnitImportDeps
): Promise<GeoUnitImportResult> {
  const countries = source.countries ?? [undefined];

  const result: GeoUnitImportResult = {
    sourceId: source.id,
    read: 0,
    written: 0,
    skipped: 0,
    duplicates: 0
  };
  const seen = new Set<string>();
  let batch: GeoUnitRow[] = [];

  for (const country of countries) {
    const url = country ? await resolveCountryUrl(source, country, deps) : source.url;
    if (!url) throw new Error("Boundary dataset download is missing");
    const features = featuresOf(await deps.fetchCollection(url, source));
    if (!features.length) throw new Error("Boundary dataset is empty");
    for (const feature of features) {
      result.read += 1;
      const row = source.normalize(feature, source);
      if (!row || !isDrawable(row.geometry)) {
        result.skipped += 1;
        continue;
      }
      const key = `${row.level}/${row.code}`;
      if (seen.has(key)) result.duplicates += 1;
      seen.add(key);
      batch.push(row);
      if (batch.length >= BATCH) {
        await deps.persist(batch);
        result.written += batch.length;
        batch = [];
      }
    }
  }
  if (batch.length) {
    await deps.persist(batch);
    result.written += batch.length;
  }
  return result;
}

/** geoBoundaries answers with metadata whose `simplifiedGeometryGeoJSON` is the file to read. */
async function resolveCountryUrl(
  source: GeoUnitSource,
  country: string,
  deps: GeoUnitImportDeps
): Promise<string | undefined> {
  const metadata = await deps.fetchCollection(source.resolveUrls!(country), source);
  const entry = Array.isArray(metadata) ? metadata[0] : metadata;
  if (!entry || typeof entry !== "object") return undefined;
  const record = entry as Record<string, unknown>;
  const url = record.simplifiedGeometryGeoJSON ?? record.gjDownloadURL;
  return typeof url === "string" ? url : undefined;
}

export function featuresOf(payload: unknown): GeoJsonFeature[] {
  if (!payload || typeof payload !== "object") return [];
  const features = (payload as { features?: unknown }).features;
  return Array.isArray(features) ? (features as GeoJsonFeature[]) : [];
}

/** A boundary with no ring is a data error upstream, not a territory. Point and line geometries
 *  appear in these files for capitals and coastlines and are not what this table is for. */
function isDrawable(geometry: { type?: string; coordinates?: unknown }): boolean {
  if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") return false;
  return Array.isArray(geometry.coordinates) && geometry.coordinates.length > 0;
}

/** The default fetch: guarded, rate-limited per source and capped in size. */
export async function fetchGeoUnitCollection(url: string, source: GeoUnitSource): Promise<unknown> {
  const download = new URL(url);
  // The API publishes GitHub /raw links, which redirect. Use the same immutable file's
  // canonical raw host so the guarded transport can keep its no-redirect policy.
  const match = /^\/([^/]+)\/([^/]+)\/raw\/(.+)$/.exec(download.pathname);
  if (download.hostname === "github.com" && match) {
    download.hostname = "raw.githubusercontent.com";
    download.pathname = `/${match[1]}/${match[2]}/${match[3]}`;
  }
  const options = {
    providerId: source.providerId,
    ttlMs: 0,
    timeoutMs: 60_000,
    minIntervalMs: 500,
    retries: 2,
    maxResponseBytes: source.maxResponseBytes ?? 16 * 1024 * 1024,
    acceptedContentTypes: [
      "application/json",
      "application/geo+json",
      "text/plain",
      "application/octet-stream"
    ]
  };
  let content = await fetchText(download.toString(), options);
  const pointer =
    /^version https:\/\/git-lfs.github.com\/spec\/v1\noid sha256:([a-f0-9]{64})\nsize (\d+)\s*$/.exec(
      content
    );
  if (pointer && download.hostname === "raw.githubusercontent.com") {
    if (Number(pointer[2]) > options.maxResponseBytes)
      throw new Error("Boundary file exceeds import size budget");
    download.hostname = "media.githubusercontent.com";
    download.pathname = `/media${download.pathname}`;
    content = await fetchText(download.toString(), options);
    if (
      Buffer.byteLength(content) !== Number(pointer[2]) ||
      createHash("sha256").update(content).digest("hex") !== pointer[1]
    ) {
      throw new Error("Boundary file does not match its published LFS checksum");
    }
  }
  return JSON.parse(content) as unknown;
}

/**
 * The default persist: one upsert per row, with PostGIS doing the geometry work.
 *
 * `ST_Multi` normalises a Polygon into a MultiPolygon so the column type holds for both, and
 * `ST_MakeValid` is what stops one self-intersecting ring — common in simplified boundaries —
 * from failing the whole batch.
 */
export async function persistGeoUnits(rows: readonly GeoUnitRow[]): Promise<void> {
  for (const row of rows) {
    await db.execute(dsql`
      INSERT INTO geo_units
        (level, code, name, parent_code, country, source_id, edition, geom, centroid, area_km2)
      VALUES (
        ${row.level},
        ${row.code},
        ${row.name},
        ${row.parentCode},
        ${row.country},
        ${row.sourceId},
        ${row.edition},
        ST_Multi(ST_MakeValid(ST_GeomFromGeoJSON(${JSON.stringify(row.geometry)}))),
        ST_PointOnSurface(ST_MakeValid(ST_GeomFromGeoJSON(${JSON.stringify(row.geometry)})))::geography,
        ${row.areaKm2}
      )
      ON CONFLICT (level, code) DO UPDATE SET
        name = EXCLUDED.name,
        parent_code = EXCLUDED.parent_code,
        country = EXCLUDED.country,
        source_id = EXCLUDED.source_id,
        edition = EXCLUDED.edition,
        geom = EXCLUDED.geom,
        centroid = EXCLUDED.centroid,
        area_km2 = EXCLUDED.area_km2,
        imported_at = now()
    `);
  }
}

export async function importAllGeoUnits(
  ids: readonly string[] = defaultGeoUnitSourceIds(),
  deps?: GeoUnitImportDeps
): Promise<GeoUnitImportResult[]> {
  const results: GeoUnitImportResult[] = [];
  for (const source of GEO_UNIT_SOURCES) {
    if (!ids.includes(source.id)) continue;
    if (deps) {
      results.push(await importGeoUnitSource(source, deps));
      continue;
    }
    const release = await createGeoUnitRelease(source);
    const resolvedSource = { ...source };
    try {
      const result = await importGeoUnitSource(resolvedSource, {
        fetchCollection: async (url, inputSource) => {
          const payload = await fetchGeoUnitCollection(url, inputSource);
          const metadata = Array.isArray(payload) ? payload[0] : payload;
          if (
            source.countries?.length === 1 &&
            metadata &&
            typeof metadata === "object" &&
            "boundaryID" in metadata
          ) {
            const record = metadata as Record<string, unknown>;
            if (
              record.boundaryISO !== source.countries[0] ||
              record.boundaryType !== source.level.toUpperCase()
            ) {
              throw new Error("Boundary metadata does not match requested territory");
            }
            if (typeof record.boundaryLicense !== "string" || !record.boundaryLicense)
              throw new Error("Boundary licence is missing");
            resolvedSource.edition = String(record.boundaryID);
            resolvedSource.license = record.boundaryLicense;
            resolvedSource.attribution = `geoBoundaries; ${String(record.boundarySource ?? "")}; ${String(record.boundaryYearRepresented ?? "")}`;
            await updateGeoUnitReleaseMetadata(release, resolvedSource);
          }
          return payload;
        },
        persist: (rows) => stageGeoUnitRows(release, rows)
      });
      if (!result.written || result.skipped || (source.resolveUrls && result.duplicates)) {
        throw new Error("Boundary import requires review before publication");
      }
      await publishGeoUnitRelease(release);
      results.push(result);
    } catch (error) {
      await failGeoUnitRelease(release);
      throw error;
    }
  }
  return results;
}
