import type { BasemapDefinition } from "@mapos/layer-sdk";

/** Which of the four illustrative fills a card uses when it has no rendered thumbnail.
 *  Not decoration: satellite, dark and terrain backgrounds are told apart in the picker mostly
 *  by overall tone, so the fallback carries the same signal the screenshot would. */
export type ThumbKind = "street" | "dark" | "satellite" | "terrain" | "outdoor";

export function thumbKind(basemap: BasemapDefinition): ThumbKind {
  if (basemap.imagery) return "satellite";
  if (basemap.group === "terrain") return "terrain";
  if (basemap.group === "outdoor") return "outdoor";
  return basemap.id.includes("dark") ? "dark" : "street";
}

/** Rendered by `scripts/render-basemap-thumbs.mjs` over one shared viewport, so the cards can
 *  be compared with each other rather than each showing a different city. */
export function thumbSource(basemap: BasemapDefinition): string {
  return basemap.thumbnail ?? `/basemaps/${basemap.id}.webp`;
}

/** A stable hue per id, so the fallback for two street styles is still distinguishable. */
export function thumbHue(id: string): number {
  return [...id].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 360;
}

/** The card's supporting line, clipped to one line's worth of characters (§4.8). Long hints
 *  otherwise wrap to three lines and the 72 px card grows into a paragraph. */
export function shortHint(hint: string, maxCharacters = 48): string {
  if (hint.length <= maxCharacters) return hint;
  const cut = hint.slice(0, maxCharacters);
  const lastSpace = cut.lastIndexOf(" ");
  // Only break on a space that is near the end; otherwise a hint with one early space would
  // lose most of its words.
  const clipped = lastSpace > 0 && lastSpace > maxCharacters - 12 ? cut.slice(0, lastSpace) : cut;
  return `${clipped.trimEnd()}…`;
}

/** Light designs have a dark twin that the theme swaps in. The card says so, because otherwise
 *  "CARTO Voyager" selected while Dark Matter is drawn looks like a bug. */
export function hasThemeTwin(basemap: BasemapDefinition): boolean {
  return Boolean(basemap.darkVariantId);
}
