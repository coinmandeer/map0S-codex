import type { Bbox } from "./types.js";

/**
 * Editorial guide content — "what to do in city X".
 *
 * This is deliberately a sibling of `PlaceSourceAdapter` rather than a variant of it. A place
 * source maps a rectangle to points; a guide maps an *area* to prose organised in sections.
 * Forcing guides through the bbox contract would throw away exactly what makes them useful:
 * the ordering, the grouping and the sentence explaining why the place is worth the walk.
 */

export type GuideSectionId = "understand" | "see" | "do" | "eat" | "drink" | "sleep" | "buy";

export interface GuideItem {
  name: string;
  lng?: number;
  lat?: number;
  description?: string;
  address?: string;
  phone?: string;
  hours?: string;
  price?: string;
  url?: string;
  /** Ties the item back to the info engine, in the same `source:id` shape places use. */
  sourceRef: string;
}

export interface GuideSection {
  id: GuideSectionId;
  title: string;
  intro?: string;
  items: GuideItem[];
}

export interface Guide {
  /** What the guide is about — usually a settlement name, not the viewport. */
  area: string;
  lang: string;
  sourceId: string;
  attribution: string;
  /** Where a reader can go for the whole thing, which most licences require anyway. */
  url?: string;
  sections: GuideSection[];
}

export interface GuideArea {
  /** Selected boundary names need geographic confirmation to reject namesakes. */
  requireCoordinatesInBbox?: boolean;
  name?: string;
  bbox: Bbox;
  wikidataId?: string;
  lang: string;
}

export interface GuideSourceAdapter {
  id: string;
  label: string;
  attribution: string;
  fetchGuide(area: GuideArea, signal?: AbortSignal): Promise<Guide | null>;
}

export const GUIDE_SECTION_TITLES: Record<GuideSectionId, string> = {
  understand: "O místě",
  see: "Co vidět",
  do: "Co dělat",
  eat: "Kde jíst",
  drink: "Kam na drink",
  sleep: "Kde přespat",
  buy: "Kde nakoupit"
};
