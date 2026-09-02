import type { LayerManifestV2 } from "@mapos/layer-sdk";
import {
  MAPOS_HOST_RUNTIME_VERSION,
  MAPOS_LAYER_SDK_RANGE,
  MAPOS_V2_SCHEMA_VERSION,
  assertLayerManifestV2
} from "@mapos/layer-sdk";

export const USER_LAYER_PACKAGE_SCHEMA = "mapos.user-layer-package" as const;
export const USER_LAYER_PACKAGE_VERSION = "2.0.0" as const;
export const USER_LAYER_IMPORT_MAX_FEATURES = 1_000;

export interface LayerTransferProvenance {
  source: string;
  sourceRef: string;
  attribution?: string;
  license?: string;
  capturedAt?: string;
}

export interface UserLayerTransferSource {
  id: string;
  name: string;
  color: string;
  isPublic: number;
  slug?: string;
}

export interface UserPinTransferSource {
  id: string;
  name: string;
  description?: string | null;
  lng: number;
  lat: number;
  tags?: string[];
  kind?: string;
  authorName?: string | null;
  createdAt?: string | Date;
  properties?: Record<string, unknown> | null;
}

export interface UserLayerPackageFeature {
  type: "Feature";
  id?: string;
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    name: string;
    description: string | null;
    tags: string[];
    kind: "place" | "route" | "task";
    maposProvenance: LayerTransferProvenance[];
    custom: Record<string, unknown>;
  };
}

export interface UserLayerPackageV2 {
  schema: typeof USER_LAYER_PACKAGE_SCHEMA;
  schemaVersion: typeof USER_LAYER_PACKAGE_VERSION;
  exportedAt: string;
  manifest: LayerManifestV2;
  data: { type: "FeatureCollection"; features: UserLayerPackageFeature[] };
}

export interface UserLayerImportPreview {
  format: "mapos-package" | "geojson" | "csv";
  name: string;
  color: string;
  requestedVisibility: "private" | "public";
  features: Array<{
    name: string;
    description?: string;
    lng: number;
    lat: number;
    tags: string[];
    kind: "place" | "route" | "task";
    properties: Record<string, unknown>;
  }>;
  warnings: string[];
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanText(value: unknown, max: number, fallback = ""): string {
  return typeof value === "string" ? value.trim().slice(0, max) || fallback : fallback;
}

function cleanColor(value: unknown): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : "#10b981";
}

function cleanPosition(value: unknown): [number, number] {
  if (!Array.isArray(value) || value.length < 2) throw new TypeError("Bodu chybí souřadnice.");
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
    throw new TypeError("Bod má neplatné souřadnice.");
  }
  return [lng, lat];
}

function safeObject(value: unknown): Record<string, unknown> {
  if (!record(value)) return {};
  const encoded = JSON.stringify(value);
  if (encoded.length > 8_192) throw new TypeError("Vlastnosti jednoho bodu jsou příliš velké.");
  return JSON.parse(encoded) as Record<string, unknown>;
}

function cleanKind(value: unknown): "place" | "route" | "task" {
  return value === "route" || value === "task" ? value : "place";
}

function cleanTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => cleanText(item, 40)).filter(Boolean))].slice(0, 8);
}

function cleanProvenance(
  value: unknown,
  fallback: LayerTransferProvenance
): LayerTransferProvenance[] {
  if (!Array.isArray(value)) return [fallback];
  const entries = value.slice(0, 12).flatMap((item) => {
    if (!record(item)) return [];
    const source = cleanText(item.source, 40);
    const sourceRef = cleanText(item.sourceRef, 220);
    if (!source || !sourceRef) return [];
    return [
      {
        source,
        sourceRef,
        ...(cleanText(item.attribution, 500)
          ? { attribution: cleanText(item.attribution, 500) }
          : {}),
        ...(cleanText(item.license, 80) ? { license: cleanText(item.license, 80) } : {}),
        ...(cleanText(item.capturedAt, 40) ? { capturedAt: cleanText(item.capturedAt, 40) } : {})
      }
    ];
  });
  return entries.length ? entries : [fallback];
}

