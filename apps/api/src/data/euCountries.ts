/** Coarse country lookup used to pick a search language for a viewport.
 *
 *  These boxes are deliberately rough (axis-aligned, overlapping around borders) — they are
 *  only ever used to decide *which words to search for*, never to label anything. Fáze 7's
 *  `regions` table has real polygons; when it lands, `countriesForPoint` can be swapped for a
 *  PostGIS point-in-polygon lookup without touching callers.
 */

import type { Bbox } from "@mapos/layer-sdk";

/** Languages api.mapy.com accepts for `lang=`. Anything else has to fall back. */
export type MapyLang =
  "cs" | "de" | "el" | "en" | "es" | "fr" | "it" | "nl" | "pl" | "pt" | "ru" | "sk" | "tr" | "uk";

export const MAPY_LANGS: MapyLang[] = [
  "cs",
  "de",
  "el",
  "en",
  "es",
  "fr",
  "it",
  "nl",
  "pl",
  "pt",
  "ru",
  "sk",
  "tr",
  "uk"
];

interface CountryBox {
  iso: string;
  /** Mapy-supported language to search in. Countries whose own language Mapy doesn't index
   *  fall back to "en" — Mapy still stores their endonym place names, and the extra local
   *  keywords in `LOCAL_KEYWORD_HINTS` cover the gap. */
  lang: MapyLang;
  bbox: Bbox;
}

const COUNTRY_BOXES: CountryBox[] = [
  { iso: "CZ", lang: "cs", bbox: [12.09, 48.55, 18.86, 51.06] },
  { iso: "SK", lang: "sk", bbox: [16.83, 47.73, 22.57, 49.61] },
  { iso: "PL", lang: "pl", bbox: [14.12, 49.0, 24.15, 54.84] },
  { iso: "DE", lang: "de", bbox: [5.87, 47.27, 15.04, 55.06] },
  { iso: "AT", lang: "de", bbox: [9.53, 46.37, 17.16, 49.02] },
  { iso: "CH", lang: "de", bbox: [5.96, 45.82, 10.49, 47.81] },
  { iso: "LI", lang: "de", bbox: [9.47, 47.05, 9.64, 47.27] },
  { iso: "FR", lang: "fr", bbox: [-5.14, 42.33, 8.23, 51.09] },
  { iso: "BE", lang: "nl", bbox: [2.54, 49.5, 6.41, 51.51] },
  { iso: "NL", lang: "nl", bbox: [3.36, 50.75, 7.23, 53.56] },
  { iso: "LU", lang: "fr", bbox: [5.73, 49.44, 6.53, 50.19] },
  { iso: "IT", lang: "it", bbox: [6.63, 36.62, 18.52, 47.09] },
  { iso: "ES", lang: "es", bbox: [-9.39, 35.95, 3.32, 43.79] },
  { iso: "PT", lang: "pt", bbox: [-9.53, 36.96, -6.19, 42.15] },
  { iso: "GB", lang: "en", bbox: [-8.65, 49.86, 1.77, 60.86] },
  { iso: "IE", lang: "en", bbox: [-10.48, 51.42, -5.99, 55.39] },
  { iso: "GR", lang: "el", bbox: [19.37, 34.8, 28.25, 41.75] },
  { iso: "TR", lang: "tr", bbox: [25.66, 35.81, 44.83, 42.11] },
  { iso: "UA", lang: "uk", bbox: [22.14, 44.39, 40.23, 52.38] },
  { iso: "BY", lang: "ru", bbox: [23.18, 51.26, 32.77, 56.17] },
  // Mapy has no Hungarian/Romanian/Croatian/Nordic locale — English + local hints below.
  { iso: "HU", lang: "en", bbox: [16.11, 45.74, 22.9, 48.59] },
  { iso: "SI", lang: "en", bbox: [13.38, 45.42, 16.61, 46.88] },
  { iso: "HR", lang: "en", bbox: [13.49, 42.39, 19.45, 46.55] },
  { iso: "BA", lang: "en", bbox: [15.72, 42.55, 19.62, 45.28] },
  { iso: "RS", lang: "en", bbox: [18.81, 42.23, 23.01, 46.19] },
  { iso: "ME", lang: "en", bbox: [18.43, 41.85, 20.35, 43.55] },
  { iso: "AL", lang: "en", bbox: [19.28, 39.62, 21.06, 42.66] },
  { iso: "MK", lang: "en", bbox: [20.45, 40.85, 23.03, 42.37] },
  { iso: "BG", lang: "en", bbox: [22.36, 41.23, 28.61, 44.23] },
  { iso: "RO", lang: "en", bbox: [20.26, 43.62, 29.71, 48.27] },
  { iso: "MD", lang: "ru", bbox: [26.62, 45.47, 30.16, 48.49] },
  { iso: "DK", lang: "en", bbox: [8.07, 54.56, 15.16, 57.75] },
  { iso: "SE", lang: "en", bbox: [11.11, 55.34, 24.16, 69.06] },
  { iso: "NO", lang: "en", bbox: [4.65, 57.98, 31.29, 71.19] },
  { iso: "FI", lang: "en", bbox: [20.65, 59.81, 31.59, 70.09] },
  { iso: "EE", lang: "en", bbox: [21.76, 57.51, 28.21, 59.68] },
  { iso: "LV", lang: "en", bbox: [20.97, 55.67, 28.24, 58.09] },
  { iso: "LT", lang: "en", bbox: [20.94, 53.9, 26.84, 56.45] },
  { iso: "IS", lang: "en", bbox: [-24.55, 63.39, -13.5, 66.56] },
  { iso: "CY", lang: "el", bbox: [32.26, 34.57, 34.6, 35.7] },
  { iso: "MT", lang: "en", bbox: [14.18, 35.79, 14.58, 36.08] }
];

