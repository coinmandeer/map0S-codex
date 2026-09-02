import type { Place, PlaceSourceId } from "./places.js";

/**
 * How a panel gets its content.
 *
 * The distinction is not cosmetic — it decides what the panel can promise. An `api` panel owns
 * its rendering and can be styled and translated; an `iframe` panel shows somebody else's page
 * and may be refused embedding at runtime; a `link` panel is the honest fallback for services
 * that forbid framing outright.
 */
export type InfoPanelKind = "api" | "iframe" | "link";

/** How provider-controlled content reaches the browser or the rendered detail. */
export type ExternalSourceUse = "api" | "embed" | "outbound-link" | "tile" | "media";

/**
 * Auditable rights metadata for content that MapOS does not own.
 *
 * `terms` is deliberately separate from the human-facing attribution: a provider can require a
 * brand credit while governing the integration under service terms rather than an open licence.
 * Host patterns are exact host names or a leading `*.` wildcard and are kept protocol-free so a
 * browser inventory can compare them without treating a URL path as a second provider.
 */
export interface ExternalSourceRights {
  id: string;
  label: string;
  hosts: readonly string[];
  uses: readonly ExternalSourceUse[];
  attribution: string;
  terms: string;
  evidenceUrl: string;
}

/** Stable top-level areas of the unified place detail. A host may localize their labels, but
 *  extensions target these ids rather than inventing another parallel tab taxonomy. */
export type DetailSurfaceId = "overview" | "media" | "practical" | "social" | "more";

/** Content ownership is deliberately independent from visual placement. Provider content,
 *  MapOS community content and private notes may share a surface, but must never share an
 *  unlabeled data bucket. */
export type DetailContentOwner = "canonical" | "provider" | "mapos" | "private";

export type DetailMediaKind = "photo" | "video" | "link";
export type DetailMediaModerationStatus = "approved" | "pending" | "rejected" | "unreviewed";
export type DetailMediaTransformStatus = "ready" | "processing" | "failed";

/** A media reference suitable for the detail surface. Rights fields are retained as advisory
 * metadata; safe URL, moderation and transform readiness remain runtime requirements. */
export interface DetailMediaAsset {
  id: string;
  kind: DetailMediaKind;
  url: string;
  thumbnailUrl?: string;
  caption?: string;
  sourceId: string;
  sourceLabel: string;
  sourceUrl?: string;
  attribution: string;
  license: string;
  moderationStatus: DetailMediaModerationStatus;
  transformStatus: DetailMediaTransformStatus;
}

export type DetailFieldValueKind =
  | "text"
  | "number"
  | "currency"
  | "date"
  | "rating"
  | "badge"
  | "link"
  | "phone"
  | "email"
  | "status"
  | "schedule"
  | "reference"
  | "key-value";

/** Resolved provider field. A manifest enumerates what may be exposed; a trusted adapter/host
 *  supplies the display label/type and the provider payload supplies the value. Keeping those
 *  pieces explicit lets a new partner render without a branch in `PinDetail`. */
export interface DetailFieldValue {
  id: string;
  label: string;
  kind: DetailFieldValueKind;
  value: string | number | boolean | string[];
  sourceId: string;
  sourceLabel: string;
}

export type DetailActionKind =
  "open-url" | "save" | "add-to-plan" | "route-to" | "share" | "report";

/** Resolved, script-free action. API commands remain outside this first safe slice: a provider
 *  action is an explicit deep link unless a future server adapter advertises a write scope. */
export interface DetailAction {
  id: string;
  label: string;
  kind: DetailActionKind;
  sourceId?: string;
  url?: string;
  offlineAvailable: boolean;
  requiresConfirmation?: boolean;
}

function safeWebUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

/** Technical display gate shared by web hosts and extension tests. */
export function isDisplayableDetailMedia(asset: DetailMediaAsset): boolean {
  return Boolean(
    asset.id.trim() &&
    asset.sourceId.trim() &&
    asset.sourceLabel.trim() &&
    safeWebUrl(asset.url) &&
    asset.moderationStatus === "approved" &&
    asset.transformStatus === "ready"
  );
}

/** What a panel gets to decide whether it has anything to say about a place. */
export interface InfoPanelContext {
  place: Place;
  /** Each source's native id for this place, keyed by source. */
  refs: Partial<Record<PlaceSourceId, string>>;
}

/**
 * A tab in the place detail.
 *
 * Declared separately from its rendering so the tab strip can be built — and tested — without
 * mounting any panel: which tabs a place offers is a data question, not a React one.
 */
export interface InfoPanelDescriptor {
  id: string;
  label: string;
  icon: string;
  kind: InfoPanelKind;
  /** Ascending; lower sorts first. Overview is 0, everything else follows. */
  order?: number;
  /** Offered only when there is something behind it — an empty tab is worse than no tab. */
  appliesTo(ctx: InfoPanelContext): boolean;
  attribution: string;
  /** Unified-detail placement. Old extensions omit it and safely land under `more`. */
  surface?: DetailSurfaceId;
  /** Attribution/ownership bucket shown around the rendered panel. */
  contentOwner?: DetailContentOwner;
  /** Provider id when `contentOwner` is `provider`. */
  sourceId?: string;
  /** Complete rights/terms records for every provider represented by this panel. */
  sourceRights?: readonly ExternalSourceRights[];
}
