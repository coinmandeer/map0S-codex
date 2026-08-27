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
}