function userLayerManifest(layer: UserLayerTransferSource): LayerManifestV2 {
  return {
    schema: "mapos.layer-manifest",
    schemaVersion: MAPOS_V2_SCHEMA_VERSION,
    sdkRange: MAPOS_LAYER_SDK_RANGE,
    minimumRuntime: MAPOS_HOST_RUNTIME_VERSION,
    id: layer.id,
    name: layer.name,
    description: `Uživatelská vrstva ${layer.name}`,
    icon: "📌",
    color: cleanColor(layer.color),
    category: "user",
    modes: ["personal"],
    geometryKinds: ["Point"],
    renderer: { type: "symbols", cluster: true },
    source: { type: "user-data", adapterId: "mapos-user-layer-v2" },
    queryPolicy: {
      strategy: "global",
      maxResultsPerViewport: 100,
      searchHere: "never",
      cursorPagination: true
    },
    attribution: [{ label: `Autor vrstvy „${layer.name}“`, requiredOnExport: true }],
    capabilities: ["query", "detail", "import", "export"],
    permissions: {
      defaultVisibility: layer.isPublic ? "public" : "private",
      canCreate: true,
      canEdit: true,
      canExport: true,
      requiresAuth: true
    },
    ai: { discoverable: false, permissionProjection: "owner-private" },
    commerce: { access: "free", previewPolicy: "none", tipsEnabled: false },
    importExport: {
      importFormats: ["geojson", "csv", "json", "mapos-package"],
      exportFormats: ["geojson", "json", "mapos-package"],
      includeProviderFields: false
    },
    compatibility: { legacyLayerId: layer.id, legacyAdapter: "userPinV1ToFeatureV2" }
  };
}

export function buildUserLayerPackage(
  layer: UserLayerTransferSource,
  pins: readonly UserPinTransferSource[],
  now: () => Date = () => new Date()
): UserLayerPackageV2 {
  if (pins.length > USER_LAYER_IMPORT_MAX_FEATURES) {
    throw new TypeError(
      `Jedna přenosová dávka může obsahovat nejvýše ${USER_LAYER_IMPORT_MAX_FEATURES} bodů.`
    );
  }
  const exportedAt = now().toISOString();
  const manifest = userLayerManifest(layer);
  assertLayerManifestV2(manifest);
  return {
    schema: USER_LAYER_PACKAGE_SCHEMA,
    schemaVersion: USER_LAYER_PACKAGE_VERSION,
    exportedAt,
    manifest,
    data: {
      type: "FeatureCollection",
      features: pins.map((pin) => {
        const custom = safeObject(pin.properties);
        const fallback: LayerTransferProvenance = {
          source: "mapos-user-layer",
          sourceRef: `${layer.id}:${pin.id}`,
          attribution: pin.authorName ? `Autor: ${pin.authorName}` : `Vrstva: ${layer.name}`,
          capturedAt:
            pin.createdAt instanceof Date
              ? pin.createdAt.toISOString()
              : cleanText(pin.createdAt, 40) || exportedAt
        };
        const maposProvenance = cleanProvenance(custom.maposProvenance, fallback);
        delete custom.maposProvenance;
        return {
          type: "Feature",
          id: pin.id,
          geometry: { type: "Point", coordinates: cleanPosition([pin.lng, pin.lat]) },
          properties: {
            name: cleanText(pin.name, 120, "Místo"),
            description: cleanText(pin.description, 2_000) || null,
            tags: cleanTags(pin.tags),
            kind: cleanKind(pin.kind),
            maposProvenance,
            custom
          }
        };
      })
    }
  };
}

function previewFeatures(
  features: unknown[],
  source: "mapos-package" | "geojson"
): UserLayerImportPreview["features"] {
  if (features.length > USER_LAYER_IMPORT_MAX_FEATURES) {
    throw new TypeError(`Import může obsahovat nejvýše ${USER_LAYER_IMPORT_MAX_FEATURES} bodů.`);
  }
  return features.map((raw, index) => {
    if (!record(raw) || !record(raw.geometry) || raw.geometry.type !== "Point") {
      throw new TypeError(`Prvek ${index + 1} není podporovaný bod.`);
    }
    const properties = record(raw.properties) ? raw.properties : {};
    const [lng, lat] = cleanPosition(raw.geometry.coordinates);
    const name = cleanText(properties.name ?? properties.title, 120, `Bod ${index + 1}`);
    const fallback: LayerTransferProvenance = {
      source: source === "mapos-package" ? "mapos-package" : "geojson-import",
      sourceRef: cleanText(raw.id, 220, `feature:${index + 1}`)
    };
    const provenance = cleanProvenance(properties.maposProvenance, fallback);
    const custom =
      source === "mapos-package" ? safeObject(properties.custom) : safeObject(properties);
    delete custom.maposProvenance;
    return {
      name,
      ...(cleanText(properties.description, 2_000)
        ? { description: cleanText(properties.description, 2_000) }
        : {}),
      lng,
      lat,
      tags: cleanTags(properties.tags),
      kind: cleanKind(properties.kind),
      properties: { ...custom, maposProvenance: provenance }
    };
  });
}

