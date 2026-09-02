import {
  isDisplayableDetailMedia,
  type DetailAction,
  type DetailFieldValue,
  type DetailFieldValueKind,
  type DetailMediaAsset,
  type DetailSurfaceId,
  type GeoFeature,
  type LayerManifestV2
} from "@mapos/layer-sdk";

type JsonRecord = Record<string, unknown>;

export interface DetailSurfaceAvailability {
  media: boolean;
  practical: boolean;
  social: boolean;
  more: boolean;
}

/** Overview is the only mandatory section; every other surface needs real content/capability. */
export function detailSurfaceOrder(availability: DetailSurfaceAvailability): DetailSurfaceId[] {
  const surfaces: DetailSurfaceId[] = ["overview"];
  if (availability.media) surfaces.push("media");
  if (availability.practical) surfaces.push("practical");
  if (availability.social) surfaces.push("social");
  if (availability.more) surfaces.push("more");
  return surfaces;
}

function record(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function safeExternalUrl(value: unknown): string | null {
  const candidate = text(value);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function mediaKind(value: unknown): DetailMediaAsset["kind"] | null {
  if (value === "photo" || value === "image") return "photo";
  if (value === "video") return "video";
  if (value === "link") return "link";
  return null;
}

/** Reads structured media with safe URLs. Rights fields remain visible advisory metadata while
 * moderation and transform readiness decide whether a browser may display the asset. */
export function detailMediaFromFeature(
  feature: GeoFeature,
  manifest?: LayerManifestV2
): DetailMediaAsset[] {
  const raw = feature.properties.media;
  if (!Array.isArray(raw)) return [];
  const attributions = new Map(
    (manifest?.attribution ?? []).map((item) => [item.label, item] as const)
  );
  const fallback = manifest?.attribution?.length === 1 ? manifest.attribution[0] : undefined;
  const seen = new Set<string>();
  const assets: DetailMediaAsset[] = [];

  for (const candidate of raw) {
    if (!record(candidate)) continue;
    const kind = mediaKind(candidate.kind ?? candidate.type);
    const id = text(candidate.id);
    const url = safeExternalUrl(candidate.url);
    const sourceId = text(candidate.sourceId);
    const sourceLabel = text(candidate.sourceLabel) ?? fallback?.label ?? null;
    const sourceDefinition = sourceLabel ? attributions.get(sourceLabel) : undefined;
    if (!kind || !id || !url || !sourceId || !sourceLabel || seen.has(id)) continue;

    const asset: DetailMediaAsset = {
      id,
      kind,
      url,
      ...(safeExternalUrl(candidate.thumbnailUrl)
        ? { thumbnailUrl: safeExternalUrl(candidate.thumbnailUrl)! }
        : {}),
      ...(text(candidate.caption) ? { caption: text(candidate.caption)! } : {}),
      sourceId,
      sourceLabel,
      ...(safeExternalUrl(candidate.sourceUrl ?? sourceDefinition?.url)
        ? { sourceUrl: safeExternalUrl(candidate.sourceUrl ?? sourceDefinition?.url)! }
        : {}),
      // Preserve any asset-level attribution/terms for display and later audits without making
      // either field a prototype visibility gate.
      attribution: text(candidate.attribution) ?? "",
      license: text(candidate.license) ?? "",
      moderationStatus:
        candidate.moderationStatus === "approved" ||
        candidate.moderationStatus === "pending" ||
        candidate.moderationStatus === "rejected" ||
        candidate.moderationStatus === "unreviewed"
          ? candidate.moderationStatus
          : "unreviewed",
      transformStatus:
        candidate.transformStatus === "ready" ||
        candidate.transformStatus === "processing" ||
        candidate.transformStatus === "failed"
          ? candidate.transformStatus
          : "processing"
    };
    if (!isDisplayableDetailMedia(asset)) continue;
    seen.add(id);
    assets.push(asset);
  }
  return assets;
}

const FIELD_LABELS: Record<string, string> = {
  address: "Adresa",
  openingHours: "Otevírací doba",
  opening_hours: "Otevírací doba",
  phone: "Telefon",
  email: "E-mail",
  website: "Web",
  elevationM: "Nadmořská výška",
  magnitude: "Magnituda",
  depthKm: "Hloubka",
  occurredAt: "Čas",
  price: "Cena",
  rating: "Hodnocení",
  reviews: "Počet recenzí",
  note: "Poznámka",
  tags: "Štítky",
  collection: "Sbírka",
  status: "Stav"
};

export function detailFieldLabel(id: string): string {
  const leaf = id.split(/[./]/).filter(Boolean).at(-1) ?? id;
  return (
    FIELD_LABELS[leaf] ??
    leaf
      .replace(/[_-]+/g, " ")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/^./, (letter) => letter.toUpperCase())
  );
}

function fieldKind(id: string, value: unknown): DetailFieldValueKind {
  const leaf = id.toLowerCase();
  if (/url|website|link/.test(leaf)) return "link";
  if (/phone|tel/.test(leaf)) return "phone";
  if (/email/.test(leaf)) return "email";
  if (/price|cost|fee/.test(leaf)) return "currency";
  if (/rating|score/.test(leaf)) return "rating";
  if (/date|time|at$/.test(leaf)) return "date";
  if (/hours|schedule/.test(leaf)) return "schedule";
  if (/status|state/.test(leaf)) return "status";
  if (typeof value === "number") return "number";
  if (record(value)) return "key-value";
  return "text";
}

function pathValue(root: JsonRecord, path: string): unknown {
  const parts = path.replace(/^\//, "").split(/[./]/).filter(Boolean);
  let value: unknown = root;
  for (const part of parts) {
    if (!record(value) || !(part in value)) return undefined;
    value = value[part];
  }
  return value;
}

function fieldValue(value: unknown): DetailFieldValue["value"] | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    const values = value
      .flatMap((item) =>
        typeof item === "string" || typeof item === "number" || typeof item === "boolean"
          ? [String(item)]
          : []
      )
      .filter(Boolean)
      .slice(0, 40);
    return values.length ? values : null;
  }
  if (record(value)) {
    const values = Object.entries(value)
      .flatMap(([key, item]) =>
        typeof item === "string" || typeof item === "number" || typeof item === "boolean"
          ? [`${detailFieldLabel(key)}: ${String(item)}`]
          : []
      )
      .slice(0, 40);
    return values.length ? values : null;
  }
  return null;
}

