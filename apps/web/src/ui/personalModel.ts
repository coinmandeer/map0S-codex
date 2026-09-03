import type { SavedPlaceV2 } from "@mapos/layer-sdk";

const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  place: "Místa",
  viewpoint: "Vyhlídky",
  cafe: "Kavárny",
  restaurant: "Restaurace",
  camp_site: "Kempy",
  parking: "Parkování",
  lake: "Jezera",
  peak: "Vrcholy",
  castle: "Hrady"
};

export interface PersonalCategoryCount {
  id: string;
  label: string;
  count: number;
}

export function personalCategoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category.replaceAll("_", " ");
}

export function personalCategoryCounts(places: readonly SavedPlaceV2[]): PersonalCategoryCount[] {
  const counts = new Map<string, number>();
  for (const place of places) {
    counts.set(place.category, (counts.get(place.category) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ id, count, label: personalCategoryLabel(id) }))
    .sort((left, right) => left.label.localeCompare(right.label, "cs"));
}

/** "3 plány · 2 vrstvy · 20 míst · 1 hra" (§4.3).
 *
 *  Zero counts are dropped rather than shown as "0 plánů": a fresh profile should read as an
 *  invitation, not as four empty tallies.
 */
export function personalSummaryLine(counts: {
  plans: number;
  layers: number;
  places: number;
  games: number;
}): string {
  const parts = [
    part(counts.plans, "plán", "plány", "plánů"),
    part(counts.layers, "vrstva", "vrstvy", "vrstev"),
    part(counts.places, "místo", "místa", "míst"),
    part(counts.games, "hra", "hry", "her")
  ].filter((value): value is string => value !== null);
  return parts.length ? parts.join(" · ") : "Zatím nic uloženého";
}

function part(count: number, one: string, few: string, many: string): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  const rounded = Math.floor(count);
  const noun = rounded === 1 ? one : rounded >= 2 && rounded <= 4 ? few : many;
  return `${rounded} ${noun}`;
}

/** Second line of a saved place row: where it is filed and when it was saved. */
export function savedPlaceSubtitle(place: SavedPlaceV2, collectionName?: string): string {
  const saved = new Intl.DateTimeFormat("cs", { day: "numeric", month: "numeric" }).format(
    new Date(place.createdAt)
  );
  return [collectionName ?? personalCategoryLabel(place.category), `uloženo ${saved}`].join(" · ");
}

export function filterPersonalPlaces(
  places: readonly SavedPlaceV2[],
  search: string,
  category: string | null
): SavedPlaceV2[] {
  const query = search.trim().toLocaleLowerCase("cs");
  return places.filter((place) => {
    if (category && place.category !== category) return false;
    if (!query) return true;
    return [place.snapshot.title, place.note, ...place.tags]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLocaleLowerCase("cs").includes(query));
  });
}
