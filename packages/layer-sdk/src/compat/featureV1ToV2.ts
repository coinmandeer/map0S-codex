import type { GeoFeature, GeoFeatureProperties } from "../types.js";
import { MAPOS_V2_SCHEMA_VERSION, type JsonValue } from "../v2/common.js";
import type { MapOSFeatureKind, MapOSFeatureV2 } from "../v2/feature.js";
import type { SourceRights } from "../v2/source.js";

export interface FeatureV1ToV2Options {
  providerId: string;
  attribution: string;
  retrievedAt: string;
  sourceId?: string;
  originalUrl?: string;
  license?: string | null;
  rights?: SourceRights;
  confidence?: number;
  kind?: MapOSFeatureKind;
}

function jsonValue(value: unknown): JsonValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const converted = jsonValue(item);
      return converted === undefined ? [] : [converted];
    });
  }
  if (typeof value === "object" && value) {
    const entries = Object.entries(value).flatMap(([key, item]) => {
      const converted = jsonValue(item);
      return converted === undefined ? [] : ([[key, converted]] as const);
    });
    return Object.fromEntries(entries);
  }
  return undefined;
}

function providerFields(properties: GeoFeatureProperties): Record<string, JsonValue> {
  const ignored = new Set(["id", "name", "category", "layerId"]);
  return Object.fromEntries(
    Object.entries(properties).flatMap(([key, value]) => {
      if (ignored.has(key)) return [];
      const converted = jsonValue(value);
      return converted === undefined ? [] : ([[key, converted]] as const);
    })
  );
}

function validDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
}

/** Deterministically promotes the existing point contract into the canonical v2 envelope. */
export function featureV1ToV2(feature: GeoFeature, options: FeatureV1ToV2Options): MapOSFeatureV2 {
  const category = feature.properties.category ?? "uncategorized";
  const sourceUrl =
    options.originalUrl ??
    (typeof feature.properties.website === "string" ? feature.properties.website : undefined);
  const occurredAt = validDate(feature.properties.occurredAt);
  return {
    schema: "mapos.feature",
    schemaVersion: MAPOS_V2_SCHEMA_VERSION,
    id: feature.properties.id,
    revision: 1,
    geometry: feature.geometry,
    properties: {
      title: feature.properties.name,
      kind: options.kind ?? "place",
      category,
      layerIds: [feature.properties.layerId],
      ...(sourceUrl
        ? { urls: [{ label: "Zdrojový záznam", url: sourceUrl, kind: "source" }] }
        : {}),
      ...(occurredAt ? { temporal: { startsAt: occurredAt, endsAt: occurredAt } } : {}),
      providerFields: { [options.providerId]: providerFields(feature.properties) },
      extensions: { "dev.mapos.migration": { legacyLayerId: feature.properties.layerId } }
    },
    sources: [
      {
        providerId: options.providerId,
        sourceId: options.sourceId ?? feature.properties.id,
        ...(sourceUrl ? { originalUrl: sourceUrl } : {}),
        retrievedAt: options.retrievedAt,
        confidence: options.confidence ?? 1,
        attribution: options.attribution,
        license: options.license ?? null,
        rights: options.rights ?? "unknown",
        rawRef: options.sourceId ?? feature.properties.id
      }
    ],
    access: { visibility: "public", permissions: ["view", "share"] },
    createdAt: occurredAt ?? options.retrievedAt,
    updatedAt: options.retrievedAt
  };
}