function contains(bbox: Bbox, lng: number, lat: number): boolean {
  return lng >= bbox[0] && lng <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];
}

/** How far a point sits from a box's centre, as a fraction of the box's half-size (0 = dead
 *  centre, 1 = on the edge). Axis-aligned boxes overlap heavily — Poland's box swallows all of
 *  Czechia — so containment alone can't rank them, but "how central" can: Prague scores 0.32
 *  in the Czech box against 0.94 in the Polish one. */
function centrality(box: Bbox, lng: number, lat: number): number {
  const halfW = (box[2] - box[0]) / 2 || 1e-6;
  const halfH = (box[3] - box[1]) / 2 || 1e-6;
  const cx = (box[0] + box[2]) / 2;
  const cy = (box[1] + box[3]) / 2;
  return Math.max(Math.abs(lng - cx) / halfW, Math.abs(lat - cy) / halfH);
}

/** Every country box covering the point, best fit first. Border regions legitimately return
 *  several — the caller fans out across their languages rather than guessing one. */
export function countriesForPoint(lng: number, lat: number): CountryBox[] {
  return COUNTRY_BOXES.filter((c) => contains(c.bbox, lng, lat)).sort(
    (a, b) => centrality(a.bbox, lng, lat) - centrality(b.bbox, lng, lat)
  );
}

export function centroid(bbox: Bbox): [number, number] {
  return [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
}

/** Two boxes are "equally plausible" when the point is about as central in both — the only
 *  case where paying for a second language is worth it. */
const AMBIGUITY_THRESHOLD = 0.2;

/** Languages to search a bbox in, best fit first. Normally one; a second is added only when
 *  the point is genuinely ambiguous between two countries, so a border viewport costs at most
 *  double and an interior one costs nothing extra.
 *
 *  Caveat inherent to axis-aligned boxes: a town in one country's far corner can score better
 *  in a large neighbour's box (Cheb reads as German). It only changes which words we search
 *  for, and Fáze 7's region polygons replace this lookup wholesale. */
export function langsForBbox(bbox: Bbox, max = 2): MapyLang[] {
  const [lng, lat] = centroid(bbox);
  const hits = countriesForPoint(lng, lat);
  if (!hits.length) return ["en"];

  const best = centrality(hits[0]!.bbox, lng, lat);
  const langs: MapyLang[] = [];
  for (const hit of hits) {
    if (centrality(hit.bbox, lng, lat) - best > AMBIGUITY_THRESHOLD) break;
    if (!langs.includes(hit.lang)) langs.push(hit.lang);
    if (langs.length >= max) break;
  }
  return langs;
}

export function isoForBbox(bbox: Bbox): string | undefined {
  const [lng, lat] = centroid(bbox);
  return countriesForPoint(lng, lat)[0]?.iso;
}
