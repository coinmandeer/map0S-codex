import { createHash } from "node:crypto";
export const evidenceKey = (prefix: string, parts: readonly unknown[]) =>
  `${prefix}:${createHash("sha256").update(JSON.stringify(parts)).digest("hex")}`;
/** Presentation only. Original identity, category and unit remain attached to evidence. */
const categories: Record<string, string> = {
  restaurant: "restaurace",
  cafe: "kavárna",
  bar: "bar",
  pub: "hospoda",
  parking: "parkoviště",
  castle: "hrad nebo zámek",
  viewpoint: "vyhlídka",
  camp_site: "kemp",
  caravan_site: "karavanové stání",
  hotel: "hotel",
  museum: "muzeum",
  park: "park",
  landmark: "zajímavé místo",
  monument: "památník",
  attraction: "zajímavost",
  heritage: "památka",
  nature_reserve: "přírodní rezervace",
  gallery: "galerie",
  ruins: "zřícenina",
  cave: "jeskyně",
  toilets: "toalety",
  drinking_water: "pitná voda"
};
export const overviewCategory = (value: string) => categories[value] ?? value;
export const overviewUnit = (value: string) =>
  (
    ({
      people: "obyvatel",
      persons: "obyvatel",
      "people/km²": "obyv./km²",
      "persons/km2": "obyv./km²",
      years: "let",
      year: "let",
      percent: "%",
      "EUR/person": "EUR/obyv.",
      "million EUR": "mil. EUR",
      "per 100 000 people": "na 100 000 obyvatel",
      "births/1,000 people": "narození na 1 000 obyvatel",
      "deaths/1,000 people": "úmrtí na 1 000 obyvatel",
      "people/1,000 people": "osob na 1 000 obyvatel",
      nights: "nocí"
    }) as Record<string, string>
  )[value] ?? value;
/** Diversify the short selection, without merging IDs or claiming equal names mean equal entities. */
export function diverseHighlights<T extends { title: string; category: string }>(
  items: readonly T[],
  limit = 8
): T[] {
  const chosen: T[] = [],
    names = new Set<string>(),
    categories = new Set<string>();
  const name = (p: T) => p.title.normalize("NFKC").trim().toLocaleLowerCase();
  for (const p of items) {
    if (!names.has(name(p)) && !categories.has(p.category)) {
      chosen.push(p);
      names.add(name(p));
      categories.add(p.category);
      if (chosen.length === limit) return chosen;
    }
  }
  for (const p of items) {
    if (!names.has(name(p))) {
      chosen.push(p);
      names.add(name(p));
      if (chosen.length === limit) return chosen;
    }
  }
  return chosen;
}