function csvRows(value: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index <= value.length; index += 1) {
    const char = value[index] ?? "\n";
    if (quoted && char === '"' && value[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && (char === "," || char === ";")) {
      row.push(cell);
      cell = "";
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && value[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((item) => item.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (quoted) throw new TypeError("CSV obsahuje neuzavřenou uvozovku.");
  return rows;
}

function parseCsv(value: string, filename: string): UserLayerImportPreview {
  const rows = csvRows(value);
  const headers = rows.shift()?.map((header) => header.trim().toLowerCase()) ?? [];
  const column = (name: string) => headers.indexOf(name);
  if (column("lng") < 0 || column("lat") < 0) {
    throw new TypeError("CSV potřebuje sloupce lng a lat.");
  }
  if (rows.length > USER_LAYER_IMPORT_MAX_FEATURES) {
    throw new TypeError(`Import může obsahovat nejvýše ${USER_LAYER_IMPORT_MAX_FEATURES} bodů.`);
  }
  const features = rows.map((row, index) => {
    const lng = Number(row[column("lng")]);
    const lat = Number(row[column("lat")]);
    cleanPosition([lng, lat]);
    const source = cleanText(row[column("source")], 40, "csv-import");
    const sourceRef = cleanText(row[column("sourceref")], 220, `row:${index + 2}`);
    return {
      name: cleanText(row[column("name")], 120, `Bod ${index + 1}`),
      ...(cleanText(row[column("description")], 2_000)
        ? { description: cleanText(row[column("description")], 2_000) }
        : {}),
      lng,
      lat,
      tags: cleanText(row[column("tags")], 500)
        .split(/[|,]/)
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 8),
      kind: cleanKind(row[column("kind")]),
      properties: {
        maposProvenance: [
          {
            source,
            sourceRef,
            ...(cleanText(row[column("attribution")], 500)
              ? { attribution: cleanText(row[column("attribution")], 500) }
              : {}),
            ...(cleanText(row[column("license")], 80)
              ? { license: cleanText(row[column("license")], 80) }
              : {})
          }
        ]
      }
    };
  });
  return {
    format: "csv",
    name: filename.replace(/\.csv$/i, "") || "Importovaná vrstva",
    color: "#10b981",
    requestedVisibility: "private",
    features,
    warnings: ["CSV nemá manifest; vrstva bude po importu soukromá."]
  };
}

export function parseUserLayerImport(
  value: string,
  filename = "import.json"
): UserLayerImportPreview {
  if (filename.toLowerCase().endsWith(".csv")) return parseCsv(value, filename);
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new TypeError("Soubor není platný JSON ani podporované CSV.");
  }
  if (!record(parsed)) throw new TypeError("Import musí být objekt.");
  if (parsed.schema === USER_LAYER_PACKAGE_SCHEMA) {
    if (parsed.schemaVersion !== USER_LAYER_PACKAGE_VERSION) {
      throw new TypeError("Tato hlavní verze MapOS balíčku není podporovaná.");
    }
    assertLayerManifestV2(parsed.manifest);
    if (
      !record(parsed.data) ||
      parsed.data.type !== "FeatureCollection" ||
      !Array.isArray(parsed.data.features)
    ) {
      throw new TypeError("MapOS balíčku chybí FeatureCollection.");
    }
    const manifest = parsed.manifest as LayerManifestV2;
    return {
      format: "mapos-package",
      name: cleanText(manifest.name, 120, "Importovaná vrstva"),
      color: cleanColor(manifest.color),
      requestedVisibility:
        manifest.permissions?.defaultVisibility === "public" ? "public" : "private",
      features: previewFeatures(parsed.data.features, "mapos-package"),
      warnings: []
    };
  }
  if (parsed.type === "FeatureCollection" && Array.isArray(parsed.features)) {
    return {
      format: "geojson",
      name: filename.replace(/\.(geo)?json$/i, "") || "Importovaná vrstva",
      color: "#10b981",
      requestedVisibility: "private",
      features: previewFeatures(parsed.features, "geojson"),
      warnings: ["GeoJSON nemá MapOS manifest; vrstva bude po importu soukromá."]
    };
  }
  throw new TypeError("Podporovaný je MapOS balíček, GeoJSON FeatureCollection nebo CSV.");
}

export function packageAsGeoJson(layerPackage: UserLayerPackageV2): string {
  return JSON.stringify(layerPackage.data, null, 2);
}