function providerField(
  properties: JsonRecord,
  id: string,
  defaultSourceId: string
): { value: unknown; sourceId: string } {
  const direct = pathValue(properties, id);
  if (direct !== undefined) return { value: direct, sourceId: defaultSourceId };

  const namespaces = properties.providerFields;
  if (!record(namespaces)) return { value: undefined, sourceId: defaultSourceId };
  for (const [sourceId, values] of Object.entries(namespaces)) {
    if (!record(values)) continue;
    const value = pathValue(values, id);
    if (value !== undefined) return { value, sourceId };
  }
  return { value: undefined, sourceId: defaultSourceId };
}

/** Resolves manifest-declared fields generically. Unknown payload keys remain private unless the
 * manifest lists them, preventing accidental disclosure of opaque provider extensions. */
export function detailFieldsFromFeature(
  feature: GeoFeature,
  manifest?: LayerManifestV2
): DetailFieldValue[] {
  const order = manifest?.detail?.fieldOrder ?? [];
  if (!order.length) return [];
  const sourceLabelById = new Map(
    (manifest?.attribution ?? []).map((source) => [source.label, source.label] as const)
  );
  const defaultSourceId = manifest?.id ?? feature.properties.layerId;
  const defaultSourceLabel = manifest?.attribution?.[0]?.label ?? manifest?.name ?? defaultSourceId;

  return order.flatMap((id) => {
    if (["title", "name", "category", "description"].includes(id)) return [];
    const resolved = providerField(feature.properties, id, defaultSourceId);
    const value = fieldValue(resolved.value);
    if (value === null) return [];
    return [
      {
        id,
        label: detailFieldLabel(id),
        kind: fieldKind(id, resolved.value),
        value,
        sourceId: resolved.sourceId,
        sourceLabel: sourceLabelById.get(resolved.sourceId) ?? defaultSourceLabel
      }
    ];
  });
}

function actionUrl(feature: GeoFeature, template: string | undefined): string | null {
  const properties = feature.properties;
  const raw = template
    ? template.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (_match, key: string) => {
        const value = pathValue(properties, key);
        return encodeURIComponent(
          typeof value === "string" || typeof value === "number" ? String(value) : ""
        );
      })
    : (properties.externalUrl ?? properties.sourceUrl ?? properties.url ?? properties.website);
  return safeExternalUrl(raw);
}

/** Adapts the existing v2 layer action contract into the smaller, executable detail contract.
 * Unsupported write/commerce/custom actions are omitted rather than pretending they worked. */
export function detailActionsFromManifest(
  feature: GeoFeature,
  manifest?: LayerManifestV2
): DetailAction[] {
  return (manifest?.actions ?? []).flatMap((action) => {
    if (action.requiresPermission) return [];
    const rawKind = String(action.kind);
    const kind: DetailAction["kind"] | null =
      rawKind === "open-url" || rawKind === "provider-action"
        ? "open-url"
        : rawKind === "save" || rawKind === "share" || rawKind === "route-to"
          ? rawKind
          : rawKind === "add-to-plan" || rawKind === "report"
            ? rawKind
            : null;
    if (!kind) return [];
    const url =
      kind === "open-url" || kind === "report" ? actionUrl(feature, action.urlTemplate) : null;
    if ((kind === "open-url" || kind === "report") && !url) return [];
    return [
      {
        id: action.id,
        label: action.label,
        kind,
        ...(action.providerId ? { sourceId: action.providerId } : {}),
        ...(url ? { url } : {}),
        offlineAvailable: kind === "save" || kind === "add-to-plan" || kind === "share"
      }
    ];
  });
}

/** Exact OSM refs can be corrected without pretending MapOS has a provider write scope. */
export function osmCorrectionUrl(ref: string | undefined): string | null {
  if (!ref) return null;
  const match = /^(node|way|relation)\/(\d+)$/.exec(ref);
  if (!match) return null;
  return `https://www.openstreetmap.org/edit?${match[1]}=${match[2]}`;
}
